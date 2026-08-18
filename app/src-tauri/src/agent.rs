//! M3 / v0.2-α, dispatch de agents de código.
//!
//! O LOOP de execução (spawn, leitura do JSONL linha-a-linha, cancel, stderr,
//! Done) é compartilhado em `run_agent`; cada CLI (Claude/Codex/OpenCode) vira
//! um `adapters::AgentAdapter` que só varia em montar o comando e mapear linhas.

use crate::adapters::{self, RunRequest};
use crate::attachments::{self, ActiveConvs, Attachment};
use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Notify;

/// Registro de runs ativos → cancelar um run (H1) e matar TODOS na saída do app
/// (sem isso, Cmd-Q no meio de um run deixa claude/codex órfãos rodando headless,
/// possivelmente editando o repo e gastando tokens sem ninguém olhar).
/// `.0`: run_id → sinal de cancelamento; `.1`: run_id → pid do processo vivo.
#[derive(Default)]
pub struct RunRegistry(
    pub Mutex<HashMap<String, Arc<Notify>>>,
    pub Mutex<HashMap<String, u32>>,
);

impl RunRegistry {
    /// SIGKILL em todos os processos de agent vivos (hook de saída do app).
    /// Síncrono de propósito: no exit o runtime async pode não rodar mais.
    pub fn kill_all(&self) {
        if let Ok(pids) = self.1.lock() {
            for pid in pids.values() {
                #[cfg(unix)]
                {
                    let _ = std::process::Command::new("kill")
                        .args(["-9", &pid.to_string()])
                        .output();
                }
                #[cfg(not(unix))]
                let _ = pid;
            }
        }
    }
}

/// Guard RAII: remove a conversa de ActiveConvs ao sair do run (qualquer path),
/// liberando-a p/ o GC. Evita vazar a marca de "ativa" num early-return.
struct ActiveGuard<'a> {
    active: &'a ActiveConvs,
    conv_id: String,
}
impl Drop for ActiveGuard<'_> {
    fn drop(&mut self) {
        self.active.remove(&self.conv_id);
    }
}

/// Guard RAII: remove o run do RunRegistry ao sair (qualquer path, inclusive os
/// early-returns do `?`). O Notify é registrado UMA vez no início do run_agent,
/// antes do spawn e reusado entre as 2 tentativas da degradação graciosa, para
/// que um cancel no gap (entre run_agent e o loop, ou entre tentativas) fique
/// retido como permit e seja consumido pela próxima `notified()`.
struct RunGuard<'a> {
    registry: &'a RunRegistry,
    run_id: &'a str,
}
impl Drop for RunGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut map) = self.registry.0.lock() {
            map.remove(self.run_id);
        }
        if let Ok(mut pids) = self.registry.1.lock() {
            pids.remove(self.run_id);
        }
    }
}

/// Proveniência do custo: reportado pelo CLI ($ direto, ex. Claude), estimado
/// (tokens × tabela de preço, ex. Codex) ou desconhecido (sem custo nem usage).
#[derive(Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CostSource {
    Reported,
    Estimated,
    Unknown,
}

/// Usage ACUMULADO de uma thread do provider (não do turno). Existe porque o
/// `codex exec` reporta, no `turn.completed`, o total da THREAD inteira: dois
/// turnos triviais na mesma thread (resume) saíram 17494 → 35005 input tokens
/// (codex 0.146, medido 04/08/2026). Lido como se fosse do turno, o app somava
/// acumulados e o custo explodia em quadrado (ADR-033).
///
/// Viaja nos DOIS sentidos: entra no `RunRequest.usage_baseline` (o que a
/// thread já tinha gasto antes deste run) e volta no `Result.cumulative_usage`
/// (o total lido agora), pro front persistir e devolver no próximo turno. O
/// adapter é por-RUN; a thread vive entre runs — por isso o estado mora onde já
/// existe persistência (ver ADR-033).
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug, Serialize, serde::Deserialize)]
pub struct CumulativeUsage {
    /// Input TOTAL (inclui a parte cacheada, convenção da API da OpenAI).
    pub input: u64,
    pub cached_input: u64,
    pub output: u64,
}

impl CumulativeUsage {
    /// Quanto ESTE turno gastou: diferença campo a campo com clamp em 0. O
    /// clamp protege de contador que anda pra trás (thread nova, reset do
    /// provider): subcontar é honesto, supercontar é a mentira do ADR-033.
    pub fn delta_from(&self, base: &CumulativeUsage) -> CumulativeUsage {
        CumulativeUsage {
            input: self.input.saturating_sub(base.input),
            cached_input: self.cached_input.saturating_sub(base.cached_input),
            output: self.output.saturating_sub(base.output),
        }
    }
}

/// Estado de um trabalho DIFERIDO do provider (background task que sobrevive ao
/// turno): `running`/`progress` = vivo; `completed` = concluiu limpo; `stopped`
/// = morreu/foi parado sem concluir (o front mostra "interrompido").
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DeferredStatus {
    Running,
    Progress,
    Completed,
    Stopped,
}

/// Evento normalizado enviado ao frontend.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    Session {
        session_id: String,
        model: Option<String>,
        tools: usize,
    },
    /// Texto completo de um bloco assistant (fallback p/ CLIs sem partial messages).
    Text {
        text: String,
    },
    /// Texto final emitido por um subagente. O vínculo com a tool `Task` que o
    /// criou é preservado; o frontend o mostra dentro do Fio Vivo em vez de
    /// misturá-lo à voz do executor principal.
    SubagentText {
        parent_tool_id: String,
        text: String,
    },
    /// Pedaço de texto em streaming (H2, `--include-partial-messages`).
    TextDelta {
        text: String,
    },
    /// Fim de UM bloco de texto (content_block_stop). Fecha a bolha corrente pro
    /// próximo bloco não colar no anterior (nem no meio da palavra). Genérico —
    /// qualquer adapter que streame por bloco emite; quem não streama, ignora.
    TextStop,
    Tool {
        id: String,
        name: String,
        input: serde_json::Value,
        /// Tool `Task`/agent que originou esta ação. Ausente = ação do executor
        /// principal ou provider que não publica topologia.
        parent_tool_id: Option<String>,
    },
    /// Resultado (resumido) de um tool_use: liga na linha da tool pelo `id`.
    /// `text` truncado (~600 chars); `lines` conta as linhas do output completo.
    /// `images` = evidência VISUAL do resultado (browser-plan B1): paths
    /// RELATIVOS ao app_data_dir ("evidence/<convId>/<toolId>-<idx>.<ext>"),
    /// gravados pelo EvidenceSink — nunca base64 no Channel. Vazio = omitido
    /// na serialização (payload idêntico ao de antes, fail-open no front).
    ToolResult {
        id: String,
        ok: bool,
        text: String,
        lines: u64,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        images: Vec<String>,
    },
    /// Trabalho DIFERIDO do provider (tool `Workflow`, background task): vive
    /// além do turno que o criou (deferred-work-plan, D1). Traduzido dos
    /// eventos `system/task_*` do stream-json do Claude 2.1.219 e da string
    /// `<task-notification>` injetada no `--resume`. `id` = task_id do CLI;
    /// `tool_use_id` liga ao tool_use `Workflow` de origem (Fio Vivo).
    DeferredWork {
        id: String,
        tool_use_id: Option<String>,
        /// task_type do CLI (ex. "local_workflow").
        kind: Option<String>,
        /// Nome humano (workflow_name/description do task_started).
        name: Option<String>,
        status: DeferredStatus,
        summary: Option<String>,
        /// Caminho do resultado em DISCO (task_notification.output_file) — a
        /// lição do incidente deep-research: o relatório existia em
        /// `…/tasks/<id>.output` e ninguém sabia. Primeira classe, não some.
        output_file: Option<String>,
        /// Progresso cru (workflow_progress/usage), só para render/telemetria.
        progress: Option<serde_json::Value>,
    },
    /// Footprint ATUAL do contexto (tokens de prompt da última chamada:
    /// input + cache lido + cache criado). Alimenta o anel de contexto.
    ContextUsage {
        tokens: u64,
    },
    /// Limite de uso/cota do CLI atingido: vira cartão ACIONÁVEL (revezamento)
    /// em vez de erro morto. `reset_hint` = trecho com a hora do reset, se veio.
    LimitReached {
        message: String,
        reset_hint: Option<String>,
    },
    /// Fim de turno com telemetria. Os tokens e o custo são SEMPRE do TURNO
    /// (delta) — quando o provider só sabe reportar o acumulado da thread, o
    /// adapter já subtraiu o baseline do run (ADR-033).
    Result {
        ok: bool,
        text: Option<String>,
        cost_usd: Option<f64>,
        cost_source: CostSource,
        input_tokens: u64,
        output_tokens: u64,
        cache_read: u64,
        cache_creation: u64,
        /// Total ACUMULADO da thread lido neste turno, só para o front
        /// persistir e devolver como baseline no próximo run. Ausente = o
        /// provider reporta por turno (nada a acumular). NUNCA é o número que
        /// a UI/ledger mostra.
        #[serde(skip_serializing_if = "Option::is_none")]
        cumulative_usage: Option<CumulativeUsage>,
    },
    /// Erro do processo/agent (H3): spawn, stderr ou exit code ≠ 0.
    Error {
        message: String,
    },
    /// Aviso de UI não-fatal (ex. anexo expirado/não-suportado). NUNCA entra no
    /// prompt do modelo, vai direto pro front como uma linha discreta.
    Notice {
        message: String,
    },
    /// INTERNO: o adapter detectou que o resume falhou porque a sessão não existe.
    /// O run_once intercepta (não vai pro front) e o run_agent recomeça sem resume.
    SessionNotFound {
        message: String,
    },
    /// Run interrompido pelo usuário (H1).
    Cancelled,
    Done {
        code: Option<i32>,
    },
    /// Linha de tipo desconhecido, surfaçada em vez de descartada (regra de ouro
    /// do agent-runner.md). A UI ignora; serve p/ não perder eventos quando o CLI
    /// muda. No-op no front (default do reduceEvent).
    Unknown {
        raw: serde_json::Value,
    },
}

/// Roda um agent de código na pasta `cwd` e streama eventos normalizados via Channel.
/// `agent` seleciona o adapter (claude-code / codex / opencode).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn run_agent(
    app: tauri::AppHandle,
    run_id: String,
    conv_id: String,
    agent: String,
    model: Option<String>,
    effort: Option<String>,
    prompt: String,
    cwd: String,
    resume: Option<String>,
    // "MyCockpit resume": recap pronto do front (`memoryFallback` no invoke), usado
    // SÓ se o resume nativo falhar. Option = default: invoke antigo/sem o campo
    // desserializa como None (mesmo padrão do plan_first; nunca quebra turno velho).
    memory_fallback: Option<String>,
    permission: String,
    // "Planejar primeiro" POR TURNO. Option = default: invoke antigo/sem o campo
    // (`planFirst` no front) desserializa como None → false (nunca quebra turno velho).
    plan_first: Option<bool>,
    // H1 (prompt-hygiene-plan): conteúdo de SISTEMA por-run (doutrina/persona)
    // montado pelo front (`systemPrompt` no invoke). Roteado por capability:
    // motor com `system_channel` recebe no canal nativo; sem, dobra no corpo
    // (route_system_prompt, fail-open). Option = invoke antigo → None.
    system_prompt: Option<String>,
    // H2 (prompt-hygiene-plan): fingerprint do ÚLTIMO plano de MCPs anunciado
    // NESTA conversa (`mcpFingerprint` no invoke; o front guarda por conversa
    // no store — ledger `injected`, alimentado pelo evento `mcp://announced`).
    // None = nunca anunciado/desconhecido → anuncia (fail-open pra
    // visibilidade). Option = invoke antigo → None.
    mcp_fingerprint: Option<String>,
    // ADR-033: acumulado de tokens que a THREAD retomada já tinha (`usageBaseline`
    // no invoke; o front persiste por thread o `cumulative_usage` devolvido no
    // Result anterior). Option = invoke antigo/thread nova → None (o turno vale
    // inteiro). Motor que reporta usage por turno ignora.
    usage_baseline: Option<CumulativeUsage>,
    attachments: Vec<Attachment>,
    on_event: Channel<AgentEvent>,
    registry: tauri::State<'_, RunRegistry>,
    active: tauri::State<'_, ActiveConvs>,
    pending_approvals: tauri::State<'_, std::sync::Arc<crate::approval::PendingApprovals>>,
    process_registry: tauri::State<
        '_,
        std::sync::Arc<crate::work_gateway::ProcessRegistry>,
    >,
) -> Result<(), String> {
    let mut adapter = adapters::resolve(&agent)?;
    // Capabilities declaradas (G1.1): TODA decisão genérica deste run consulta
    // isto — nunca o nome do agent (o nome fica confinado à factory).
    let caps = adapter.capabilities();
    // Evidência visual (browser-plan B1): destino em disco das imagens que
    // vierem em tool_result. Sem app_data_dir → None e o adapter degrada
    // (tool_result segue só texto, comportamento de sempre).
    if let Some(sink) = crate::evidence::EvidenceSink::for_conv(&app, &conv_id) {
        adapter.set_evidence_sink(sink);
    }
    // H1, registra o sinal de cancelamento ANTES de qualquer spawn e UMA vez só.
    // Reusado entre as 2 tentativas (degradação graciosa): um cancel que chega no
    // gap fica retido como permit do Notify e mata o filho na 1ª `notified()`. O
    // RunGuard tira o run_id do registry em qualquer saída (inclusive nos `?`).
    let notify = Arc::new(Notify::new());
    if let Ok(mut map) = registry.0.lock() {
        map.insert(run_id.clone(), notify.clone());
    }
    let _run_guard = RunGuard {
        registry: registry.inner(),
        run_id: &run_id,
    };
    // anexos: rel→abs + descarta sumidos; particiona por capacidade do agent.
    let (live, missing) = attachments::resolve_live(&app, attachments);
    let (used, unsupported): (Vec<_>, Vec<_>) = live
        .into_iter()
        .partition(|a| adapter.supports_attachment(&a.kind));
    if missing > 0 {
        let _ = on_event.send(AgentEvent::Notice {
            message: format!("{missing} anexo(s) expiraram e não foram enviados."),
        });
    }
    for a in &unsupported {
        let _ = on_event.send(AgentEvent::Notice {
            message: format!(
                "\"{}\" não é suportado pelo {agent} e foi ignorado.",
                a.name
            ),
        });
    }
    // F23: marca a conversa como ativa p/ o GC não apagar os blobs durante o run.
    active.insert(&conv_id);
    let _active_guard = ActiveGuard {
        active: active.inner(),
        conv_id: conv_id.clone(), // clone: o restart pós-resume-falho ainda lê conv_id
    };
    // Permissão parseada UMA vez na fronteira: valor desconhecido é ERRO aqui,
    // nunca fail-open dentro de um adapter (typo ganhava escrita antes).
    let permission = adapters::Permission::parse(&permission)?;
    // pastas extras liberadas: lidas do .mycockpit/config.toml do projeto que
    // contém o cwd (cobre worktrees) → viram --add-dir. ANTES de mover cwd.
    let extra_dirs = crate::mycockpit::resolve_extra_dirs(&cwd);
    // Interação PENDENTE inline (capability `inline_interaction`, hoje só o
    // Claude): sobe um socket por-run + registra o listener que vira cada
    // pedido num evento `interaction://request`. Cobre 2 kinds: `approval` (só
    // modo Padrao, via --permission-prompt-tool) e `question` (tool `ask_user`,
    // TODOS os modos com MCP ligado). O `_approval_listener` (RAII) limpa o
    // socket e resolve os pendentes (deny/cancelado) no fim do run/cancel
    // (qualquer path, inclusive os `?`), cobrindo as 2 tentativas da degradação
    // graciosa. None (sem a capability, socket falhou, ou FusionRo que desliga
    // MCP) = comportamento antigo, nunca derruba o run.
    // FusionRo desliga TODO MCP (--strict-mcp-config {}) → sem ask_user nesse modo.
    let interaction_on =
        caps.inline_interaction && !matches!(permission, adapters::Permission::FusionRo);
    // Um único binário serve os dois MCPs internos (subcomandos diferentes).
    // Resolve uma vez: falha degrada sem MCP, nunca derruba o turno.
    let server_bin = std::env::current_exe().ok();
    let mut approval = None;
    let mut _approval_listener = None;
    if interaction_on {
        match server_bin.as_ref() {
            Some(server_bin) => {
                let listener = crate::approval::ApprovalListener::spawn(
                    app.clone(),
                    run_id.clone(),
                    pending_approvals.inner().clone(),
                );
                if let Some(l) = listener {
                    // usa o path REAL bindado (pode ser um alternativo -1/-2 se
                    // houve colisão de prefixo com um run vivo — M4).
                    let sock = l.path().to_string_lossy().to_string();
                    approval = Some((server_bin.to_string_lossy().to_string(), sock));
                    _approval_listener = Some(l);
                }
            }
            None => {
                // B2: degradação silenciosa era invisível — deixa rastro no log.
                log::warn!("interação: current_exe() falhou; seguindo sem approval server");
            }
        }
    }
    // Pull de contexto: agents com a capability `context_mcp` recebem o MESMO
    // MCP read-only. Sem a capability (agy), degrada pros ponteiros no próprio
    // prompt. FusionRo mantém todo MCP desligado pelo contrato de candidatos
    // especulativos.
    let context_gateway = if !caps.context_mcp
        || matches!(permission, adapters::Permission::FusionRo)
    {
        None
    } else {
        server_bin
            .as_ref()
            .map(|bin| crate::context_gateway::GatewayConfig {
                server_bin: bin.to_string_lossy().to_string(),
                root: cwd.clone(),
                conv_id: conv_id.clone(),
                db_path: app
                    .path()
                    .app_data_dir()
                    .ok()
                    .map(|p| p.join("mycockpit.db").to_string_lossy().to_string()),
            })
    };
    // Substrato uniforme de trabalho/processos. O listener vive pelo run inteiro;
    // processos iniciados por ele continuam no registry do app após o turno.
    let supports_work_mcp =
        caps.work_mcp && !matches!(permission, adapters::Permission::FusionRo);
    let mut _work_listener = None;
    let work_gateway = if supports_work_mcp {
        server_bin.as_ref().and_then(|bin| {
            let listener = crate::work_gateway::WorkListener::spawn(
                app.clone(),
                run_id.clone(),
                conv_id.clone(),
                cwd.clone(),
                process_registry.inner().clone(),
            )?;
            let config = crate::work_gateway::GatewayConfig {
                server_bin: bin.to_string_lossy().to_string(),
                socket: listener.path().to_string_lossy().to_string(),
            };
            _work_listener = Some(listener);
            Some(config)
        })
    } else {
        None
    };
    // Control plane de MCPs externos. Sem binding explícito ele devolve o plano
    // default e preserva integralmente o comportamento legado dos CLIs. Com
    // bindings, faz preflight/circuito de fallback antes de gastar um turno.
    let mcp_plan = if matches!(permission, adapters::Permission::FusionRo) {
        crate::mcp_control::McpRunPlan::default()
    } else {
        match crate::mcp_control::plan_for_run(&app, &conv_id, &agent, &cwd).await {
            Ok(plan) => plan,
            Err(error) => {
                // Um erro na fronteira de policy não pode cair para os MCPs
                // globais: isso reintroduziria capabilities que o profile
                // gerenciado tentou remover. Falha antes do turno pago.
                let _ = on_event.send(AgentEvent::Error {
                    message: format!("control plane MCP indisponível: {error}"),
                });
                let _ = on_event.send(AgentEvent::Done { code: None });
                return Ok(());
            }
        }
    };
    for message in &mcp_plan.notices {
        let _ = on_event.send(AgentEvent::Notice {
            message: message.clone(),
        });
    }
    if let Some(message) = &mcp_plan.blocked {
        let _ = on_event.send(AgentEvent::Error {
            message: format!("run bloqueado pelo control plane MCP: {message}"),
        });
        let _ = on_event.send(AgentEvent::Done { code: None });
        return Ok(());
    }
    let prompt = match &mcp_plan.prompt_policy {
        Some(policy) => format!("{policy}\n\n---\n\n{prompt}"),
        None => prompt,
    };
    // H2 — cadência do preâmbulo por capability: canal system → corpo limpo
    // (o adapter re-envia anúncio+telemetria no canal a cada spawn); motor
    // 1º-turno-só → sem resume leva tudo, com resume só re-anuncia MCP quando
    // o PLANO mudou (fingerprint ≠ o último anunciado nesta conversa).
    let (prompt, announced_fp) = compose_mcp_preamble(
        prompt,
        work_gateway.is_some(),
        &mcp_plan,
        caps,
        resume.is_some(),
        mcp_fingerprint.as_deref(),
    );
    // O carimbo do anúncio (`mcp://announced` → ledger do front) NÃO sai aqui:
    // só depois do run NASCER (item 2 do review gate) — spawn que falha não
    // pode carimbar um anúncio que o modelo nunca viu (senão o próximo turno
    // silenciava um plano jamais entregue). Ver emit_mcp_announced abaixo.
    // H1 — roteia o conteúdo de sistema pelo canal declarado (fail-open: sem
    // canal, dobra no corpo AQUI, antes de qualquer transporte — cobre também
    // o app-server do codex, que não passa pelo build_command).
    let (system_prompt, prompt) = adapters::route_system_prompt(caps, system_prompt, prompt);
    // Fronteira do slug de modelo: a partir daqui o valor vira `--model <slug>`
    // (claude/agy), `-c model=` (codex exec) ou campo JSON (app-server) — três
    // transportes, uma regra só. Slug com espaço/TAB/quebra de linha é resto de
    // parse mal feito e o CLI recusa com erro cru; recusamos ANTES, com a frase
    // que diz o que fazer. Fail-closed no efeito (nada é spawnado).
    if let Err(message) = adapters::validate_model_slug(model.as_deref()) {
        let _ = on_event.send(AgentEvent::Error { message });
        let _ = on_event.send(AgentEvent::Done { code: None });
        return Ok(());
    }
    let req = RunRequest {
        prompt,
        system_prompt,
        cwd,
        resume,
        memory_fallback,
        permission,
        model,
        effort,
        attachments: used,
        extra_dirs,
        approval,
        context_gateway,
        work_gateway,
        mcp_plan,
        plan_first: plan_first.unwrap_or(false),
        usage_baseline,
    };
    // Codex no modo Padrão: transporte `codex app-server` (JSON-RPC no stdio) —
    // o ÚNICO em que o Codex PEDE aprovação. O `codex exec` é mão única: sem
    // `--ask-for-approval` e sem TTY ele nunca pausa, então "Padrão" no Codex
    // mudava só o confinamento e nunca perguntava nada. Os outros modos seguem no
    // `exec` (battle-tested): nenhum deles precisa de gate, e o app-server ainda é
    // `[experimental]` na CLI. `plan_first` também fica no exec — o turno de plano
    // é read-only, não há o que aprovar.
    // Falha ANTES do turno (spawn/handshake/thread) cai no `exec` com aviso: o
    // usuário perde o gate naquele turno, nunca o turno.
    if agent == "codex" && matches!(permission, adapters::Permission::Padrao) && !req.plan_first {
        let out = crate::codex_appserver::run(
            &app,
            &run_id,
            &conv_id,
            &req,
            adapters::codex_cost_model(req.model.as_deref()),
            &on_event,
            &notify,
            registry.inner(),
            pending_approvals.inner().clone(),
        )
        .await;
        match out.startup_error {
            None => {
                // O run do app-server NASCEU (handshake + turno enviados): o
                // anúncio de MCP do preâmbulo foi entregue → carimba o ledger.
                emit_mcp_announced(&app, &conv_id, &announced_fp);
                if out.cancelled {
                    let _ = on_event.send(AgentEvent::Cancelled);
                }
                let _ = on_event.send(AgentEvent::Done { code: Some(0) });
                return Ok(());
            }
            Some(e) => {
                log::warn!("codex app-server indisponível ({e}); caindo no `codex exec`");
                let _ = on_event.send(AgentEvent::Notice {
                    message: "Codex app-server indisponível: segui no modo antigo (este turno NÃO vai pedir permissão).".to_string(),
                });
            }
        }
    }

    let resume_was = req.resume.is_some();
    let cmd = adapter.build_command(&req)?;
    let mut outcome = match run_once(
        cmd,
        resume_was,
        &on_event,
        &mut adapter,
        &notify,
        registry.inner(),
        &run_id,
    )
    .await
    {
        Ok(outcome) => outcome,
        // Falha antes de existir stream (binário/PATH/spawn/pipe) também precisa
        // virar item persistido e acionável: só um toast não oferece revezamento.
        // Nota H2: aqui o run NÃO nasceu → o `mcp://announced` não é emitido, o
        // ledger fica intacto e o próximo turno re-anuncia (item 2 do review).
        Err(message) => {
            let _ = on_event.send(AgentEvent::Error { message });
            let _ = on_event.send(AgentEvent::Done { code: None });
            return Ok(());
        }
    };
    // O run nasceu (spawn ok e stream consumido): o preâmbulo com o anúncio
    // chegou ao CLI → carimba o ledger do front. Vale também pro caminho de
    // restart pós-resume-falho logo abaixo: o prompt recomposto carrega o
    // MESMO anúncio, então o carimbo é idêntico.
    emit_mcp_announced(&app, &conv_id, &announced_fp);

    // Degradação graciosa: se o resume falhou porque a sessão sumiu (CLI limpou a
    // sessão, ou conversa legada), em vez de ERRO o app recomeça SEM resume + avisa.
    // Nunca trava o turno. (A SessionNotFound já foi suprimida dentro do run_once.)
    if outcome.session_not_found && !outcome.cancelled {
        // UM aviso só: antes disto o front mandava um SEGUNDO (+ toast) quando
        // memory_fallback existia, e como isso é o caso comum os dois quase
        // sempre apareciam empilhados dizendo a mesma coisa com pesos iguais
        // (achado real do usuário, 18/08/2026). O fato de ter (ou não) memória
        // pra recompor já é conhecido AQUI — não precisa de um segundo evento.
        let used_memory = req.memory_fallback.is_some();
        let message = if used_memory {
            "Sessão anterior não encontrada; retomei com a memória do Frota."
        } else {
            "Sessão anterior não encontrada. Comecei uma nova."
        };
        let _ = on_event.send(AgentEvent::Notice {
            message: message.to_string(),
        });
        // "MyCockpit resume": avisa o front que o resume nativo falhou e o run
        // recomeçou (ZERA o session_id da conversa). SÓ é emitido neste
        // caminho — quando o resume funciona, nada disso acontece.
        let _ = app.emit(
            "resume://fallback",
            serde_json::json!({
                "conv_id": conv_id,
                "run_id": run_id,
                "used_memory": used_memory,
            }),
        );
        let mut req2 = req;
        req2.resume = None;
        // Thread nova: o acumulado da thread que sumiu não descreve mais nada
        // (ADR-033). Mantê-lo faria o 1º turno da thread nova sair de graça.
        req2.usage_baseline = None;
        // Fallback de memória: o recap do front entra ANTES do prompt original,
        // p/ o run recomeçado não esquecer a conversa. Sem fallback, prompt intacto.
        req2.prompt = restart_prompt(req2.memory_fallback.as_deref(), &req2.prompt);
        let mut adapter2 = adapters::resolve(&agent)?;
        let cmd2 = adapter2.build_command(&req2)?;
        outcome = match run_once(
            cmd2,
            false,
            &on_event,
            &mut adapter2,
            &notify,
            registry.inner(),
            &run_id,
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(message) => {
                let _ = on_event.send(AgentEvent::Error { message });
                let _ = on_event.send(AgentEvent::Done { code: None });
                return Ok(());
            }
        };
    }

    if outcome.cancelled {
        let _ = on_event.send(AgentEvent::Cancelled);
    } else if let Some(event) = process_failure_fallback(&*adapter, &agent, &outcome) {
        let _ = on_event.send(event);
    }
    let _ = on_event.send(AgentEvent::Done { code: outcome.code });
    Ok(())
}

/// Preâmbulo "Ferramentas MCP desta sessão" do prompt, comum aos dois motores.
///
/// O anúncio dos MCPs externos existe porque o Codex não enumera os servidores
/// configurados quando perguntado em abstrato (openai/codex#29146): sem o nome
/// de runtime no prompt, o modelo responde "não há MCPs" mesmo com o servidor
/// funcionando. As linhas são factuais, sem instruir uso.
///
/// Cadência H2 (prompt-hygiene-plan), decidida por capability:
/// - `system_channel` → corpo SEMPRE limpo (o adapter re-envia anúncio e
///   telemetria pelo canal system a cada spawn);
/// - `session_resume` sem canal (codex) → tudo no 1º turno da sessão; turno
///   com resume só re-anuncia MCP quando o PLANO mudou (fingerprint ≠ último
///   anunciado — devolvido em `.1` pro front carimbar via `mcp://announced`);
/// - sem resume (agy) → todo turno (custo honesto registrado no plano).
///
/// Fail-open: sem plano gerenciado com servidores selecionados, o texto do 1º
/// turno é byte a byte o de sempre. Puro de propósito (testável).
fn compose_mcp_preamble(
    prompt: String,
    has_work_gateway: bool,
    mcp_plan: &crate::mcp_control::McpRunPlan,
    caps: &adapters::Capabilities,
    resuming: bool,
    last_fingerprint: Option<&str>,
) -> (String, Option<String>) {
    if caps.system_channel {
        return (prompt, None);
    }
    // Sem resume, toda sessão é nova: a régua do "1º turno" vale sempre.
    let first_turn = !resuming || !caps.session_resume;
    let fingerprint = mcp_plan.fingerprint();
    let announce_mcp = match fingerprint.as_deref() {
        None => false,
        Some(fp) => {
            if mcp_plan.selected.is_empty() {
                // Plano gerenciado VAZIO só é notícia na TRANSIÇÃO N→0 (o
                // modelo já viu um plano diferente nesta conversa e chamaria
                // tool morta). Sem histórico carimbado (1º turno, restart),
                // não há o que desmentir — corpo byte-idêntico ao de sempre.
                last_fingerprint.is_some() && last_fingerprint != Some(fp)
            } else {
                first_turn || last_fingerprint != Some(fp)
            }
        }
    };
    let mut sections = Vec::new();
    if announce_mcp {
        if mcp_plan.selected.is_empty() {
            sections.push(
                "Ferramentas MCP desta sessão: nenhuma. Os MCPs externos anunciados antes foram desligados; não chame mais as tools deles."
                    .to_string(),
            );
        } else {
            let lines: Vec<String> = mcp_plan
                .selected
                .iter()
                .map(|server| {
                    format!(
                        "- {}: {} (MCP externo roteado pelo MyCockpit)",
                        server.runtime_name, server.display_name
                    )
                })
                .collect();
            sections.push(format!(
                "Ferramentas MCP desta sessão:\n{}",
                lines.join("\n")
            ));
        }
    }
    if has_work_gateway && first_turn {
        sections.push(format!(
            "TELEMETRIA DE TRABALHO: para processos longos (dev servers, watchers, containers), use o MCP `{}` / `{}` em vez de deixá-los presos numa shell comum. Em tarefas com várias etapas, publique o plano por `{}` e mantenha cada etapa atualizada ao iniciar/concluir por `{}`. Se usar a checklist nativa do provider, atualize os estados equivalentes também. Isso dá ao usuário visibilidade e controles honestos no MyCockpit.",
            crate::work_gateway::MCP_SERVER_NAME,
            crate::work_gateway::PROCESS_START_TOOL,
            crate::work_gateway::WORK_PLAN_TOOL,
            crate::work_gateway::WORK_UPDATE_TOOL,
        ));
    }
    let announced = if announce_mcp { fingerprint } else { None };
    if sections.is_empty() {
        return (prompt, announced);
    }
    (
        format!("{}\n\n---\n\n{prompt}", sections.join("\n\n")),
        announced,
    )
}

/// H2 — carimbo do anúncio de MCP no ledger do front (`mcp://announced` →
/// `injected.mcp` da conversa). Chamado SÓ depois do run nascer (spawn ok no
/// exec, handshake ok no app-server): spawn falho não carimba, e o próximo
/// turno re-anuncia. Janela residual aceita (registrada no plano): processo
/// que nasce mas morre antes de o modelo processar o prompt ainda carimba — o
/// custo é um anúncio silenciado até a próxima mudança de plano, nunca um
/// carimbo de run que não existiu.
fn emit_mcp_announced(app: &tauri::AppHandle, conv_id: &str, announced: &Option<String>) {
    if let Some(fp) = announced {
        let _ = app.emit(
            "mcp://announced",
            serde_json::json!({ "conv_id": conv_id, "fingerprint": fp }),
        );
    }
}

/// Prompt do run RECOMEÇADO após o resume nativo falhar (degradação graciosa):
/// com fallback de memória (recap + ponteiro pro transcript, montado pelo front),
/// ele vem ANTES do prompt original, separado por `---`; sem fallback, o prompt
/// original segue intacto (comportamento antigo). Puro de propósito (testável).
fn restart_prompt(memory_fallback: Option<&str>, original: &str) -> String {
    match memory_fallback {
        Some(fallback) => format!("{fallback}\n\n---\n\n{original}"),
        None => original.to_string(),
    }
}

/// Resultado de UMA tentativa de run (sem emitir os eventos terminais).
struct Outcome {
    cancelled: bool,
    success: bool,
    code: Option<i32>,
    stderr: String,
    session_not_found: bool,
    /// O stream já publicou uma causa terminal acionável (`Error` ou
    /// `LimitReached`). O exit code continua em `Done`, mas não pode fabricar um
    /// segundo incidente visual para a mesma falha.
    terminal_incident: bool,
}

/// Fallback terminal do runner. A classificação das frases continua no adapter;
/// o runner só aplica a precedência agnóstica: um terminal estruturado do stream
/// vence stderr e exit code genérico.
fn process_failure_fallback(
    adapter: &dyn adapters::AgentAdapter,
    agent: &str,
    outcome: &Outcome,
) -> Option<AgentEvent> {
    if outcome.cancelled || outcome.success || outcome.terminal_incident {
        return None;
    }
    let msg = if outcome.stderr.trim().is_empty() {
        format!(
            "o agent `{agent}` saiu com código {}",
            outcome.code.unwrap_or(-1)
        )
    } else {
        outcome.stderr.trim().to_string()
    };
    if let Some(hit) = adapter.classify_limit(&msg) {
        Some(AgentEvent::LimitReached {
            message: msg,
            reset_hint: hit.reset_hint,
        })
    } else {
        Some(AgentEvent::Error { message: msg })
    }
}

fn is_terminal_incident(event: &AgentEvent) -> bool {
    matches!(
        event,
        AgentEvent::LimitReached { .. } | AgentEvent::Error { .. }
    )
}

/// Spawn + loop (streama os eventos) + wait, UMA vez. NÃO emite Cancelled/Error/
/// Done, quem orquestra (run_agent) decide, p/ poder reexecutar sem resume na
/// degradação graciosa. Num resume, intercepta SessionNotFound (suprime + marca).
async fn run_once(
    mut cmd: Command,
    resume_is_some: bool,
    on_event: &Channel<AgentEvent>,
    adapter: &mut Box<dyn adapters::AgentAdapter>,
    notify: &Arc<Notify>,
    registry: &RunRegistry,
    run_id: &str,
) -> Result<Outcome, String> {
    // stdin null é OBRIGATÓRIO: sem isso o `codex exec` trava lendo stdin
    // (verificado). Inofensivo p/ o Claude (que não lê stdin em -p).
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // filho morre se o future for dropado (não cobre process::exit; o
        // kill_all no hook de saída do app cobre esse caso).
        .kill_on_drop(true);
    // Correlação dos hooks de status (hooks-plan §4.7): o hook global herda
    // esta env e a manda num header — run NOSSO nunca vira "sessão externa"
    // no Painel. Inofensiva sem hooks instalados (ninguém a lê).
    crate::hook_sessions::correlate_run(&mut cmd, run_id);

    let bin = adapter.id();
    let mut child = cmd.spawn().map_err(|e| {
        format!("não consegui executar o agent `{bin}`: {e}. Ele está instalado e no PATH?")
    })?;
    // pid no registry: o hook de saída mata todos (órfãos de Cmd-Q). O RunGuard
    // do run_agent limpa a entrada em qualquer saída.
    if let Some(pid) = child.id() {
        if let Ok(mut pids) = registry.1.lock() {
            pids.insert(run_id.to_string(), pid);
        }
    }

    let stdout = child.stdout.take().ok_or("sem stdout do processo")?;
    let stderr = child.stderr.take();
    let mut reader = BufReader::new(stdout).lines();

    // H3, coleta o stderr em paralelo p/ reportar erros de processo.
    let stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        if let Some(se) = stderr {
            let mut lines = BufReader::new(se).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                buf.push_str(&l);
                buf.push('\n');
            }
        }
        buf
    });

    // H1, o `notify` é registrado/desregistrado no run_agent (RunGuard); aqui só
    // escutamos o sinal. Reusar o MESMO Arc entre as tentativas retém o cancel.
    let mut cancelled = false;
    let mut session_not_found = false;
    let mut terminal_incident = false;
    loop {
        tokio::select! {
            line = reader.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        // O adapter decide como tratar a linha crua: estruturados
                        // (Claude/Codex) parseiam JSON → map_line; não-estruturados
                        // (agy) tratam como texto. Default preserva o comportamento
                        // antigo (JSON→map_line, senão Unknown; regra de ouro).
                        for ev in adapter.on_stdout_line(&line) {
                            if matches!(ev, AgentEvent::SessionNotFound { .. }) {
                                if resume_is_some {
                                    session_not_found = true; // suprime + retry
                                } else if let AgentEvent::SessionNotFound { message } = ev {
                                    let _ = on_event.send(AgentEvent::Error { message });
                                    terminal_incident = true;
                                }
                                continue;
                            }
                            terminal_incident |= is_terminal_incident(&ev);
                            let _ = on_event.send(ev);
                        }
                    }
                    Ok(None) => break, // EOF, processo terminou
                    Err(_) => break,
                }
            }
            _ = notify.notified() => {
                cancelled = true;
                // SIGKILL no processo; a sessão segue resumível via resume.
                let _ = child.start_kill();
                break;
            }
        }
    }

    // Flush de itens pendentes (begin sem end) só no fim normal, não no cancel.
    if !cancelled {
        for ev in adapter.on_close() {
            terminal_incident |= is_terminal_incident(&ev);
            let _ = on_event.send(ev);
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let stderr_text = stderr_task.await.unwrap_or_default();

    // Codex reporta sessão inexistente no STDERR ("no rollout found for thread id"),
    // não no stream JSON → detecta aqui também p/ a degradação graciosa pegar Codex.
    if resume_is_some
        && !cancelled
        && !session_not_found
        && adapter.is_session_not_found(&stderr_text)
    {
        session_not_found = true;
    }

    Ok(Outcome {
        cancelled,
        success: status.success(),
        code: status.code(),
        stderr: stderr_text,
        session_not_found,
        terminal_incident,
    })
}

/// Cancela um run em andamento (H1), sinaliza o loop, que mata o processo.
#[tauri::command]
pub fn cancel_agent(run_id: String, registry: tauri::State<'_, RunRegistry>) {
    if let Ok(map) = registry.0.lock() {
        if let Some(n) = map.get(&run_id) {
            n.notify_one();
        }
    }
}

/// Resultado do juiz do Fusion: o texto da decisão (JSON do juiz) + custo Reported.
#[derive(Serialize)]
pub struct JudgeResult {
    pub text: String,
    pub cost_usd: Option<f64>,
}

/// Builder comum dos one-shots `claude -p` (juiz + sugestões): SEM tools, sem
/// persistir sessão. `format` = "json" (juiz: captura `total_cost_usd`) ou "text"
/// (sugestões). `no_mcp` desliga TODO MCP (`--tools ""` não cobre MCP) — juiz E
/// suggest passam `true` hoje: one-shot é meta-tarefa, nunca pode agir.
/// NÃO usa `--bare`: esse modo "minimal" pula as credenciais e cai em "Not logged in".
fn claude_oneshot(model: &str, cwd: &str, prompt: &str, format: &str, no_mcp: bool) -> Command {
    let mut cmd = Command::new("claude");
    cmd.arg("-p")
        .arg(prompt)
        .arg("--model")
        .arg(model)
        .arg("--tools")
        .arg("")
        .arg("--output-format")
        .arg(format)
        .arg("--no-session-persistence")
        .current_dir(cwd)
        .stdin(Stdio::null());
    // Correlação dos hooks de status (hooks-plan §4.7): meta-tarefa do app
    // (juiz do Fusion, sugestões). Se o usuário instalou os hooks globais do
    // claude, este `claude -p` também os dispara — sem a env herdada, o
    // gateway trataria o POST como sessão EXTERNA e o Painel/tray mostraria um
    // fantasma "No terminal · trabalhando" na pasta do projeto. "oneshot" é a
    // sentinela (o gateway só exige NÃO-VAZIO).
    crate::hook_sessions::correlate_run(&mut cmd, "oneshot");
    if no_mcp {
        cmd.arg("--strict-mcp-config")
            .arg("--mcp-config")
            .arg("{\"mcpServers\":{}}");
    }
    cmd
}

/// Juiz do Fusion: roda um modelo forte SEM tools e SEM MCP, com `--output-format
/// json` (→ captura `total_cost_usd` Reported). Retorna o texto (a decisão do juiz,
/// que o front parseia) + o custo. (Cancelável fica p/ a robustez, Sprint 4.)
#[tauri::command]
pub async fn judge(model: String, cwd: String, prompt: String) -> Result<JudgeResult, String> {
    let out = claude_oneshot(&model, &cwd, &prompt, "json", true)
        .output()
        .await
        .map_err(|e| format!("falha ao rodar o juiz: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    // Antes de parsear: se o processo falhou (rate-limit/login/modelo inválido),
    // surfaça a causa REAL (stderr→stdout) em vez de mascarar como "envelope inválido".
    if !out.status.success() {
        let msg = stderr.trim();
        let msg = if msg.is_empty() { stdout.trim() } else { msg };
        return Err(if msg.is_empty() {
            "o juiz saiu com código de erro".into()
        } else {
            msg.to_string()
        });
    }
    let env: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("juiz: envelope JSON inválido: {e}"))?;
    Ok(JudgeResult {
        text: env
            .get("result")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        cost_usd: env.get("total_cost_usd").and_then(|x| x.as_f64()),
    })
}

/// Helper one-shot (Sprint 3): roda um modelo barato (ex. `haiku`) SEM tools,
/// sem persistir sessão, p/ meta-tarefas (sugestões/títulos). Retorna o texto puro.
/// `no_mcp=true` (S4, revisão): `--tools ""` NÃO cobre MCP — com um server de
/// escopo user carregado, o one-shot poderia AGIR (inclusive agendado, sem humano
/// olhando: lead propositor). Nenhum uso do suggest precisa de MCP (lead,
/// distillLesson, draftSkill, sugestões) — todos são texto puro.
#[tauri::command]
pub async fn suggest(model: String, cwd: String, prompt: String) -> Result<String, String> {
    let out = claude_oneshot(&model, &cwd, &prompt, "text", true)
        .output()
        .await
        .map_err(|e| format!("falha ao rodar claude: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    // Surfaça stdout no erro também: o "Not logged in" do claude sai no stdout.
    if !out.status.success() {
        let msg = if !stderr.is_empty() { stderr } else { stdout };
        return Err(if msg.is_empty() {
            "claude saiu com código de erro".into()
        } else {
            msg
        });
    }
    Ok(stdout)
}

#[cfg(test)]
mod tests {
    use super::{
        claude_oneshot, compose_mcp_preamble, process_failure_fallback, restart_prompt,
        AgentEvent, Outcome,
    };

    /// S4 (revisão D1): `--tools ""` NÃO cobre MCP — o one-shot com
    /// `no_mcp=true` TEM que carregar o strict-mcp-config vazio, senão um MCP
    /// server de escopo user com tools de efeito colateral deixaria o lead
    /// agendado AGIR sem humano olhando.
    #[test]
    fn oneshot_no_mcp_estripa_todo_mcp() {
        let cmd = claude_oneshot("haiku", "/tmp", "oi", "text", true);
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert!(args.iter().any(|a| a == "--strict-mcp-config"));
        let pos = args.iter().position(|a| a == "--mcp-config").unwrap();
        assert_eq!(args[pos + 1], "{\"mcpServers\":{}}");
        // e segue sem tools nativas também
        let tools = args.iter().position(|a| a == "--tools").unwrap();
        assert_eq!(args[tools + 1], "");
    }

    /// Regressão do fantasma (hooks-plan §4.7): TODA meta-tarefa `claude -p`
    /// (juiz do Fusion, sugestões) tem que carregar MYCOCKPIT_RUN_ID — senão,
    /// com hooks de status instalados, o POST chega ao gateway sem o header e
    /// o Painel/tray mostram uma sessão EXTERNA fantasma na pasta do projeto
    /// (dupla contagem da própria meta-tarefa do app). Vale pros dois formatos.
    #[test]
    fn oneshot_carrega_run_env_pra_nao_virar_sessao_fantasma() {
        for format in ["json", "text"] {
            let cmd = claude_oneshot("haiku", "/tmp", "oi", format, true);
            let env = cmd
                .as_std()
                .get_envs()
                .find(|(k, _)| *k == std::ffi::OsStr::new(crate::hook_sessions::RUN_ENV))
                .and_then(|(_, v)| v)
                .map(|v| v.to_string_lossy().into_owned());
            assert_eq!(
                env.as_deref(),
                Some("oneshot"),
                "meta-tarefa {format} sem RUN_ENV vira fantasma no Painel"
            );
        }
    }

    /// Caps de um motor 1º-turno-só (corpo do prompt, com resume): o codex.
    fn caps_corpo() -> &'static crate::adapters::Capabilities {
        crate::adapters::capabilities_of("codex").unwrap()
    }

    fn plano_playwright() -> crate::mcp_control::McpRunPlan {
        crate::mcp_control::McpRunPlan {
            managed: true,
            selected: vec![crate::mcp_control::McpRuntimeServer {
                runtime_name: "playwright".into(),
                display_name: "Playwright".into(),
                launch: Default::default(),
            }],
            ..Default::default()
        }
    }

    #[test]
    fn preambulo_sem_plano_gerenciado_e_byte_identico_ao_de_hoje() {
        // Fail-open: run não gerenciado não muda um byte do prompt do 1º turno.
        let plan = crate::mcp_control::McpRunPlan::default();
        assert_eq!(
            compose_mcp_preamble("faça X".into(), false, &plan, caps_corpo(), false, None),
            ("faça X".to_string(), None)
        );
        let (com_work, fp) =
            compose_mcp_preamble("faça X".into(), true, &plan, caps_corpo(), false, None);
        assert!(com_work.starts_with("TELEMETRIA DE TRABALHO: "));
        assert!(com_work.ends_with("\n\n---\n\nfaça X"));
        assert!(!com_work.contains("Ferramentas MCP desta sessão"));
        assert_eq!(fp, None, "sem MCP selecionado não há o que carimbar");
        // Gerenciado mas sem selecionado (tudo caiu em notice): idem.
        let vazio = crate::mcp_control::McpRunPlan {
            managed: true,
            ..Default::default()
        };
        assert_eq!(
            compose_mcp_preamble("faça X".into(), false, &vazio, caps_corpo(), false, None),
            ("faça X".to_string(), None)
        );
    }

    #[test]
    fn preambulo_gerenciado_anuncia_runtime_e_display_de_cada_mcp() {
        let plan = plano_playwright();
        let (out, fp) =
            compose_mcp_preamble("faça X".into(), true, &plan, caps_corpo(), false, None);
        assert!(out.starts_with(
            "Ferramentas MCP desta sessão:\n- playwright: Playwright (MCP externo roteado pelo MyCockpit)"
        ));
        // Bloco único: o anúncio e a telemetria do mc-work compartilham o
        // mesmo preâmbulo, com um único separador antes do prompt.
        assert!(out.contains("TELEMETRIA DE TRABALHO: "));
        assert_eq!(out.matches("\n\n---\n\n").count(), 1);
        assert!(out.ends_with("\n\n---\n\nfaça X"));
        assert_eq!(fp, plan.fingerprint(), "anunciou → devolve o carimbo");
    }

    /// H2 — motor com resume (codex): o 2º turno da MESMA sessão não repete
    /// nem o anúncio nem a telemetria (o resume carrega o 1º turno).
    #[test]
    fn preambulo_com_resume_nao_repete_nudge_nem_anuncio() {
        let plan = plano_playwright();
        let last = plan.fingerprint();
        let (out, fp) = compose_mcp_preamble(
            "continua".into(),
            true,
            &plan,
            caps_corpo(),
            true,
            last.as_deref(),
        );
        assert_eq!(out, "continua", "corpo limpo: o resume já carrega o preâmbulo");
        assert_eq!(fp, None, "nada anunciado, nada a carimbar");
    }

    /// H2 — o PLANO mudou mid-conversa (usuário ligou um binding): o turno com
    /// resume re-anuncia SÓ o bloco de MCPs (a telemetria não muda, não volta).
    #[test]
    fn preambulo_reanuncia_quando_o_plano_de_mcp_muda() {
        let plan = plano_playwright();
        let (out, fp) = compose_mcp_preamble(
            "continua".into(),
            true,
            &plan,
            caps_corpo(),
            true,
            Some("fingerprint-do-plano-antigo"),
        );
        assert!(out.starts_with("Ferramentas MCP desta sessão:"));
        assert!(out.contains("- playwright: Playwright"));
        assert!(
            !out.contains("TELEMETRIA DE TRABALHO"),
            "telemetria é 1º-turno-só: o plano mudar não a traz de volta"
        );
        assert_eq!(fp, plan.fingerprint(), "re-anunciou → carimbo novo");
        // fingerprint desconhecido (restart do app zerou o ledger efêmero):
        // anuncia também — fail-open pra visibilidade, converge em 1 turno.
        let (out2, _) =
            compose_mcp_preamble("continua".into(), false, &plan, caps_corpo(), true, None);
        assert!(out2.starts_with("Ferramentas MCP desta sessão:"));
    }

    /// H2 (review gate, item 3) — desligar TODOS os bindings também é mudança
    /// de plano: N→0 re-anuncia UMA vez ("nenhuma", pro modelo não chamar tool
    /// morta) e carimba; 0→0 não repete; e 0 sem histórico (1º turno/restart)
    /// segue byte-idêntico ao de sempre (não há anúncio anterior a desmentir).
    #[test]
    fn preambulo_reanuncia_n_para_zero_e_silencia_zero_para_zero() {
        let cheio = plano_playwright();
        let vazio = crate::mcp_control::McpRunPlan {
            managed: true,
            ..Default::default()
        };
        // N→0: o último carimbo é do plano CHEIO → anuncia o desligamento
        let last_cheio = cheio.fingerprint();
        let (out, fp) = compose_mcp_preamble(
            "continua".into(),
            false,
            &vazio,
            caps_corpo(),
            true,
            last_cheio.as_deref(),
        );
        assert!(out.contains("Ferramentas MCP desta sessão: nenhuma"));
        assert!(out.contains("não chame mais as tools deles"));
        assert_eq!(fp, vazio.fingerprint(), "anunciou o vazio → carimbo do vazio");
        // 0→0: o carimbo já é o do vazio → silêncio
        let last_vazio = vazio.fingerprint();
        let (out2, fp2) = compose_mcp_preamble(
            "continua".into(),
            false,
            &vazio,
            caps_corpo(),
            true,
            last_vazio.as_deref(),
        );
        assert_eq!(out2, "continua");
        assert_eq!(fp2, None);
        // 0 sem histórico (1º turno, ou restart com ledger zerado): sem
        // anúncio — não há anúncio anterior a desmentir, corpo byte-idêntico.
        for resuming in [false, true] {
            let (out3, fp3) = compose_mcp_preamble(
                "faça X".into(),
                false,
                &vazio,
                caps_corpo(),
                resuming,
                None,
            );
            assert_eq!(out3, "faça X");
            assert_eq!(fp3, None);
        }
        // e 0→algo: ligar um binding depois do desligamento re-anuncia o cheio
        let (out4, fp4) = compose_mcp_preamble(
            "continua".into(),
            false,
            &cheio,
            caps_corpo(),
            true,
            last_vazio.as_deref(),
        );
        assert!(out4.starts_with("Ferramentas MCP desta sessão:\n- playwright"));
        assert_eq!(fp4, cheio.fingerprint());
    }

    /// H2 — motor com canal system (claude): o corpo fica SEMPRE limpo; o
    /// anúncio e a telemetria já viajam no `--append-system-prompt` do adapter,
    /// re-enviados a cada spawn.
    #[test]
    fn preambulo_some_do_corpo_em_motor_com_canal_system() {
        let caps = crate::adapters::capabilities_of("claude-code").unwrap();
        assert!(caps.system_channel);
        let plan = plano_playwright();
        for resuming in [false, true] {
            let (out, fp) =
                compose_mcp_preamble("faça X".into(), true, &plan, caps, resuming, None);
            assert_eq!(out, "faça X");
            assert_eq!(fp, None);
        }
    }

    /// H2 — motor sem canal E sem resume: toda sessão é nova, o preâmbulo
    /// volta em todo turno (custo honesto; não há alternativa).
    ///
    /// As capabilities aqui são SINTÉTICAS de propósito. O agy era o exemplo
    /// vivo desta terceira cadência até a 1.1.13 destravar
    /// `--conversation <ID>` (medido 14/08/2026, ver AGY_CAPS) — e hoje nenhum
    /// motor registrado cai neste ramo. O ramo continua no código porque o
    /// próximo motor pode cair nele, então continua testado: amarrar o teste a
    /// um agent registrado foi o que fez ele quebrar quando a VERDADE do CLI
    /// mudou, sendo que o comportamento sob teste não mudou nada.
    #[test]
    fn preambulo_sem_resume_volta_em_todo_turno() {
        let sem_canal_nem_resume = crate::adapters::Capabilities {
            system_channel: false,
            session_resume: false,
            ..crate::adapters::AGY_CAPS
        };
        let caps = &sem_canal_nem_resume;
        let plan = plano_playwright();
        let last = plan.fingerprint();
        let (out, _) = compose_mcp_preamble(
            "continua".into(),
            true,
            &plan,
            caps,
            true,
            last.as_deref(),
        );
        assert!(out.starts_with("Ferramentas MCP desta sessão:"));
        assert!(out.contains("TELEMETRIA DE TRABALHO"));
    }

    #[test]
    fn restart_sem_fallback_mantem_prompt_original() {
        assert_eq!(
            restart_prompt(None, "continue a tarefa"),
            "continue a tarefa"
        );
    }

    #[test]
    fn restart_com_fallback_prefixa_recap_com_separador() {
        let recap = "Recap: estávamos revisando o adapter do Codex.\nTranscript: .mycockpit/transcripts/abc.jsonl";
        assert_eq!(
            restart_prompt(Some(recap), "continue a tarefa"),
            format!("{recap}\n\n---\n\ncontinue a tarefa")
        );
    }

    #[test]
    fn restart_com_fallback_vazio_ainda_prefixa() {
        // String vazia é responsabilidade do front não mandar; se mandar, o
        // separador ainda delimita (nunca corrompe o prompt original).
        assert_eq!(restart_prompt(Some(""), "oi"), "\n\n---\n\noi");
    }

    #[test]
    fn terminal_estruturado_tem_precedencia_sobre_exit_code_e_stderr() {
        let adapter = crate::adapters::resolve("claude-code").unwrap();
        let outcome = Outcome {
            cancelled: false,
            success: false,
            code: Some(1),
            stderr: "erro secundário do processo".into(),
            session_not_found: false,
            terminal_incident: true,
        };

        assert!(process_failure_fallback(&*adapter, "claude-code", &outcome).is_none());
    }

    #[test]
    fn runner_classifica_stderr_no_adapter_quando_stream_nao_teve_terminal() {
        let adapter = crate::adapters::resolve("claude-code").unwrap();
        let outcome = Outcome {
            cancelled: false,
            success: false,
            code: Some(1),
            stderr: "You've hit your session limit · resets 1:50pm (America/Sao_Paulo)".into(),
            session_not_found: false,
            terminal_incident: false,
        };

        assert!(matches!(
            process_failure_fallback(&*adapter, "claude-code", &outcome),
            Some(AgentEvent::LimitReached {
                reset_hint: Some(reset),
                ..
            }) if reset == "1:50pm (America/Sao_Paulo)"
        ));
    }

    #[test]
    fn runner_mantem_erro_generico_quando_nao_ha_terminal_nem_limite() {
        let adapter = crate::adapters::resolve("claude-code").unwrap();
        let outcome = Outcome {
            cancelled: false,
            success: false,
            code: Some(17),
            stderr: String::new(),
            session_not_found: false,
            terminal_incident: false,
        };

        assert!(matches!(
            process_failure_fallback(&*adapter, "claude-code", &outcome),
            Some(AgentEvent::Error { message })
                if message == "o agent `claude-code` saiu com código 17"
        ));
    }
}
