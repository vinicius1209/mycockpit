//! v0.2-α, abstração de agent. Cada CLI vira um adapter; o LOOP de execução
//! (spawn, leitura linha-a-linha, cancel, stderr, Done) é compartilhado em
//! `agent::run_agent`. O adapter varia só em 2 pontos: montar o `Command` e
//! mapear cada linha JSON → `AgentEvent`. O Claude porta a lógica atual 1:1.

use crate::agent::{AgentEvent, CostSource};
use crate::attachments::{Attachment, AttachmentKind};
use std::path::PathBuf;
use tokio::process::Command;

/// Parâmetros de um run, montados pelo `run_agent`, consumidos pelo adapter.
pub struct RunRequest {
    pub prompt: String,
    pub cwd: String,
    pub resume: Option<String>,
    pub permission: Permission,
    /// Modelo escolhido (None = default do CLI/config).
    pub model: Option<String>,
    /// Nível de esforço de raciocínio (None = default). Valores diferem por agent.
    pub effort: Option<String>,
    /// Anexos JÁ resolvidos: path ABSOLUTO, existente em disco, filtrado por
    /// `supports_attachment` (garantido pelo run_agent). O adapter só decide a sintaxe.
    pub attachments: Vec<Attachment>,
    /// Pastas extras liberadas ao agent (fora do cwd), JÁ resolvidas para paths
    /// absolutos existentes (por `mycockpit::resolve_extra_dirs`). Cada adapter
    /// emite `--add-dir <dir>` — o gate de diretório é fixo no spawn (headless).
    pub extra_dirs: Vec<String>,
    /// Interação inline (só Claude): quando presente, registra o MCP server (socket)
    /// da interação pendente — `ask_user` em TODOS os modos com MCP + o
    /// `--permission-prompt-tool` só no Padrão. `.0` = path do binário do MCP server
    /// (= este app, subcomando `approval-server`); `.1` = path do socket app↔server
    /// (por-run). None = sem interação inline (degrada p/ o comportamento de antes).
    pub approval: Option<(String, String)>,
}

/// Política de permissão POR RUN, parseada UMA vez na fronteira (run_agent).
/// Enum EXAUSTIVO: valor desconhecido é erro na entrada, nunca fail-open
/// (antes um typo caía no `_ =>` dos adapters e ganhava permissão de ESCRITA).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Permission {
    Leitura,
    Padrao,
    Liberado,
    /// Candidato do Fusion: read-only + MCP desligado (sem efeito externo).
    FusionRo,
}

impl Permission {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "leitura" => Ok(Self::Leitura),
            "padrao" | "" => Ok(Self::Padrao),
            "liberado" => Ok(Self::Liberado),
            "fusion-ro" => Ok(Self::FusionRo),
            other => Err(format!(
                "modo de permissão desconhecido: '{other}' (esperado leitura|padrao|liberado)"
            )),
        }
    }
}

pub trait AgentAdapter: Send {
    /// Id estável (= binário lógico), usado em mensagens de erro.
    fn id(&self) -> &'static str;
    /// Monta o `Command` (binário + flags). O loop compartilhado null-a o stdin
    /// e pipa stdout/stderr, o adapter NÃO cuida disso. `&mut self`: o adapter
    /// pode fixar estado do run (ex. Codex guarda o modelo requisitado p/ custo).
    fn build_command(&mut self, req: &RunRequest) -> Result<Command, String>;
    /// Mapeia uma linha JSON do stream → 0..N eventos normalizados. `&mut self`
    /// permite guardar estado de parsing (correlação begin/end de ferramentas).
    fn map_line(&mut self, v: &serde_json::Value) -> Vec<AgentEvent>;
    /// Flush de itens pendentes no fim do stream (EOF normal).
    fn on_close(&mut self) -> Vec<AgentEvent> {
        Vec::new()
    }

    /// Como tratar UMA linha CRUA de stdout. Default (adapters ESTRUTURADOS):
    /// trima, pula vazia, parseia JSON → `map_line`; linha não-JSON vira `Unknown`
    /// (regra de ouro: nunca descarta em silêncio). Adapters NÃO-estruturados
    /// (sem stream JSON, ex. `agy -p`) sobrescrevem p/ tratar a linha como TEXTO
    /// do assistente. Preserva o comportamento 1:1 do Claude/Codex.
    fn on_stdout_line(&mut self, line: &str) -> Vec<AgentEvent> {
        let line = line.trim();
        if line.is_empty() {
            return Vec::new();
        }
        match serde_json::from_str::<serde_json::Value>(line) {
            Ok(v) => self.map_line(&v),
            Err(_) => vec![AgentEvent::Unknown {
                raw: serde_json::Value::String(line.to_string()),
            }],
        }
    }

    /// Capacidade declarada por tipo de anexo. Default = NÃO suporta nada → um
    /// agent novo é OBRIGADO a decidir (sem no-op que engole anexo em silêncio).
    fn supports_attachment(&self, _kind: &AttachmentKind) -> bool {
        false
    }

    /// Renderiza os anexos no comando/prompt. INVARIANTE: `atts` chega com path
    /// ABSOLUTO, existente, e já filtrado por `supports_attachment`, o adapter só
    /// decide a SINTAXE (flags/posição). Default no-op.
    fn render_attachments(&self, atts: &[Attachment], cmd: &mut Command, prompt: &mut String) {
        let _ = (atts, cmd, prompt);
    }

    /// A mensagem indica que a sessão do resume não existe NESTE CLI? Cada
    /// adapter conhece só as SUAS frases (casar frase exata; o AND genérico
    /// `session && not found` casava erro de tool e dropava resume em silêncio).
    /// Default false: agent novo sem frase mapeada vira card de erro (seguro).
    fn is_session_not_found(&self, msg: &str) -> bool {
        let _ = msg;
        false
    }

    /// A mensagem indica LIMITE de uso/cota atingido neste CLI? Devolve o hint
    /// de reset quando o CLI informa ("resets at 3pm"). Default None: agent sem
    /// frase mapeada vira card de erro comum, que também oferece o revezamento
    /// manual. NEEDS-VERIFY: frases de docs/relatos; o 1º estouro real é o fixture.
    fn classify_limit(&self, msg: &str) -> Option<LimitHit> {
        let _ = msg;
        None
    }
}

/// Sinal de limite de uso/cota atingido (+ hint de reset, se o CLI informou).
pub struct LimitHit {
    pub reset_hint: Option<String>,
}

/// Resolve o id do agent → adapter concreto.
pub fn resolve(agent: &str) -> Result<Box<dyn AgentAdapter>, String> {
    match agent {
        "claude-code" | "" => Ok(Box::new(ClaudeAdapter)),
        "codex" => Ok(Box::new(CodexAdapter {
            // o stream do codex NÃO emite o modelo → lê do config p/ estimar custo
            model: Some(codex_config_model()),
        })),
        "agy" => Ok(Box::<AgyAdapter>::default()),
        other => Err(format!("agent não suportado ainda: {other}")),
    }
}

/// Lê um inteiro não-negativo de um sub-objeto `usage` (0 se ausente/inválido).
fn usage_u64(usage: Option<&serde_json::Value>, key: &str) -> u64 {
    usage
        .and_then(|u| u.get(key))
        .and_then(|x| x.as_u64())
        .unwrap_or(0)
}


// ---------------- Claude Code (porta o map_events 1:1) ----------------

pub struct ClaudeAdapter;

impl AgentAdapter for ClaudeAdapter {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn build_command(&mut self, req: &RunRequest) -> Result<Command, String> {
        let mut cmd = Command::new("claude");
        // anexos: injeta os paths no prompt (Read tool) + --add-dir (acesso fora do cwd)
        let mut prompt = req.prompt.clone();
        self.render_attachments(&req.attachments, &mut cmd, &mut prompt);
        // ATENÇÃO à ordem: TODAS as flags vêm ANTES do prompt. O prompt é
        // posicional e entra por último, atrás de `--` (ver fim da função). O `--`
        // encerra o parsing de opções, então qualquer flag DEPOIS dele viraria
        // posicional — foi o bug e9f7b737: `-- <prompt> --output-format …` fazia o
        // Claude ignorar o stream-json e cair em modo TEXTO (UI sem output).
        cmd.arg("-p")
            .arg("--output-format")
            .arg("stream-json")
            .arg("--verbose")
            .arg("--include-partial-messages")
            .current_dir(&req.cwd);
        // Política de permissão por projeto (docs/agent-runner.md §7). Achado do
        // M0: `--allowedTools` NÃO sandboxa; o gate real é `--disallowedTools`.
        //
        // Interação PENDENTE (docs/interactive-input.md): o MCP server (socket) sobe
        // em TODOS os modos com MCP ligado — `ask_user` (tool de CONTEÚDO) vale sempre.
        // O `--permission-prompt-tool` (aprovação) segue SÓ no Padrão. Desabilitamos
        // os built-ins interativos (AskUserQuestion, ExitPlanMode) SEMPRE (eles erram
        // no `-p` headless) — o modelo usa a NOSSA `ask_user`; ExitPlanMode degrada p/
        // texto. Os disallow são MESCLADOS com os de read-only (não sobrescreve).
        const INTERACTIVE_BUILTINS: &str = "AskUserQuestion,ExitPlanMode";
        let mut disallowed: Vec<&str> = vec![INTERACTIVE_BUILTINS];
        match req.permission {
            Permission::Leitura => {
                disallowed.insert(0, "Bash,Edit,Write,MultiEdit,NotebookEdit");
            }
            // Fusion read-only: bloqueia edição E desliga TODO MCP (candidatos
            // especulativos não podem ter efeito externo, email/Notion/infra). Sem
            // MCP → sem ask_user aqui (perguntas viram texto); os built-ins seguem
            // desabilitados p/ não errarem.
            Permission::FusionRo => {
                disallowed.insert(0, "Bash,Edit,Write,MultiEdit,NotebookEdit");
                cmd.arg("--strict-mcp-config")
                    .arg("--mcp-config")
                    .arg("{\"mcpServers\":{}}");
            }
            Permission::Liberado => {
                cmd.arg("--permission-mode").arg("bypassPermissions");
            }
            Permission::Padrao => {
                cmd.arg("--permission-mode").arg("acceptEdits");
            }
        }
        // disallowedTools (mesclado): o gate de escrita (por modo) + os interativos.
        cmd.arg("--disallowedTools").arg(disallowed.join(","));

        // MCP server (socket) da interação inline: sobe SEMPRE que o app montou o
        // socket, EXCETO FusionRo (que desliga MCP acima). Registra as 2 tools
        // (approval_prompt + ask_user via tools/list). Só liga o
        // --permission-prompt-tool no Padrão. Se o socket não montou, degrada p/ o
        // comportamento de antes — nunca derruba o run. Ver approval.rs.
        let mcp_on = !matches!(req.permission, Permission::FusionRo);
        if mcp_on {
            if let Some((server_bin, sock)) = &req.approval {
                let mcp = serde_json::json!({
                    "mcpServers": {
                        crate::approval::MCP_SERVER_NAME: {
                            "type": "stdio",
                            "command": server_bin,
                            "args": ["approval-server"]
                        }
                    }
                });
                cmd.arg("--mcp-config").arg(mcp.to_string());
                // AUTO-APROVA a ask_user (achado A1 da revisão): sem isto, em
                // acceptEdits cada pergunta disparava ANTES um card de aprovação
                // ("aprovar uso de ask_user?") = 2 cards; e em Leitura (sem
                // permission-mode) a tool ERRAVA "requires approval" — com o nudge
                // ainda mandando o modelo insistir nela. A ask_user é tool de
                // CONTEÚDO nossa (só pergunta ao usuário) → segura de allowlist.
                cmd.arg("--allowedTools").arg(format!(
                    "mcp__{}__{}",
                    crate::approval::MCP_SERVER_NAME,
                    crate::approval::ASK_USER_TOOL
                ));
                // permission-prompt-tool (aprovação granular) SÓ no Padrão.
                if matches!(req.permission, Permission::Padrao) {
                    cmd.arg("--permission-prompt-tool").arg(format!(
                        "mcp__{}__{}",
                        crate::approval::MCP_SERVER_NAME,
                        crate::approval::APPROVAL_TOOL
                    ));
                }
                // Nudge: manda o modelo usar a NOSSA ask_user em vez de perguntar em
                // texto quando houver escolhas claras. Flag verificada em `claude
                // --help`: `--append-system-prompt <prompt>`.
                cmd.arg("--append-system-prompt").arg(format!(
                    "Quando precisar de uma decisão ou escolha do usuário, chame a tool mcp__{}__{} (do MCP {}) com as perguntas e opções, em vez de escrever a pergunta como texto.",
                    crate::approval::MCP_SERVER_NAME,
                    crate::approval::ASK_USER_TOOL,
                    crate::approval::MCP_SERVER_NAME,
                ));
                // o socket é lido pelo MCP server (subprocesso) via env.
                cmd.env(crate::approval::SOCK_ENV, sock);
            }
        }
        // Claude: --model <alias> · --effort low|medium|high|xhigh|max (verificado)
        if let Some(m) = &req.model {
            cmd.arg("--model").arg(m);
        }
        if let Some(e) = &req.effort {
            cmd.arg("--effort").arg(e);
        }
        if let Some(r) = &req.resume {
            cmd.arg("--resume").arg(r);
        }
        // pastas extras (fora do cwd): --add-dir por pasta (aceita múltiplas).
        for d in &req.extra_dirs {
            cmd.arg("--add-dir").arg(d);
        }
        // Prompt POSICIONAL por último, atrás do `--`: protege texto que começa com
        // "-" (diff `--- a/…`, lista markdown) SEM engolir as flags acima.
        cmd.arg("--").arg(&prompt);
        Ok(cmd)
    }

    fn supports_attachment(&self, kind: &AttachmentKind) -> bool {
        matches!(kind, AttachmentKind::Image | AttachmentKind::Pdf)
    }

    fn is_session_not_found(&self, msg: &str) -> bool {
        msg.to_lowercase()
            .contains("no conversation found with session id") // verificado
    }

    fn classify_limit(&self, msg: &str) -> Option<LimitHit> {
        let l = msg.to_lowercase();
        if !l.contains("usage limit") {
            return None;
        }
        // "…will reset at 3pm (America/Sao_Paulo)." → "3pm (america/sao_paulo)"
        let reset_hint = l.find("reset at ").map(|i| {
            l[i + "reset at ".len()..]
                .chars()
                .take(32)
                .collect::<String>()
                .trim_end_matches('.')
                .trim()
                .to_string()
        });
        Some(LimitHit { reset_hint })
    }

    fn render_attachments(&self, atts: &[Attachment], cmd: &mut Command, prompt: &mut String) {
        if atts.is_empty() {
            return;
        }
        // concede ao Read tool acesso à pasta da conversa (verificado: --add-dir)
        if let Some(dir) = std::path::Path::new(&atts[0].path).parent() {
            cmd.arg("--add-dir").arg(dir);
        }
        prompt.push_str("\n\nArquivos anexados (use o Read tool para abri-los):\n");
        for a in atts {
            // path ABSOLUTO entre crases (blinda espaços, ex. "Application Support")
            prompt.push_str(&format!("- `{}` ({})\n", a.path, a.mime));
        }
    }

    fn map_line(&mut self, v: &serde_json::Value) -> Vec<AgentEvent> {
        match v.get("type").and_then(|x| x.as_str()).unwrap_or("") {
            "system" => {
                if v.get("subtype").and_then(|x| x.as_str()) == Some("init") {
                    vec![AgentEvent::Session {
                        session_id: v
                            .get("session_id")
                            .and_then(|x| x.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        model: v.get("model").and_then(|x| x.as_str()).map(str::to_string),
                        tools: v
                            .get("tools")
                            .and_then(|x| x.as_array())
                            .map(Vec::len)
                            .unwrap_or(0),
                    }]
                } else {
                    vec![]
                }
            }
            // H2, deltas de texto em streaming. Outros sub-eventos (block
            // start/stop, tool input deltas) são ignorados; o texto vem dos deltas.
            "stream_event" => {
                let ev = v.get("event");
                let is_delta = ev.and_then(|e| e.get("type")).and_then(|x| x.as_str())
                    == Some("content_block_delta");
                if is_delta {
                    let delta = ev.and_then(|e| e.get("delta"));
                    let is_text = delta.and_then(|d| d.get("type")).and_then(|x| x.as_str())
                        == Some("text_delta");
                    if is_text {
                        if let Some(t) = delta.and_then(|d| d.get("text")).and_then(|x| x.as_str())
                        {
                            return vec![AgentEvent::TextDelta {
                                text: t.to_string(),
                            }];
                        }
                    }
                }
                vec![]
            }
            // Mensagem assistant completa: texto (o front deduplica com os deltas)
            // + tool_use como cartões.
            "assistant" => {
                let mut out = Vec::new();
                if let Some(content) = v.pointer("/message/content").and_then(|x| x.as_array()) {
                    for block in content {
                        match block.get("type").and_then(|x| x.as_str()) {
                            Some("text") => {
                                if let Some(t) = block.get("text").and_then(|x| x.as_str()) {
                                    if !t.trim().is_empty() {
                                        out.push(AgentEvent::Text { text: t.to_string() });
                                    }
                                }
                            }
                            Some("tool_use") => out.push(AgentEvent::Tool {
                                id: block
                                    .get("id")
                                    .and_then(|x| x.as_str())
                                    .unwrap_or_default()
                                    .to_string(),
                                name: block
                                    .get("name")
                                    .and_then(|x| x.as_str())
                                    .unwrap_or("tool")
                                    .to_string(),
                                input: block
                                    .get("input")
                                    .cloned()
                                    .unwrap_or(serde_json::Value::Null),
                            }),
                            _ => {}
                        }
                    }
                }
                // Footprint ATUAL do contexto: usage da própria mensagem (input +
                // cache lido + cache criado ≈ prompt desta chamada). Mensagens de
                // SUBAGENT (parent_tool_use_id) têm contexto próprio e não contam.
                // NEEDS-VERIFY: o filtro de subagent contra um run real.
                let is_subagent = v
                    .get("parent_tool_use_id")
                    .map(|x| !x.is_null())
                    .unwrap_or(false);
                if !is_subagent {
                    if let Some(u) = v.pointer("/message/usage") {
                        let tokens = usage_u64(Some(u), "input_tokens")
                            + usage_u64(Some(u), "cache_read_input_tokens")
                            + usage_u64(Some(u), "cache_creation_input_tokens");
                        if tokens > 0 {
                            out.push(AgentEvent::ContextUsage { tokens });
                        }
                    }
                }
                out
            }
            // Mensagens "user" no stream carregam os tool_result: viram um resumo
            // ligado à linha da tool (id). O prompt ecoado do usuário não tem
            // blocos tool_result e cai fora naturalmente.
            "user" => {
                let mut out = Vec::new();
                if let Some(content) = v.pointer("/message/content").and_then(|x| x.as_array()) {
                    for block in content {
                        if block.get("type").and_then(|x| x.as_str()) != Some("tool_result") {
                            continue;
                        }
                        let id = block
                            .get("tool_use_id")
                            .and_then(|x| x.as_str())
                            .unwrap_or_default()
                            .to_string();
                        if id.is_empty() {
                            continue;
                        }
                        let ok = !block
                            .get("is_error")
                            .and_then(|x| x.as_bool())
                            .unwrap_or(false);
                        let full = match block.get("content") {
                            Some(serde_json::Value::String(s)) => s.clone(),
                            Some(serde_json::Value::Array(a)) => a
                                .iter()
                                .filter_map(|b| b.get("text").and_then(|x| x.as_str()))
                                .collect::<Vec<_>>()
                                .join("\n"),
                            _ => String::new(),
                        };
                        let lines = if full.trim().is_empty() {
                            0
                        } else {
                            full.lines().count() as u64
                        };
                        let mut text: String = full.chars().take(600).collect();
                        if full.chars().count() > 600 {
                            text.push('…');
                        }
                        out.push(AgentEvent::ToolResult { id, ok, text, lines });
                    }
                }
                out
            }
            "result" => {
                let is_error = v.get("is_error").and_then(|x| x.as_bool()).unwrap_or(false);
                // resume falhou (sessão não existe) → sinaliza p/ degradação graciosa,
                // em vez de virar um cartão de erro (o run_agent recomeça sem resume).
                if is_error {
                    let errs = v
                        .get("errors")
                        .and_then(|x| x.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|e| e.as_str())
                                .collect::<Vec<_>>()
                                .join(" ")
                        })
                        .unwrap_or_default();
                    if self.is_session_not_found(&errs) {
                        return vec![AgentEvent::SessionNotFound { message: errs }];
                    }
                    // Limite de uso/cota: cartão ACIONÁVEL (revezamento), não erro
                    // morto. A mensagem humana costuma vir no campo `result`.
                    let human = v.get("result").and_then(|x| x.as_str()).unwrap_or("");
                    let msg = format!("{errs} {human}").trim().to_string();
                    if let Some(hit) = self.classify_limit(&msg) {
                        return vec![AgentEvent::LimitReached {
                            message: msg,
                            reset_hint: hit.reset_hint,
                        }];
                    }
                }
                let usage = v.get("usage");
                // O Claude entrega o custo pronto (total_cost_usd) → Reported.
                let cost_usd = v.get("total_cost_usd").and_then(|x| x.as_f64());
                vec![AgentEvent::Result {
                    ok: !is_error,
                    text: v.get("result").and_then(|x| x.as_str()).map(str::to_string),
                    cost_source: if cost_usd.is_some() {
                        CostSource::Reported
                    } else {
                        CostSource::Unknown
                    },
                    cost_usd,
                    input_tokens: usage_u64(usage, "input_tokens"),
                    output_tokens: usage_u64(usage, "output_tokens"),
                    cache_read: usage_u64(usage, "cache_read_input_tokens"),
                    cache_creation: usage_u64(usage, "cache_creation_input_tokens"),
                }]
            }
            // Regra de ouro do agent-runner.md: tipo desconhecido vira Unknown,
            // nunca é silenciosamente descartado (nem crash).
            _ => vec![AgentEvent::Unknown { raw: v.clone() }],
        }
    }
}

// ---------------- Codex (`codex exec --json`, schema thread/turn/item) ----------------

#[derive(Default)]
pub struct CodexAdapter {
    /// Modelo capturado do stream (p/ estimar custo; Codex não dá USD).
    model: Option<String>,
}

impl AgentAdapter for CodexAdapter {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn build_command(&mut self, req: &RunRequest) -> Result<Command, String> {
        // o modelo REQUISITADO substitui o default do config: o Session event e a
        // estimativa de custo leem self.model (senão estima com a tabela errada).
        if let Some(m) = &req.model {
            self.model = Some(m.clone());
        }
        let mut cmd = Command::new("codex");
        cmd.arg("exec")
            .arg("--json")
            .arg("--skip-git-repo-check")
            .arg("-C")
            .arg(&req.cwd)
            .current_dir(&req.cwd);
        // permissão (3 níveis) → sandbox do Codex (exec não tem --ask-for-approval)
        let sandbox = match req.permission {
            Permission::Leitura | Permission::FusionRo => "read-only",
            Permission::Liberado => "danger-full-access",
            Permission::Padrao => "workspace-write",
        };
        cmd.arg("-s").arg(sandbox);
        // Codex: -m <model> · effort via override de config (não tem flag dedicada
        // no exec). Valores: minimal|low|medium|high|xhigh. ANTES de `resume`.
        if let Some(m) = &req.model {
            cmd.arg("-m").arg(m);
        }
        if let Some(e) = &req.effort {
            cmd.arg("-c").arg(format!("model_reasoning_effort={e}"));
        }
        // resume: `codex exec resume <thread_id> …`
        if let Some(r) = &req.resume {
            cmd.arg("resume").arg(r);
        }
        // pastas extras (fora do cwd): --add-dir <DIR> (writable alongside workspace).
        for d in &req.extra_dirs {
            cmd.arg("--add-dir").arg(d);
        }
        // anexos: -i por imagem (após `resume`, é opção do subcomando ativo). O -i
        // é VARIÁDICO (<FILE>...) e comeria o prompt → separa com `--` (verificado A0).
        let mut prompt = req.prompt.clone();
        self.render_attachments(&req.attachments, &mut cmd, &mut prompt);
        // `--` SEMPRE (não só com anexos): prompt começando com "-" não vira flag.
        cmd.arg("--");
        cmd.arg(&prompt);
        Ok(cmd)
    }

    fn supports_attachment(&self, kind: &AttachmentKind) -> bool {
        // -i do Codex é só imagem; PDF é bloqueado no envio (capacidade explícita).
        matches!(kind, AttachmentKind::Image)
    }

    /// NEEDS-VERIFY: a frase do `turn.failed` num resume de thread inexistente
    /// ainda não foi capturada de um run real; a do stderr foi (verificado).
    fn is_session_not_found(&self, msg: &str) -> bool {
        msg.to_lowercase()
            .contains("no rollout found for thread id") // verificado (stderr)
    }

    fn classify_limit(&self, msg: &str) -> Option<LimitHit> {
        let l = msg.to_lowercase();
        let hit = l.contains("exceeded your current quota")
            || l.contains("insufficient_quota")
            || l.contains("usage limit");
        hit.then(|| LimitHit { reset_hint: None })
    }

    fn render_attachments(&self, atts: &[Attachment], cmd: &mut Command, _prompt: &mut String) {
        for a in atts {
            cmd.arg("-i").arg(&a.path); // path absoluto; argv não passa por shell
        }
    }

    fn map_line(&mut self, v: &serde_json::Value) -> Vec<AgentEvent> {
        match v.get("type").and_then(|x| x.as_str()).unwrap_or("") {
            "thread.started" => {
                let id = v
                    .get("thread_id")
                    .and_then(|x| x.as_str())
                    .unwrap_or_default()
                    .to_string();
                vec![AgentEvent::Session {
                    session_id: id,
                    model: self.model.clone(),
                    tools: 0,
                }]
            }
            "item.completed" => match v.get("item") {
                Some(item) => map_codex_item(item),
                None => vec![AgentEvent::Unknown { raw: v.clone() }],
            },
            "turn.completed" => {
                let usage = v.get("usage");
                let nu = crate::pricing::NormalizedUsage {
                    input: usage_u64(usage, "input_tokens"),
                    cached_input: usage_u64(usage, "cached_input_tokens"),
                    output: usage_u64(usage, "output_tokens"),
                };
                // Codex NÃO dá USD → estima por tokens × tabela (default = config gpt-5.5)
                let model = self.model.clone().unwrap_or_else(|| "gpt-5.5".to_string());
                let (cost_usd, cost_source) = crate::pricing::estimate(&model, &nu);
                let mut out = Vec::new();
                // footprint do contexto do turno (prompt = novo + cacheado)
                let ctx = nu.input + nu.cached_input;
                if ctx > 0 {
                    out.push(AgentEvent::ContextUsage { tokens: ctx });
                }
                out.push(AgentEvent::Result {
                    ok: true,
                    text: None,
                    cost_usd,
                    cost_source,
                    input_tokens: nu.input,
                    output_tokens: nu.output,
                    cache_read: nu.cached_input,
                    cache_creation: 0,
                });
                out
            }
            "turn.failed" => {
                let msg = v
                    .pointer("/error/message")
                    .and_then(|x| x.as_str())
                    .unwrap_or("o turno do codex falhou")
                    .to_string();
                if self.is_session_not_found(&msg) {
                    vec![AgentEvent::SessionNotFound { message: msg }]
                } else if let Some(hit) = self.classify_limit(&msg) {
                    vec![AgentEvent::LimitReached {
                        message: msg,
                        reset_hint: hit.reset_hint,
                    }]
                } else {
                    vec![AgentEvent::Error { message: msg }]
                }
            }
            // begin/started e turn.started não viram cartão (mostramos no completed)
            "item.started" | "item.updated" | "turn.started" => vec![],
            _ => vec![AgentEvent::Unknown { raw: v.clone() }],
        }
    }
}

/// Mapeia um `item` do Codex (em item.completed) → evento normalizado.
fn map_codex_item(item: &serde_json::Value) -> Vec<AgentEvent> {
    let id = item
        .get("id")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string();
    let item_type = item.get("type").and_then(|x| x.as_str()).unwrap_or("");
    match item_type {
        "agent_message" => {
            if let Some(t) = item.get("text").and_then(|x| x.as_str()) {
                if !t.trim().is_empty() {
                    return vec![AgentEvent::Text { text: t.to_string() }];
                }
            }
            vec![]
        }
        "command_execution" => vec![AgentEvent::Tool {
            id,
            name: "Bash".to_string(),
            input: serde_json::json!({
                "command": item.get("command").and_then(|x| x.as_str()).unwrap_or("")
            }),
        }],
        "mcp_tool_call" => vec![AgentEvent::Tool {
            id,
            name: item
                .get("tool")
                .and_then(|x| x.as_str())
                .unwrap_or("mcp")
                .to_string(),
            input: item.get("arguments").cloned().unwrap_or(serde_json::Value::Null),
        }],
        "web_search" => vec![AgentEvent::Tool {
            id,
            name: "WebSearch".to_string(),
            input: serde_json::json!({
                "query": item.get("query").and_then(|x| x.as_str()).unwrap_or("")
            }),
        }],
        "file_change" => vec![AgentEvent::Tool {
            id,
            name: "Edit".to_string(),
            input: item.get("changes").cloned().unwrap_or(serde_json::Value::Null),
        }],
        // reasoning, todo_list, error (não-fatal, ex. plugin warp quebrado) → ignora
        _ => vec![],
    }
}

// ---------------- Antigravity CLI (`agy -p`, print mode, NÃO-estruturado) ----------------
//
// O `agy` (sucessor do Gemini CLI) na v1.0.16 NÃO expõe `--output-format json`:
// o print mode (`-p`) roda o loop de agente (edita arquivos, roda comandos) e
// devolve só o TEXTO final no stdout. Então é o caso "agent sem JSON" que o
// agent-runner.md previu (estratégia não-estruturada, gêmea do Aider): a UI
// degrada graciosa (sem stream de tools, sem custo — reports_usage=false); a
// observabilidade do que mudou vem do `git diff` na aba Alterações.
//
// Achados verificados na máquina (agy 1.0.16):
//   • `-p` SEM --add-dir edita um scratch isolado, NÃO o cwd → --add-dir <cwd> é
//     OBRIGATÓRIO p/ ele mexer no repo real.
//   • print mode + stdin null TRAVA esperando aprovação → --dangerously-skip-
//     permissions é obrigatório p/ não pendurar.
//   • stdout é texto puro (exit 0, sem stderr no caminho feliz).
// Roadmap: quando o agy ganhar `--output-format json`, migra p/ StructuredAdapter
// (tool-view ao vivo + custo). Resume (--continue/--conversation) fica p/ depois:
// o print mode não expõe o id da conversa no stdout.
#[derive(Default)]
pub struct AgyAdapter {
    /// Session já emitido? (a 1ª linha de stdout dispara o Session uma vez).
    started: bool,
    /// Modelo requisitado (p/ o rótulo no Session). None = default do agy (Flash).
    model: Option<String>,
}

impl AgentAdapter for AgyAdapter {
    fn id(&self) -> &'static str {
        "agy"
    }

    fn build_command(&mut self, req: &RunRequest) -> Result<Command, String> {
        let mut cmd = Command::new("agy");
        cmd.arg("-p")
            .arg(&req.prompt)
            // amarra o cwd real (senão o print mode edita o scratch, não o repo).
            .arg("--add-dir")
            .arg(&req.cwd)
            .current_dir(&req.cwd);
        // pastas extras (fora do cwd): mais um --add-dir por pasta.
        for d in &req.extra_dirs {
            cmd.arg("--add-dir").arg(d);
        }
        // modelo: o value do front É a string exata do agy ("Gemini 3.5 Flash (Low)",
        // "Claude Opus 4.6 (Thinking)"…). "default"/None = deixa o agy escolher.
        if let Some(m) = &req.model {
            if m != "default" {
                self.model = Some(m.clone());
                cmd.arg("--model").arg(m);
            }
        }
        // print mode não tem TUI p/ aprovar mid-run e o stdin é null → auto-aprova
        // sempre (senão trava). Leitura/Fusion ganham --sandbox como MELHOR ESFORÇO
        // (não é read-only real; limite documentado, igual PTY no agent-runner.md §7).
        cmd.arg("--dangerously-skip-permissions");
        if matches!(req.permission, Permission::Leitura | Permission::FusionRo) {
            cmd.arg("--sandbox");
        }
        Ok(cmd)
    }

    /// agy print mode não emite JSON → `map_line` não é chamado (o on_stdout_line
    /// sobrescrito trata texto). Defensivo: se um dia emitir JSON, não perde a linha.
    fn map_line(&mut self, v: &serde_json::Value) -> Vec<AgentEvent> {
        vec![AgentEvent::Unknown { raw: v.clone() }]
    }

    /// NÃO-ESTRUTURADO: cada linha de stdout é TEXTO do assistente (não JSON). A 1ª
    /// linha emite também o Session (rótulo do modelo). Blank lines são preservadas
    /// (parágrafos do markdown). O turno fecha no Done (sem Result → sem custo).
    fn on_stdout_line(&mut self, line: &str) -> Vec<AgentEvent> {
        let mut out = Vec::new();
        if !self.started {
            self.started = true;
            out.push(AgentEvent::Session {
                session_id: String::new(),
                model: self.model.clone(),
                tools: 0,
            });
        }
        out.push(AgentEvent::TextDelta {
            text: format!("{line}\n"),
        });
        out
    }

    /// Frases extraídas do binário do agy 1.1.1 (strings do bundle Go/Codeium):
    /// a UI de esgotamento usa "Out of credits"; a camada gRPC expõe
    /// ResourceExhausted (com e sem underscore, conforme o formatador). Mantém
    /// quota/rate limit como rede genérica de provedor.
    fn classify_limit(&self, msg: &str) -> Option<LimitHit> {
        let l = msg.to_lowercase();
        let hit = l.contains("out of credits")
            || l.contains("resource_exhausted")
            || l.contains("resourceexhausted")
            || l.contains("quota")
            || l.contains("rate limit")
            || l.contains("usage limit");
        hit.then(|| LimitHit { reset_hint: None })
    }
}

/// Modelo default do Codex (CODEX_HOME ou ~/.codex)/config.toml. O stream do
/// `codex exec --json` NÃO expõe o modelo, então essa é a fonte robusta p/ custo.
fn codex_config_model() -> String {
    let dir = std::env::var("CODEX_HOME")
        .map(PathBuf::from)
        .ok()
        .or_else(|| std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".codex")));
    dir.and_then(|d| std::fs::read_to_string(d.join("config.toml")).ok())
        .and_then(|t| t.parse::<toml_edit::DocumentMut>().ok())
        .and_then(|doc| doc.get("model").and_then(|v| v.as_str()).map(str::to_string))
        .unwrap_or_else(|| "gpt-5.5".to_string())
}
