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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{Emitter, Manager};
use tokio::process::Command;
use tokio::sync::Notify;

/// Registro de runs ativos → cancelar um run (H1) e matar TODOS na saída do app
/// (sem isso, Cmd-Q no meio de um run deixa claude/codex órfãos rodando headless,
/// possivelmente editando o repo e gastando tokens sem ninguém olhar).
/// `.0`: run_id → sinal de cancelamento; `.1`: run_id → pid do processo vivo;
/// `.3`: fronteira de admissão fechada durante o teardown.
pub struct RunRegistry(
    pub Mutex<HashMap<String, Arc<Notify>>>,
    pub Mutex<HashMap<String, u32>>,
    /// A trava de sono (ADR-081). Mora AQUI porque o ciclo de vida dela é
    /// exatamente o dos runs — e assim ela é reavaliada nos mesmos dois pontos
    /// em que o mapa muda, incluindo o `RunGuard`, que dispara em toda saída.
    pub crate::despertador::Despertador,
    /// Fecha a fronteira de admissão antes do primeiro sinal de teardown.
    AtomicBool,
);

impl Default for RunRegistry {
    fn default() -> Self {
        Self(
            Mutex::new(HashMap::new()),
            Mutex::new(HashMap::new()),
            crate::despertador::Despertador::default(),
            AtomicBool::new(true),
        )
    }
}

impl RunRegistry {
    /// Quantos runs vivos. É a contagem que decide a trava de sono.
    pub fn ativos(&self) -> usize {
        self.0.lock().map(|m| m.len()).unwrap_or(0)
    }

    pub(crate) fn ensure_accepting(&self) -> Result<(), String> {
        self.3
            .load(Ordering::Acquire)
            .then_some(())
            .ok_or_else(|| "o Frota está encerrando e não pode iniciar outra tarefa".into())
    }

    pub(crate) fn begin_shutdown(&self) {
        self.3.store(false, Ordering::Release);
    }

    pub(crate) fn request_cancel_all(&self) {
        if let Ok(runs) = self.0.lock() {
            for cancel in runs.values() {
                cancel.notify_one();
            }
        }
    }
}

impl RunRegistry {
    /// SIGKILL em todos os processos de agent vivos (hook de saída do app).
    /// Síncrono de propósito: no exit o runtime async pode não rodar mais.
    pub fn kill_all(&self) {
        if let Ok(pids) = self.1.lock() {
            for (run_id, pid) in pids.iter() {
                crate::run_processes::terminate_run(run_id, Some(*pid));
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
        // A trava de sono cai JUNTO com o run, aqui e não no caminho feliz:
        // este Drop roda no sucesso, no erro, no `?` e no cancel. Soltar só
        // quando dá certo é como uma trava vaza.
        self.registry.2.reavalia(self.registry.ativos());
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
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DeferredStatus {
    Running,
    Progress,
    Completed,
    Stopped,
}

/// O QUE é um trabalho diferido, no vocabulário do contrato e não no do motor.
/// Cada adapter traduz o seu (`local_bash`, `local_agent`, `local_workflow` no
/// Claude; comando que cedeu o controle no Codex): código genérico nunca lê o
/// termo cru de um fornecedor. Espelho TS: `DeferredKind` em `src/lib/work.ts`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DeferredKind {
    /// Shell/terminal que segue rodando depois que o motor retomou a conversa.
    Terminal,
    Subagent,
    Workflow,
    /// O motor disse um tipo que o contrato ainda não conhece. Degradação
    /// honesta: aparece como trabalho genérico, nunca como um dos de cima.
    Other,
}

/// Evento normalizado enviado ao frontend.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    /// Manifesto efetivo calculado depois de materializar gateways e aplicar a
    /// policy, antes do spawn. Não contém launch, env, header ou credencial.
    RunManifest {
        manifest: crate::run_manifest::EffectiveRunManifest,
    },
    /// A policy recusou o envio antes do manifesto e antes do spawn. Não é um
    /// erro de execução: o frontend mantém o pedido no composer e apresenta a
    /// decisão humana permitida pelo backend.
    PreflightBlocked {
        gate: crate::mcp_control::McpPreflightGate,
    },
    /// Evidência de que o transporte do provider foi criado e recebeu o pedido.
    /// É a fronteira que autoriza a UI a chamar uma falha posterior de execução.
    Started,
    /// Sonda factual do processo do run. Não é heartbeat nem progresso: o
    /// frontend usa somente para distinguir processo vivo, morto e estado não
    /// confirmável quando o relógio de eventos do agente estoura.
    RunStatus {
        main_alive: Option<bool>,
        descendants: Option<u32>,
        rss_mb: Option<u64>,
        last_byte_at: Option<u64>,
        observed_at: u64,
    },
    /// O manifesto aceitou o pedido, mas nenhum processo de execução nasceu.
    /// Não é incidente terminal e não pode virar `Error` no transcript.
    StartupFailed {
        message: String,
    },
    Session {
        session_id: String,
        model: Option<String>,
        tools: usize,
    },
    /// Inventário de comandos/skills/plugins anunciado pelo motor no início do
    /// run (ADR-189). O loop do runner guarda por projeto e NÃO repassa ao
    /// frontend: é evidência para o composer, não item do fio.
    EngineInventory {
        inventory: crate::command_inventory::ObservedInventory,
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
    /// Pedaço de saída AO VIVO de uma tool que ainda roda (ADR-200). Não é
    /// transcript: o front desvia para o painel Bastidores, com teto, sem
    /// persistir nem re-renderizar o fio. `id` = o mesmo da `Tool`.
    ToolOutput {
        id: String,
        text: String,
    },
    /// Trabalho DIFERIDO do provider (tool `Workflow`, background task): vive
    /// além do turno que o criou (deferred-work-plan, D1). Traduzido dos
    /// eventos `system/task_*` do stream-json do Claude 2.1.219 e da string
    /// `<task-notification>` injetada no `--resume`. `id` = task_id do CLI;
    /// `tool_use_id` liga ao tool_use `Workflow` de origem (Fio Vivo).
    DeferredWork {
        id: String,
        tool_use_id: Option<String>,
        /// Tipo normalizado. `None` = o evento não disse (ex. a notificação
        /// injetada no `--resume`); o front conserva o que já sabia.
        kind: Option<DeferredKind>,
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
        /// Janela efetiva informada pelo runtime nesta sessão. `None` = o
        /// provider não informou; o front pode usar catálogo, mas marca como
        /// estimativa. Nunca se infere a janela a partir do próprio consumo.
        window_tokens: Option<u64>,
    },
    /// O motor deveria medir contexto, mas a fonte confiável não respondeu.
    /// Limpa o snapshot anterior para ele não parecer a medição deste turno.
    ContextUnavailable,
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
        /// Custo ACUMULADO da sessão, como o CLI reportou (ADR-226), só para o
        /// front guardar como base do próximo turno. NUNCA é o número que a
        /// UI/ledger mostra: esse é `cost_usd`, já do turno.
        #[serde(skip_serializing_if = "Option::is_none")]
        reported_cost_total: Option<f64>,
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
fn validate_run_content(prompt: &str, usable_attachments: usize) -> Result<(), String> {
    if prompt.trim().is_empty() && usable_attachments == 0 {
        return Err(
            "o pedido está vazio. Escreva uma instrução ou anexe um arquivo suportado.".to_string(),
        );
    }
    Ok(())
}

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
    // "Frota resume": recap pronto do front (`memoryFallback` no invoke), usado
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
    // Skills de plugin expandidas pelo front. O runner não confia no claim:
    // reabre o pacote e confirma grant, fingerprint e contribution id antes
    // de registrar a origem no manifesto ou iniciar o provider.
    instruction_sources: Option<Vec<crate::run_manifest::InstructionSourceClaim>>,
    // Decisão efêmera sobre um gate anterior. O backend revalida fingerprint,
    // source e policy; não altera o binding salvo.
    mcp_recoveries: Option<Vec<crate::mcp_control::McpRunOverride>>,
    // ADR-033: acumulado de tokens que a THREAD retomada já tinha (`usageBaseline`
    // no invoke; o front persiste por thread o `cumulative_usage` devolvido no
    // Result anterior). Option = invoke antigo/thread nova → None (o turno vale
    // inteiro). Motor que reporta usage por turno ignora.
    usage_baseline: Option<CumulativeUsage>,
    // ADR-226: custo acumulado que a SESSÃO retomada já tinha reportado.
    cost_baseline: Option<f64>,
    // ADR-252: pastas dos arquivos soltos de fora do projeto, só para este run.
    // Option = invoke antigo → None (nenhuma pasta a mais).
    pastas_do_turno: Option<Vec<String>>,
    attachments: Vec<Attachment>,
    on_event: Channel<AgentEvent>,
    registry: tauri::State<'_, RunRegistry>,
    active: tauri::State<'_, ActiveConvs>,
    pending_approvals: tauri::State<'_, std::sync::Arc<crate::approval::PendingApprovals>>,
    process_registry: tauri::State<'_, std::sync::Arc<crate::work_gateway::ProcessRegistry>>,
) -> Result<(), String> {
    registry.ensure_accepting()?;
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
    // Com o run já no mapa: se o modo for "enquanto um agente trabalha", é
    // agora que a máquina para de poder dormir.
    registry.2.reavalia(registry.ativos());
    // anexos: rel→abs + descarta sumidos; particiona por capacidade do agent.
    let used = attachments::do_run(
        &app,
        attachments,
        &agent,
        |k| adapter.supports_attachment(k),
        |message| {
            let _ = on_event.send(AgentEvent::Notice { message });
        },
    );
    // A UI permite turno só com anexo: texto vazio é legítimo quando ao menos
    // um arquivo vivo e suportado chega ao adapter. Sem nenhum conteúdo útil,
    // aborta antes do spawn; stdin é null e omitir o prompt mudaria o modo da CLI.
    validate_run_content(&prompt, used.len())?;
    let instruction_sources = match crate::plugin_contributions::verify_instruction_sources(
        &app,
        instruction_sources.unwrap_or_default(),
    ) {
        Ok(sources) => sources,
        Err(message) => {
            let _ = on_event.send(AgentEvent::Error {
                message: format!("skill de plugin não pôde ser confirmada: {message}"),
            });
            let _ = on_event.send(AgentEvent::Done { code: None });
            return Ok(());
        }
    };
    // F23: marca a conversa como ativa p/ o GC não apagar os blobs durante o run.
    active.insert(&conv_id);
    let _active_guard = ActiveGuard {
        active: active.inner(),
        conv_id: conv_id.clone(), // clone: o restart pós-resume-falho ainda lê conv_id
    };
    // Permissão parseada UMA vez na fronteira: valor desconhecido é ERRO aqui,
    // nunca fail-open dentro de um adapter (typo ganhava escrita antes).
    let mut permission = adapters::Permission::parse(&permission)?;
    // O control plane roda antes de qualquer gateway. Assim, o consentimento
    // "Só lê" configura o run inteiro em vez de existir apenas como frase.
    let mut mcp_plan = if matches!(permission, adapters::Permission::FusionRo) {
        crate::mcp_control::McpRunPlan::default()
    } else {
        match crate::mcp_control::plan_for_run(
            &app,
            &conv_id,
            &run_id,
            &agent,
            &cwd,
            mcp_recoveries.as_deref().unwrap_or(&[]),
        )
        .await
        {
            Ok(plan) => plan,
            Err(error) => {
                let _ = on_event.send(AgentEvent::PreflightBlocked {
                    gate: crate::mcp_control::McpPreflightGate::control_plane(error),
                });
                return Ok(());
            }
        }
    };
    if let Some(gate) = mcp_plan.gate.clone() {
        let _ = on_event.send(AgentEvent::PreflightBlocked { gate });
        return Ok(());
    }
    if mcp_plan.force_readonly {
        permission = adapters::Permission::Leitura;
    }
    // pastas extras liberadas: lidas do .frota/config.toml do projeto que
    // contém o cwd (cobre worktrees), mais as só deste envio (ADR-252) → viram
    // --add-dir. ANTES de mover cwd.
    let extra_dirs = attachments::pastas_do_turno::juntar(
        crate::frota_dir::resolve_extra_dirs(&cwd),
        pastas_do_turno.unwrap_or_default(),
    );
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
    let context_gateway =
        if !caps.context_mcp || matches!(permission, adapters::Permission::FusionRo) {
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
                        .map(|p| p.join(crate::BANCO).to_string_lossy().to_string()),
                })
        };
    // Substrato uniforme de trabalho/processos. O listener vive pelo run inteiro;
    // processos iniciados por ele continuam no registry do app após o turno.
    let global_work = caps
        .work_mcp_global_env
        .then(|| crate::work_mcp_setup::cached(&agent))
        .flatten();
    let supports_work_mcp = caps.work_mcp
        && (!caps.work_mcp_global_env
            || global_work
                .as_ref()
                .is_some_and(|setup| setup.state == crate::work_mcp_setup::SetupState::Configured))
        && !matches!(permission, adapters::Permission::FusionRo);
    if caps.work_mcp_global_env && !matches!(permission, adapters::Permission::FusionRo) {
        mcp_plan.notices.push(crate::work_mcp_setup::aviso_do_acompanhamento(global_work.as_ref()));
    }
    let mut _work_listener = None;
    let work_processes_allowed =
        crate::work_gateway::processes_allowed(permission, plan_first.unwrap_or(false));
    let work_gateway = if supports_work_mcp {
        server_bin.as_ref().and_then(|bin| {
            let listener = crate::work_gateway::WorkListener::spawn(
                app.clone(),
                run_id.clone(),
                conv_id.clone(),
                cwd.clone(),
                process_registry.inner().clone(),
                work_processes_allowed,
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
    // `frota-browser` (ADR-224): anda no socket do `frota-work`. Motor com
    // escopo por run recebe pelo plano; motor de cadastro global (agy) só se
    // o cadastro do navegador estiver confirmado, mesma régua do trabalho.
    let global_browser = caps
        .work_mcp_global_env
        .then(|| crate::work_mcp_setup::cached_browser(&agent))
        .flatten();
    let browser_gateway = work_gateway.as_ref().and_then(|work| {
        let pronto = !caps.work_mcp_global_env
            || global_browser
                .as_ref()
                .is_some_and(|setup| setup.state == crate::work_mcp_setup::SetupState::Configured);
        pronto.then(|| crate::browser_gateway::GatewayConfig {
            server_bin: work.server_bin.clone(),
            socket: work.socket.clone(),
        })
    });
    // `frota-desktop` (ADR-225): anda no socket do `frota-work`. Disponibilizado
    // quando o controller do desktop estiver pronto (permissões concedidas).
    let global_desktop = caps
        .work_mcp_global_env
        .then(|| crate::work_mcp_setup::cached_desktop(&agent))
        .flatten();
    let desktop_gateway = work_gateway.as_ref().and_then(|work| {
        let pronto = crate::desktop::controller_ready()
            && (!caps.work_mcp_global_env
                || global_desktop
                    .as_ref()
                    .is_some_and(|setup| setup.state == crate::work_mcp_setup::SetupState::Configured));
        pronto.then(|| crate::desktop_gateway::GatewayConfig {
            server_bin: work.server_bin.clone(),
            socket: work.socket.clone(),
        })
    });
    // Permissões do sistema dadas, mas o motor de cadastro global não tem o
    // `frota-desktop`: a pessoa fica sabendo onde resolver, sem terminal.
    if caps.work_mcp_global_env
        && desktop_gateway.is_none()
        && work_gateway.is_some()
        && crate::desktop::controller_ready()
    {
        mcp_plan.notices.push(format!("Controle do computador da Frota indisponível neste motor: conecte em {}.", crate::work_mcp_setup::ONDE_CONECTAR));
    }
    if caps.work_mcp_global_env && browser_gateway.is_none() && work_gateway.is_some() {
        mcp_plan.notices.push(format!("Navegador da Frota indisponível neste motor: conecte em {}.", crate::work_mcp_setup::ONDE_CONECTAR));
    }
    // Tool Catalog por-run. Discovery e preflight são sem efeito: plugin não
    // executa e navegador desligado continua desligado. Só adapters capazes de
    // receber MCP efêmero ganham o gateway; os demais degradam honestamente.
    let mut tool_catalog = crate::tool_gateway::ToolCatalogSnapshot::default();
    let mut tool_scope = None;
    if !matches!(permission, adapters::Permission::FusionRo) {
        match crate::mcp_control::project_scope(&app, &conv_id, &cwd) {
            Ok((project_id, project_path)) => {
                match crate::tool_gateway::catalog_for_run(&app, &project_id).await {
                    Ok(catalog) => {
                        tool_catalog = catalog;
                        tool_scope = Some((project_id, project_path));
                    }
                    Err(error) => tool_catalog.notices.push(format!(
                        "Tool Catalog de plugins indisponível neste run: {error}"
                    )),
                }
            }
            Err(error) => tool_catalog.notices.push(format!(
                "Tool Catalog sem escopo de projeto neste run: {error}"
            )),
        }
    }
    let mut _tool_listener = None;
    let tool_gateway = if caps.mcp_escopo.por_run() && !tool_catalog.tools.is_empty() {
        server_bin.as_ref().and_then(|bin| {
            let (project_id, project_path) = tool_scope.clone()?;
            let listener = crate::tool_gateway::ToolListener::spawn(
                app.clone(),
                run_id.clone(),
                project_id,
                project_path,
                tool_catalog.clone(),
                app.state::<Arc<crate::plugin_runtime::PluginRuntimeRegistry>>()
                    .inner()
                    .clone(),
                app.state::<Arc<crate::resource_broker::ResourceLeaseRegistry>>()
                    .inner()
                    .clone(),
            )?;
            let config = crate::tool_gateway::GatewayConfig {
                server_bin: bin.to_string_lossy().to_string(),
                socket: listener.path().to_string_lossy().to_string(),
            };
            _tool_listener = Some(listener);
            Some(config)
        })
    } else {
        None
    };
    if !tool_catalog.tools.is_empty() && tool_gateway.is_none() {
        let reason = if caps.mcp_escopo.por_run() {
            "o gateway deste run não pôde ser iniciado"
        } else {
            "o adapter não oferece um materializador forte por run"
        };
        tool_catalog.mark_unmaterialized(reason);
    }
    if !matches!(permission, adapters::Permission::FusionRo) {
        if caps.mcp_escopo.por_run() {
            match crate::plugin_mcp::materialize_for_run(&app, &cwd).await {
                Ok(snapshot) => {
                    mcp_plan.contributed.extend(snapshot.servers);
                    mcp_plan.plugin_leases.extend(snapshot.leases);
                    mcp_plan.notices.extend(snapshot.notices);
                }
                Err(error) => mcp_plan
                    .notices
                    .push(format!("MCPs de plugins indisponíveis neste run: {error}")),
            }
        } else {
            match crate::plugin_contributions::enabled_packages(&app) {
                Ok(packages)
                    if packages
                        .iter()
                        .any(|package| !package.manifest.contributes.mcp_servers.is_empty()) =>
                {
                    mcp_plan.notices.push(
                        "MCPs de plugins revisados não entraram neste run: o adapter não oferece materialização forte por run"
                            .into(),
                    );
                }
                Ok(_) => {}
                Err(error) => mcp_plan.notices.push(format!(
                    "inventário de MCPs de plugins indisponível neste run: {error}"
                )),
            }
        }
    }
    let mut manifest = crate::run_manifest::build(
        &agent,
        caps,
        approval.is_some(),
        context_gateway.is_some(),
        work_gateway.is_some(),
        browser_gateway.is_some(),
        desktop_gateway.is_some(),
        tool_gateway.is_some(),
        &tool_catalog,
        &mcp_plan,
        instruction_sources,
    );
    if !work_processes_allowed {
        crate::run_manifest::restrict_work_processes(&mut manifest);
    }
    // Run sem binding deixa a config global do motor entrar inteira. Se nela há
    // navegador de terceiro, o manifesto diz o NOME (ADR-224 §2): registry
    // persistido para motores por run, cache da última leitura do CLI para os
    // de cadastro global. Nada aqui sobe subprocesso.
    // O mesmo para controle do computador de terceiro (ADR-225): o
    // `computer-use` no cadastro do motor clica e digita por fora do pedido,
    // do Revogar e da posse exclusiva da Frota.
    //
    // Navegador de terceiro com o `frota-browser` no turno SAI do turno quando
    // o motor sabe negar por run (`run_mcp_deny`). Visto no sicredi em
    // 22/09/2026: com os dois presentes, o agente seguiu o costume da sessão e
    // abriu o Chrome do Playwright fora da Frota; nomear não bastou.
    let mut denied_mcp_servers: Vec<String> = Vec::new();
    if !mcp_plan.managed && !matches!(permission, adapters::Permission::FusionRo) {
        use crate::resource_broker::ResourceKind;
        let navegadores =
            crate::mcp_control::externos_do_motor(&app, &agent, ResourceKind::ExternalBrowser);
        if browser_gateway.is_some() && caps.run_mcp_deny && !navegadores.is_empty() {
            manifest.notices.push(format!(
                "Navegador de terceiro fora deste turno: {} (o navegador da Frota está presente).",
                navegadores.join(", ")
            ));
            denied_mcp_servers = navegadores;
        } else {
            manifest.external_browser_mcps = navegadores;
        }
        manifest.external_desktop_mcps =
            crate::mcp_control::externos_do_motor(&app, &agent, ResourceKind::DesktopControl);
    }
    manifest.missing_frota_channels = crate::work_mcp_setup::canais_ausentes(caps.work_mcp_global_env, matches!(permission, adapters::Permission::FusionRo), work_gateway.is_some());
    let _ = on_event.send(AgentEvent::RunManifest { manifest });
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
    // Diretrizes de escopo e higiene de navegação (evita varreduras amplas em ~ no macOS)
    let scope_block = crate::scope_guidance::format_scope_guidance(
        &cwd,
        &extra_dirs,
        interaction_on || approval.is_some(),
    );
    let combined_system_prompt = match system_prompt {
        Some(existing) if !existing.trim().is_empty() => {
            Some(format!("{existing}\n\n{scope_block}"))
        }
        _ => Some(scope_block),
    };
    // H1 — roteia o conteúdo de sistema pelo canal declarado (fail-open: sem
    // canal, dobra no corpo AQUI, antes de qualquer transporte — cobre também
    // o app-server do codex, que não passa pelo build_command).
    let (system_prompt, prompt) =
        adapters::route_system_prompt(caps, combined_system_prompt, prompt);
    // Fronteira do slug de modelo: a partir daqui o valor vira `--model <slug>`
    // (claude/agy), `-c model=` (codex exec) ou campo JSON (app-server) — três
    // transportes, uma regra só. Slug com espaço/TAB/quebra de linha é resto de
    // parse mal feito e o CLI recusa com erro cru; recusamos ANTES, com a frase
    // que diz o que fazer. Fail-closed no efeito (nada é spawnado).
    if let Err(message) = adapters::validate_model_slug(model.as_deref()) {
        let _ = on_event.send(AgentEvent::StartupFailed { message });
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
        browser_gateway,
        desktop_gateway,
        denied_mcp_servers,
        tool_gateway,
        mcp_plan,
        plan_first: plan_first.unwrap_or(false),
        usage_baseline,
        cost_baseline,
    };
    // O dialeto do rollout é capability, não nome de motor. A retomada que
    // causou o incidente de 30/08 tinha 85.223.130 bytes; acima de 64 MiB o
    // Frota avisa e oferece a renovação explícita, mas não limita o motor.
    if matches!(
        caps.context_usage,
        Some(adapters::ContextUsageSource::CodexRollout)
    ) {
        if let Some(session_id) = req.resume.as_deref() {
            match crate::codex_resume_guard::assess(session_id).await {
                Ok(Some(risk)) if risk.deserves_warning() => {
                    let _ = on_event.send(AgentEvent::Notice {
                        message: format!(
                            "Esta sessão nativa ocupa {} MiB. A retomada continuará sem teto artificial; se quiser reduzir o risco de pressão de memória, use /compactar para renová-la com a memória e o histórico preservados.",
                            risk.size_mib()
                        ),
                    });
                }
                Ok(_) => {}
                Err(error) => log::warn!("preflight da retomada indisponível: {error}"),
            }
        }
    }
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
                let _ = on_event.send(AgentEvent::Done {
                    code: (!out.failed).then_some(0),
                });
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

    // OpenCode em Padrão: ACP bidirecional. O transporte histórico `run`
    // auto-rejeita ferramentas sem consultar o usuário; ACP pausa e encaminha
    // a decisão para os cards de interação da Frota. Anexos ainda usam o
    // `-f` auditado do transporte antigo até serem embutidos no prompt ACP.
    if agent == "opencode"
        && matches!(permission, adapters::Permission::Padrao)
        && req.attachments.is_empty()
    {
        let out = crate::opencode_acp::run(
            &app,
            &run_id,
            &req,
            &on_event,
            &notify,
            registry.inner(),
            pending_approvals.inner().clone(),
        )
        .await;
        match out.startup_error {
            None => {
                emit_mcp_announced(&app, &conv_id, &announced_fp);
                if out.cancelled {
                    let _ = on_event.send(AgentEvent::Cancelled);
                }
                let _ = on_event.send(AgentEvent::Done {
                    code: (!out.failed).then_some(0),
                });
                return Ok(());
            }
            Some(error) => {
                log::warn!("OpenCode ACP indisponível ({error}); caindo no `opencode run`");
                let _ = on_event.send(AgentEvent::Notice {
                    message: format!("ACP do OpenCode indisponível ({error}); segui no transporte antigo, sem pedido de permissão neste turno."),
                });
            }
        }
    }

    let resume_was = req.resume.is_some();
    let cmd = match adapter.build_validated_command(&req) {
        Ok(command) => command,
        Err(message) => {
            let _ = on_event.send(AgentEvent::StartupFailed { message });
            let _ = on_event.send(AgentEvent::Done { code: None });
            return Ok(());
        }
    };
    let sandbox_proprio = adapter.capabilities().sandbox_proprio;
    let (cmd, perfil_sb) = confina_se_prometido(cmd, &req, sandbox_proprio, &run_id, &on_event);
    let confinou = perfil_sb.is_some();
    let _limpa = perfil_sb.map(LimpaPerfil);
    let mut outcome = match run_once(
        cmd,
        resume_was,
        &on_event,
        &mut adapter,
        &notify,
        registry.inner(),
        &run_id,
        (adapters::canonical_agent(&agent), &req.cwd),
    )
    .await
    {
        Ok(outcome) => outcome,
        // O pedido foi aceito, mas o processo não nasceu. Preservamos o marco
        // factual sem transformar startup em incidente de execução.
        Err(message) => {
            let _ = on_event.send(AgentEvent::StartupFailed { message });
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
        // "Frota resume": avisa o front que o resume nativo falhou e o run
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
        req2.cost_baseline = None;
        // Fallback de memória: o recap do front entra ANTES do prompt original,
        // p/ o run recomeçado não esquecer a conversa. Sem fallback, prompt intacto.
        req2.prompt = restart_prompt(req2.memory_fallback.as_deref(), &req2.prompt);
        let mut adapter2 = adapters::resolve(&agent)?;
        let cmd2 = adapter2.build_validated_command(&req2)?;
        let (cmd2, perfil_sb2) = confina_se_prometido(
            cmd2,
            &req2,
            adapter2.capabilities().sandbox_proprio,
            &run_id,
            &on_event,
        );
        // O perfil do run reiniciado tem vida própria: o `?` abaixo pode sair
        // antes da limpeza do fim, e um .sb esquecido em /tmp por turno somaria.
        let _limpa2 = perfil_sb2.map(LimpaPerfil);
        outcome = match run_once(
            cmd2,
            false,
            &on_event,
            &mut adapter2,
            &notify,
            registry.inner(),
            &run_id,
            (adapters::canonical_agent(&agent), &req2.cwd),
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

    // Snapshot de contexto no FIM do turno, governado pela capability. O
    // runner não compara nome de agent: `Stream` exige que o transporte tenha
    // publicado; `CodexRollout` consulta o dialeto do rollout porque o JSONL do
    // exec só oferece o total acumulado da thread. Falha da fonte limpa o
    // snapshot anterior — dado velho com cara de atual é pior que "indisponível".
    if outcome.success && !outcome.cancelled {
        match caps.context_usage {
            Some(adapters::ContextUsageSource::Stream) if !outcome.context_reported => {
                let _ = on_event.send(AgentEvent::ContextUnavailable);
            }
            Some(adapters::ContextUsageSource::CodexRollout) => {
                let snapshot = match outcome.session_id.as_deref() {
                    Some(thread_id) => {
                        crate::codex_appserver::probe_thread_context(thread_id).await
                    }
                    None => Err(crate::codex_appserver::ProbeError {
                        kind: "protocol",
                        message: "o stream terminou sem identificar a thread".into(),
                    }),
                };
                match snapshot {
                    Ok(snapshot) => {
                        let _ = on_event.send(AgentEvent::ContextUsage {
                            tokens: snapshot.tokens,
                            window_tokens: Some(snapshot.window_tokens),
                        });
                    }
                    Err(error) => {
                        log::warn!(
                            "medidor de contexto: fonte pós-turno indisponível ({}): {}",
                            error.kind,
                            error.message
                        );
                        let _ = on_event.send(AgentEvent::ContextUnavailable);
                    }
                }
            }
            _ => {}
        }
    }

    if outcome.cancelled {
        let _ = on_event.send(AgentEvent::Cancelled);
    } else if let Some(event) = process_failure_fallback(&*adapter, &agent, &outcome) {
        let _ = on_event.send(event);
    }
    // S3 — o veredito do confinamento, ANTES do Done: sem ele, um bloqueio do
    // sistema chega na tela como "turno falhou" e o usuário fica sem saber que
    // foi o "Só lê" dele funcionando. É a frase que separa a funcionalidade boa
    // da irritante.
    //
    // `confinado` é o perfil ter sido REALMENTE aplicado, não o modo ter pedido:
    // quando o `sandbox-exec` faltou, o turno rodou solto e nada aqui se aplica.
    if let Some(frase) = crate::sandbox::frase(crate::sandbox::classifica(
        confinou,
        &outcome.stderr,
        outcome.sandbox_runner_hint.as_deref(),
        outcome.success,
        outcome.emitiu_saida,
    )) {
        let _ = on_event.send(AgentEvent::Notice {
            message: frase.to_string(),
        });
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
/// - `session_resume` sem canal → tudo no 1º turno da sessão; turno
///   com resume só re-anuncia MCP quando o PLANO mudou (fingerprint ≠ último
///   anunciado — devolvido em `.1` pro front carimbar via `mcp://announced`);
/// - sem resume → todo turno (custo honesto registrado no plano).
/// - canal global → reanuncia ativação/desativação pela mesma régua do ledger.
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
    let global_work = caps.work_mcp_global_env && !mcp_plan.managed;
    let work_changed = global_work
        && (has_work_gateway || last_fingerprint.is_some_and(|fp| fp.starts_with("work-channel:")));
    let fingerprint = if work_changed {
        Some(format!(
            "work-channel:{}",
            if has_work_gateway { "on" } else { "off" }
        ))
    } else {
        mcp_plan.fingerprint()
    };
    let announced_servers = mcp_plan.announced_servers();
    let announce_mcp = !global_work
        && match fingerprint.as_deref() {
            None => false,
            Some(fp) => {
                if announced_servers.is_empty() {
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
        if announced_servers.is_empty() {
            sections.push(
                "Ferramentas MCP desta sessão: nenhuma. Os MCPs externos anunciados antes foram desligados; não chame mais as tools deles."
                    .to_string(),
            );
        } else {
            let lines: Vec<String> = mcp_plan
                .announced_servers()
                .into_iter()
                .map(|server| {
                    format!(
                        "- {}: {} (MCP roteado pela Frota)",
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
    if has_work_gateway
        && (first_turn || (global_work && last_fingerprint != fingerprint.as_deref()))
    {
        sections.push(crate::work_gateway::ferramentas::instrucao(first_turn));
    }
    if global_work && !has_work_gateway && last_fingerprint == Some("work-channel:on") {
        sections.push("O acompanhamento por frota-work está indisponível neste turno. Não envie atualizações ao canal anunciado anteriormente.".into());
    }
    let announced = if announce_mcp || (work_changed && last_fingerprint != fingerprint.as_deref())
    {
        fingerprint
    } else {
        None
    };
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
/// Apaga o perfil do sandbox quando o run acaba — inclusive quando ele acaba por
/// `?` no meio do caminho, que é justamente onde um `remove_file` no fim não
/// rodaria. Perfil é arquivo por turno; sem isto, /tmp cresce em silêncio.
struct LimpaPerfil(std::path::PathBuf);
impl Drop for LimpaPerfil {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Envolve o comando no sandbox quando o modo PROMETE que o agente não escreve.
///
/// Devolve `(comando, perfil_no_disco)` — o perfil precisa sobreviver até o
/// `exec`, então quem chama segura o `LimpaPerfil` até o fim do run.
///
/// **Rebaixa falando alto, nunca em silêncio.** Recusar o turno quando o
/// `sandbox-exec` falta seria uma REGRESSÃO: hoje "Só lê" já roda sem sandbox
/// nenhum, e passar a bloquear tiraria do usuário algo que ele tem. O §9 proíbe
/// seguir EM SILÊNCIO com menos garantia — seguir AVISANDO cumpre a regra sem
/// quebrar ninguém. O selo `completa`/`parcial` do S4 é onde isso vira tela.
fn confina_se_prometido(
    cmd: tokio::process::Command,
    req: &adapters::RunRequest,
    // Do REGISTRY (`adapter.capabilities()`), nunca do nome do motor. É o que
    // impede o envelope de colidir com o sandbox de quem já confina sozinho.
    proprio: adapters::SandboxProprio,
    run_id: &str,
    on_event: &tauri::ipc::Channel<AgentEvent>,
) -> (tokio::process::Command, Option<std::path::PathBuf>) {
    // Canonicaliza ANTES de virar regra: Seatbelt casa `subpath` pelo caminho
    // real, e um projeto atrás de symlink ganhava um perfil que não negava nada
    // (medido 10/09/2026 — o arquivo foi destruído com o perfil aplicado).
    //
    // As pastas liberadas por `--add-dir` entram: o usuário pediu "Só lê", não
    // "só lê o projeto principal". Proteger a raiz e deixar a pasta irmã aberta
    // seria um buraco exatamente onde ele concedeu acesso de propósito.
    let alvo = crate::sandbox::Alvo::canonicalizado(&req.cwd, None, &req.extra_dirs);
    let perfil = match crate::sandbox::perfil_macos(req.permission, req.plan_first, proprio, &alvo)
    {
        Ok(p) => p,
        // Modo de escrita: ausência LEGÍTIMA de sandbox, sem aviso nenhum.
        Err(crate::sandbox::SemPerfil::ModoEscreve) => return (cmd, None),
        // O motor confina sozinho, com garantia MEDIDA e mais apertada que a
        // nossa. Também é ausência legítima e também não ganha aviso: somar o
        // envelope aqui não protegia mais, quebrava o turno inteiro.
        Err(crate::sandbox::SemPerfil::MotorConfina) => return (cmd, None),
        Err(crate::sandbox::SemPerfil::NadaParaProteger) => {
            let _ = on_event.send(AgentEvent::Notice {
                message: "Somente-leitura sem confinamento do sistema: não montei o perfil para este diretório. O motor segue segurando sozinho.".to_string(),
            });
            return (cmd, None);
        }
    };
    if !crate::sandbox::disponivel() {
        let _ = on_event.send(AgentEvent::Notice {
            message: "Somente-leitura sem confinamento do sistema: o sandbox-exec não existe nesta máquina. O motor segue segurando sozinho.".to_string(),
        });
        return (cmd, None);
    }
    let path = std::env::temp_dir().join(format!("frota-sb-{run_id}.sb"));
    if let Err(e) = std::fs::write(&path, perfil) {
        let _ = on_event.send(AgentEvent::Notice {
            message: format!("Somente-leitura sem confinamento do sistema: não consegui gravar o perfil ({e}). O motor segue segurando sozinho."),
        });
        return (cmd, None);
    }
    (crate::sandbox::envelopa(cmd, &path), Some(path))
}

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
    stderr_truncated: bool,
    /// O run chegou a EMITIR alguma coisa do stream do motor?
    ///
    /// Não é telemetria: é o único sinal que separa "confinado e trabalhou" de
    /// "confinado e engoliu o bloqueio em silêncio" (o caso agy da fase 0, que
    /// sai com exit 0, stdout vazio e stderr sem assinatura nenhuma).
    emitiu_saida: bool,
    /// Primeira assinatura de falha do RUNNER de sandbox vista no stream cru
    /// (`sandbox::assinatura_de_runner`). `None` = o stream não acusou nada.
    ///
    /// Campo próprio, e não "mais um pedaço do stderr", porque a origem é o que
    /// importa: esta veio do stdout estruturado, que é onde o `classifica` não
    /// olhava quando a automação agendada rodou cega três vezes.
    sandbox_runner_hint: Option<String>,
    session_not_found: bool,
    /// O stream já publicou uma causa terminal acionável (`Error` ou
    /// `LimitReached`). O exit code continua em `Done`, mas não pode fabricar um
    /// segundo incidente visual para a mesma falha.
    terminal_incident: bool,
    /// Sessão confirmada pelo stream desta tentativa (necessária para sondas
    /// pós-turno que consultam estado do provider sem depender do nome).
    session_id: Option<String>,
    /// O transporte publicou um snapshot de contexto confiável durante o run.
    context_reported: bool,
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
    let mut msg = if outcome.stderr.trim().is_empty() {
        format!(
            "o agent `{agent}` saiu com código {}",
            outcome.code.unwrap_or(-1)
        )
    } else {
        outcome.stderr.trim().to_string()
    };
    if outcome.stderr_truncated {
        msg.push_str("\n[stderr limitado aos 64 KiB finais]");
    }
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

/// Quanto a drenagem espera por uma linha nova depois que o processo saiu. O que
/// o CLI escreveu antes de sair já está no pipe e chega em milissegundos; esperar
/// mais que isso só serve pra neto em background que herdou o stdout e ficou mudo.
const DRENAGEM_OCIOSA: std::time::Duration = std::time::Duration::from_millis(300);
/// Teto da drenagem inteira: um neto que herdou o stdout e NÃO para de escrever
/// não pode segurar o fim do turno.
const DRENAGEM_TETO: std::time::Duration = std::time::Duration::from_secs(3);

/// Spawn + loop (streama os eventos) + wait, UMA vez. NÃO emite Cancelled/Error/
/// Done, quem orquestra (run_agent) decide, p/ poder reexecutar sem resume na
/// degradação graciosa. Num resume, intercepta SessionNotFound (suprime + marca).
#[allow(clippy::too_many_arguments)]
async fn run_once(
    mut cmd: Command,
    resume_is_some: bool,
    on_event: &Channel<AgentEvent>,
    adapter: &mut Box<dyn adapters::AgentAdapter>,
    notify: &Arc<Notify>,
    registry: &RunRegistry,
    run_id: &str,
    // (agent canônico, cwd do pedido): chave do inventário anunciado (ADR-189).
    inventory_key: (&str, &str),
) -> Result<Outcome, String> {
    // stdin null é OBRIGATÓRIO: sem isso o `codex exec` trava lendo stdin
    // (verificado). Inofensivo p/ o Claude (que não lê stdin em -p).
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // filho morre se o future for dropado (não cobre process::exit; o
        // kill_all no hook de saída do app cobre esse caso).
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    // Correlação dos hooks de status (hooks-plan §4.7): o hook global herda
    // esta env e a manda num header — run NOSSO nunca vira "sessão externa"
    // no Painel. Inofensiva sem hooks instalados (ninguém a lê).
    crate::hook_sessions::correlate_run(&mut cmd, run_id);

    registry.ensure_accepting()?;

    let bin = adapter.id();
    let mut child = cmd.spawn().map_err(|e| {
        format!("não consegui executar o agent `{bin}`: {e}. Ele está instalado e no PATH?")
    })?;
    let child_pid = child.id();
    // pid no registry: o hook de saída mata todos (órfãos de Cmd-Q). O RunGuard
    // do run_agent limpa a entrada em qualquer saída.
    if let Some(pid) = child_pid {
        if let Ok(mut pids) = registry.1.lock() {
            pids.insert(run_id.to_string(), pid);
        }
    }

    let stdout = child.stdout.take().ok_or("sem stdout do processo")?;
    let stderr = child.stderr.take();
    let mut reader = crate::run_resources::LimitedLineReader::new(stdout);

    // H3, coleta o stderr em paralelo p/ reportar erros de processo. As linhas
    // também chegam AO VIVO ao adapter: há motor que escreve estado ali durante
    // o turno (o `agy -p` avisa quando fica esperando tarefa em background).
    let (stderr_live_tx, mut stderr_live) =
        tokio::sync::mpsc::channel::<String>(crate::run_resources::STDERR_LIVE_QUEUE);
    let mut stderr_vivo = true;
    let stderr_task = tokio::spawn(async move {
        match stderr {
            Some(stderr) => {
                crate::run_resources::collect_stderr_tail_live(stderr, Some(stderr_live_tx)).await
            }
            None => crate::run_resources::CapturedTail::default(),
        }
    });
    let mut memory_watch = crate::run_resources::ProcessMemoryWatch::new(child_pid);
    let mut monitored_output_files = std::collections::HashSet::<std::path::PathBuf>::new();
    let _ = on_event.send(AgentEvent::Started);
    let mut last_byte_at = None;

    // H1, o `notify` é registrado/desregistrado no run_agent (RunGuard); aqui só
    // escutamos o sinal. Reusar o MESMO Arc entre as tentativas retém o cancel.
    let mut cancelled = false;
    let mut emitiu_saida = false;
    // Primeira assinatura de falha do runner de sandbox vista no stream cru. O
    // stderr não é a única superfície: no sandbox aninhado ela sai no stdout
    // estruturado, e é ali que o incidente de 04–09/09/2026 se esconde.
    let mut sandbox_runner_hint: Option<String> = None;
    let mut session_not_found = false;
    let mut terminal_incident = false;
    let mut session_id = None;
    let mut context_reported = false;
    let mut exit_status = None;
    // A cauda do stdout é do turno. Quando o processo sai, o que ele escreveu por
    // último (os `text_delta` finais, o `assistant`, o `result`) ainda pode estar
    // no pipe. Sair do loop no instante do `wait` jogava isso fora: foi a resposta
    // de 2030 caracteres gravada com 406 no incidente de 13/09/2026
    // (`agent_stream_tail_tests.rs`). Então o `wait` só troca o loop pra modo de
    // drenagem, e quem encerra é o EOF ou o prazo abaixo.
    // (início da drenagem, instante da última linha lida)
    let mut drenagem: Option<(tokio::time::Instant, tokio::time::Instant)> = None;
    loop {
        let prazo_da_drenagem = drenagem
            .map(|(inicio, ultima)| (ultima + DRENAGEM_OCIOSA).min(inicio + DRENAGEM_TETO))
            .unwrap_or_else(tokio::time::Instant::now);
        tokio::select! {
            line = reader.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        last_byte_at = Some(crate::run_resources::epoch_ms());
                        if let Some((_, ultima)) = drenagem.as_mut() {
                            *ultima = tokio::time::Instant::now();
                        }
                        // Só a PRIMEIRA: o resto do turno repete a mesma falha a
                        // cada comando, e a classificação precisa de uma amostra.
                        if sandbox_runner_hint.is_none() {
                            sandbox_runner_hint = crate::sandbox::assinatura_de_runner(&line);
                        }
                        // O adapter decide como tratar a linha crua: estruturados
                        // (Claude/Codex) parseiam JSON → map_line; não-estruturados
                        // (agy) tratam como texto. Default preserva o comportamento
                        // antigo (JSON→map_line, senão Unknown; regra de ouro).
                        for ev in adapter.on_stdout_line(&line) {
                            if let AgentEvent::EngineInventory { inventory } = ev {
                                let (agent, cwd) = inventory_key;
                                crate::command_inventory::observe(agent, cwd, inventory);
                                continue;
                            }
                            if matches!(ev, AgentEvent::SessionNotFound { .. }) {
                                if resume_is_some {
                                    session_not_found = true; // suprime + retry
                                } else if let AgentEvent::SessionNotFound { message } = ev {
                                    let _ = on_event.send(AgentEvent::Error { message });
                                    terminal_incident = true;
                                }
                                continue;
                            }
                            if let AgentEvent::Session { session_id: id, .. } = &ev {
                                session_id = Some(id.clone());
                            }
                            if let AgentEvent::DeferredWork { output_file: Some(ref path), .. } = &ev {
                                monitored_output_files.insert(std::path::PathBuf::from(path));
                            }
                            context_reported |= matches!(ev, AgentEvent::ContextUsage { .. });
                            terminal_incident |= is_terminal_incident(&ev);
                            emitiu_saida = true;
                            let _ = on_event.send(ev);
                        }
                    }
                    Ok(None) => break, // EOF, processo terminou
                    Err(error) => {
                        terminal_incident = true;
                        let _ = on_event.send(AgentEvent::Error {
                            message: format!("{error}; interrompi o run antes de processar um payload sem teto."),
                        });
                        crate::run_processes::terminate_run(run_id, child_pid);
                        break;
                    }
                }
            }
            line = stderr_live.recv(), if stderr_vivo => {
                match line {
                    Some(line) => {
                        for ev in adapter.on_stderr_line(&line) {
                            terminal_incident |= is_terminal_incident(&ev);
                            emitiu_saida = true;
                            let _ = on_event.send(ev);
                        }
                    }
                    None => stderr_vivo = false,
                }
            }
            status = child.wait(), if exit_status.is_none() => {
                exit_status = Some(status.map_err(|e| e.to_string())?);
                let agora = tokio::time::Instant::now();
                drenagem = Some((agora, agora));
            }
            _ = tokio::time::sleep_until(prazo_da_drenagem), if drenagem.is_some() => {
                // Neto em background segurando o stdout: o turno termina assim
                // mesmo, e o `terminate_run` abaixo fecha o pipe.
                break;
            }
            _ = notify.notified() => {
                cancelled = true;
                for ev in adapter.on_cancel() {
                    emitiu_saida = true;
                    let _ = on_event.send(ev);
                }
                crate::run_processes::terminate_run(run_id, child_pid);
                break;
            }
            resources = memory_watch.next() => {
                let observation = resources.observation;
                let _ = on_event.send(AgentEvent::RunStatus {
                    main_alive: observation.main_alive,
                    descendants: observation.descendants,
                    rss_mb: observation.rss_mb,
                    last_byte_at,
                    observed_at: crate::run_resources::epoch_ms(),
                });
                for ev in adapter.on_heartbeat() {
                    terminal_incident |= is_terminal_incident(&ev);
                    emitiu_saida = true;
                    let _ = on_event.send(ev);
                }
                if let Some(rss_mb) = resources.warning_rss_mb {
                    let message = crate::run_resources::format_memory_warning_message(
                        rss_mb,
                        observation.root_rss_mb,
                    );
                    let _ = on_event.send(AgentEvent::Notice { message });
                }
                let mut quota_violation = None;
                for file_path in &monitored_output_files {
                    if let crate::run_resources::DiskQuotaCheck::Exceeded { size_bytes, limit_bytes } =
                        crate::run_resources::check_disk_quota(file_path, crate::run_resources::MAX_OUTPUT_FILE_BYTES)
                    {
                        quota_violation = Some((file_path.clone(), size_bytes, limit_bytes));
                        break;
                    }
                }
                if let Some((path, size, limit)) = quota_violation {
                    terminal_incident = true;
                    let limit_gb = limit / (1024 * 1024 * 1024);
                    let size_mb = size / (1024 * 1024);
                    let _ = on_event.send(AgentEvent::Error {
                        message: format!(
                            "Arquivo de saída em background atingiu {size_mb} MB e excedeu o teto de segurança de {limit_gb} GB ({}); interrompi o processo para proteger o disco.",
                            path.display()
                        ),
                    });
                    crate::run_processes::terminate_run(run_id, child_pid);
                    break;
                }
            }
        }
    }

    // Flush de itens pendentes (begin sem end) só no fim normal, não no cancel.
    if !cancelled {
        for ev in adapter.on_close() {
            if let AgentEvent::Session { session_id: id, .. } = &ev {
                session_id = Some(id.clone());
            }
            context_reported |= matches!(ev, AgentEvent::ContextUsage { .. });
            terminal_incident |= is_terminal_incident(&ev);
            emitiu_saida = true;
            let _ = on_event.send(ev);
        }
    }

    let status = match exit_status {
        Some(status) => status,
        None => child.wait().await.map_err(|e| e.to_string())?,
    };
    // O filho direto pode terminar antes de um background que herdou os pipes.
    // Limpar o run fecha também stdout/stderr e impede o wait abaixo de pendurar.
    crate::run_processes::terminate_run(run_id, None);
    let stderr_capture = stderr_task.await.unwrap_or_default();
    let stderr_text = stderr_capture.text;

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
        stderr_truncated: stderr_capture.truncated,
        emitiu_saida,
        sandbox_runner_hint,
        session_not_found,
        terminal_incident,
        session_id,
        context_reported,
    })
}

#[cfg(test)]
#[path = "agent_stream_tail_tests.rs"]
mod stream_tail_tests;

/// Cancela um run em andamento. `false` permite ao front reconciliar um estado
/// persistido cujo runner já não existe; descendentes marcados são limpos mesmo
/// nesse caso.
#[tauri::command]
pub fn cancel_agent(run_id: String, registry: tauri::State<'_, RunRegistry>) -> bool {
    let notify = registry
        .0
        .lock()
        .ok()
        .and_then(|map| map.get(&run_id).cloned());
    if let Some(notify) = notify {
        notify.notify_one();
        true
    } else {
        crate::run_processes::terminate_run(&run_id, None);
        false
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
    // Meta-tarefa não dispara os hooks globais do usuário. Medido em 15/09/2026
    // (claude 2.1.270): hooks de quatro apps, um deles tocando som no `Stop`,
    // somavam ~2s a CADA one-shot ("ok" em 4,97s com hooks, 3,0s sem). Com
    // prazos de 3 a 8s, o helper utilitário estourava sempre. `--settings`
    // soma à configuração do usuário; `env` e credenciais continuam valendo.
    cmd.arg("--settings").arg("{\"disableAllHooks\":true}");
    if no_mcp {
        cmd.arg("--strict-mcp-config")
            .arg("--mcp-config")
            .arg("{\"mcpServers\":{}}");
    }
    cmd
}

/// Sonda do limiar de compactação (ADR-196): retoma a sessão em modo de
/// entrada stream-json SÓ para mandar um `control_request`. Nenhuma mensagem
/// de usuário é enviada, então não há turno de modelo nem escrita na sessão.
/// Sem hooks (não vira sessão externa fantasma nem paga ~2s) e sem MCP (os
/// servidores não entram no limiar nem no total; entram só nas categorias
/// adiadas). O `--model` é o mesmo do run: o limiar muda por modelo.
pub(crate) fn claude_context_probe_command(
    cwd: &str,
    session_id: &str,
    model: Option<&str>,
) -> Command {
    let mut cmd = Command::new("claude");
    cmd.arg("-p")
        .arg("--input-format")
        .arg("stream-json")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        .arg("--resume")
        .arg(session_id)
        .arg("--settings")
        .arg("{\"disableAllHooks\":true}")
        .arg("--strict-mcp-config")
        .arg("--mcp-config")
        .arg("{\"mcpServers\":{}}");
    if let Some(m) = model {
        cmd.arg("--model").arg(m);
    }
    crate::hook_sessions::correlate_run(&mut cmd, "oneshot");
    cmd.current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    cmd
}

/// Adapter legado do helper textual usado pelo gateway utilitário. A gramática
/// do CLI permanece aqui, junto do runner do fornecedor; o gateway recebe um
/// comando pronto e nunca conhece flags, posição do prompt ou MCP.
pub(crate) fn utility_helper_command(model: &str, cwd: &str, prompt: &str) -> Command {
    let mut cmd = claude_oneshot(model, cwd, prompt, "text", true);
    // Texto curto de apoio (commit, sugestão, recibo) não precisa de raciocínio.
    // Medido em 15/09/2026 no diff real de 17 mil caracteres: 1902 dos 2035
    // tokens de saída eram thinking e o haiku levou 19,6s; com
    // MAX_THINKING_TOKENS=0, 11,5s e zero thinking. `--effort low` não reduziu.
    // O juiz do Fusion não passa por aqui e mantém o raciocínio.
    cmd.env("MAX_THINKING_TOKENS", "0");
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
#[path = "agy_live_tests.rs"]
mod agy_live_tests;

#[cfg(test)]
mod tests {
    use super::{
        claude_oneshot, compose_mcp_preamble, process_failure_fallback, restart_prompt,
        validate_run_content, AgentEvent, Outcome,
    };

    /// X2 — vazio significa ausência de conteúdo efetivo, não ausência de
    /// texto: a Frota aceita uma imagem/PDF como a mensagem inteira.
    #[test]
    fn pedido_vazio_so_passa_quando_ha_anexo_util() {
        assert!(validate_run_content("faça X", 0).is_ok());
        assert!(validate_run_content("", 1).is_ok());
        assert!(validate_run_content("  \n\t", 2).is_ok());
        assert!(validate_run_content("", 0).is_err());
        assert!(validate_run_content("  \n\t", 0).is_err());
    }

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

    /// 15/09/2026: o helper utilitário tinha 0 sucessos em semanas porque cada
    /// one-shot pagava os hooks globais do usuário e, no helper, o raciocínio do
    /// modelo. Todo one-shot desliga hooks; só o helper desliga o raciocínio.
    #[test]
    fn oneshot_sem_hooks_e_helper_sem_raciocinio() {
        let args_de = |cmd: &tokio::process::Command| -> Vec<String> {
            cmd.as_std().get_args().map(|a| a.to_string_lossy().into_owned()).collect()
        };
        let env_de = |cmd: &tokio::process::Command, chave: &str| -> Option<String> {
            cmd.as_std()
                .get_envs()
                .find(|(k, _)| *k == std::ffi::OsStr::new(chave))
                .and_then(|(_, v)| v)
                .map(|v| v.to_string_lossy().into_owned())
        };
        let juiz = claude_oneshot("opus", "/tmp", "decida", "json", true);
        let args = args_de(&juiz);
        let pos = args.iter().position(|a| a == "--settings").expect("one-shot sem hooks");
        assert_eq!(args[pos + 1], "{\"disableAllHooks\":true}");
        assert_eq!(env_de(&juiz, "MAX_THINKING_TOKENS"), None, "o juiz mantém o raciocínio");

        let helper = crate::agent::utility_helper_command("haiku", "/tmp", "commit");
        assert!(args_de(&helper).iter().any(|a| a == "--settings"));
        assert_eq!(env_de(&helper, "MAX_THINKING_TOKENS").as_deref(), Some("0"));
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
                tool_names: Vec::new(),
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
    fn cadastro_global_anuncia_ativacao_e_desativacao_em_uma_sessao_retomada() {
        let plan = crate::mcp_control::McpRunPlan::default();
        let caps = &crate::adapters::AGY_CAPS;
        let (first, fp) = compose_mcp_preamble("continue".into(), true, &plan, caps, true, None);
        assert!(first.contains("TELEMETRIA DE TRABALHO"));
        assert_eq!(fp.as_deref(), Some("work-channel:on"));
        let (same, next) =
            compose_mcp_preamble("continue".into(), true, &plan, caps, true, fp.as_deref());
        assert_eq!(same, "continue");
        assert_eq!(next, None);
        let (off, fp) =
            compose_mcp_preamble("continue".into(), false, &plan, caps, true, fp.as_deref());
        assert!(off.contains("frota-work está indisponível"));
        assert!(!off.contains("MCPs externos"));
        assert_eq!(fp.as_deref(), Some("work-channel:off"));
        let (again, _) =
            compose_mcp_preamble("continue".into(), true, &plan, caps, true, fp.as_deref());
        assert!(again.contains("TELEMETRIA DE TRABALHO"));
    }

    #[test]
    fn preambulo_gerenciado_anuncia_runtime_e_display_de_cada_mcp() {
        let plan = plano_playwright();
        let (out, fp) =
            compose_mcp_preamble("faça X".into(), true, &plan, caps_corpo(), false, None);
        assert!(out.starts_with(
            "Ferramentas MCP desta sessão:\n- playwright: Playwright (MCP roteado pela Frota)"
        ));
        // Bloco único: o anúncio e a telemetria do frota-work compartilham o
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
        assert_eq!(
            out, "continua",
            "corpo limpo: o resume já carrega o preâmbulo"
        );
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
        assert_eq!(
            fp,
            vazio.fingerprint(),
            "anunciou o vazio → carimbo do vazio"
        );
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
            let (out3, fp3) =
                compose_mcp_preamble("faça X".into(), false, &vazio, caps_corpo(), resuming, None);
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
        let (out, _) =
            compose_mcp_preamble("continua".into(), true, &plan, caps, true, last.as_deref());
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
            stderr_truncated: false,
            emitiu_saida: true,
            sandbox_runner_hint: None,
            session_not_found: false,
            terminal_incident: true,
            session_id: None,
            context_reported: false,
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
            stderr_truncated: false,
            emitiu_saida: true,
            sandbox_runner_hint: None,
            session_not_found: false,
            terminal_incident: false,
            session_id: None,
            context_reported: false,
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
            stderr_truncated: false,
            emitiu_saida: true,
            sandbox_runner_hint: None,
            session_not_found: false,
            terminal_incident: false,
            session_id: None,
            context_reported: false,
        };

        assert!(matches!(
            process_failure_fallback(&*adapter, "claude-code", &outcome),
            Some(AgentEvent::Error { message })
                if message == "o agent `claude-code` saiu com código 17"
        ));
    }
}
