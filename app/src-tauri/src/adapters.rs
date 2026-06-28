//! v0.2-α — abstração de agent. Cada CLI vira um adapter; o LOOP de execução
//! (spawn, leitura linha-a-linha, cancel, stderr, Done) é compartilhado em
//! `agent::run_agent`. O adapter varia só em 2 pontos: montar o `Command` e
//! mapear cada linha JSON → `AgentEvent`. O Claude porta a lógica atual 1:1.

use crate::agent::{AgentEvent, CostSource};
use crate::attachments::{Attachment, AttachmentKind};
use std::path::PathBuf;
use tokio::process::Command;

/// Parâmetros de um run — montados pelo `run_agent`, consumidos pelo adapter.
pub struct RunRequest {
    pub prompt: String,
    pub cwd: String,
    pub resume: Option<String>,
    pub permission: String,
    /// Modelo escolhido (None = default do CLI/config).
    pub model: Option<String>,
    /// Nível de esforço de raciocínio (None = default). Valores diferem por agent.
    pub effort: Option<String>,
    /// Anexos JÁ resolvidos: path ABSOLUTO, existente em disco, filtrado por
    /// `supports_attachment` (garantido pelo run_agent). O adapter só decide a sintaxe.
    pub attachments: Vec<Attachment>,
}

pub trait AgentAdapter: Send {
    /// Id estável (= binário lógico), usado em mensagens de erro.
    fn id(&self) -> &'static str;
    /// Monta o `Command` (binário + flags). O loop compartilhado null-a o stdin
    /// e pipa stdout/stderr — o adapter NÃO cuida disso.
    fn build_command(&self, req: &RunRequest) -> Result<Command, String>;
    /// Mapeia uma linha JSON do stream → 0..N eventos normalizados. `&mut self`
    /// permite guardar estado de parsing (correlação begin/end de ferramentas).
    fn map_line(&mut self, v: &serde_json::Value) -> Vec<AgentEvent>;
    /// Flush de itens pendentes no fim do stream (EOF normal).
    fn on_close(&mut self) -> Vec<AgentEvent> {
        Vec::new()
    }

    /// Capacidade declarada por tipo de anexo. Default = NÃO suporta nada → um
    /// agent novo é OBRIGADO a decidir (sem no-op que engole anexo em silêncio).
    fn supports_attachment(&self, _kind: &AttachmentKind) -> bool {
        false
    }

    /// Renderiza os anexos no comando/prompt. INVARIANTE: `atts` chega com path
    /// ABSOLUTO, existente, e já filtrado por `supports_attachment` — o adapter só
    /// decide a SINTAXE (flags/posição). Default no-op.
    fn render_attachments(&self, atts: &[Attachment], cmd: &mut Command, prompt: &mut String) {
        let _ = (atts, cmd, prompt);
    }
}

/// Resolve o id do agent → adapter concreto.
pub fn resolve(agent: &str) -> Result<Box<dyn AgentAdapter>, String> {
    match agent {
        "claude-code" | "" => Ok(Box::new(ClaudeAdapter)),
        "codex" => Ok(Box::new(CodexAdapter {
            // o stream do codex NÃO emite o modelo → lê do config p/ estimar custo
            model: Some(codex_config_model()),
        })),
        other => Err(format!("agent não suportado ainda: {other}")),
    }
}

/// O erro indica que a sessão do resume não existe? (Claude: "No conversation
/// found with session ID"). Dispara a degradação graciosa (recomeçar sem resume).
fn is_session_not_found(s: &str) -> bool {
    let l = s.to_lowercase();
    l.contains("no conversation found")
        || l.contains("session not found")
        || (l.contains("session") && l.contains("not found"))
}

// ---------------- Claude Code (porta o map_events 1:1) ----------------

pub struct ClaudeAdapter;

impl AgentAdapter for ClaudeAdapter {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn build_command(&self, req: &RunRequest) -> Result<Command, String> {
        let mut cmd = Command::new("claude");
        // anexos: injeta os paths no prompt (Read tool) + --add-dir (acesso fora do cwd)
        let mut prompt = req.prompt.clone();
        self.render_attachments(&req.attachments, &mut cmd, &mut prompt);
        cmd.arg("-p")
            .arg(&prompt)
            .arg("--output-format")
            .arg("stream-json")
            .arg("--verbose")
            .arg("--include-partial-messages")
            .current_dir(&req.cwd);
        // Política de permissão por projeto (docs/agent-runner.md §7). Achado do
        // M0: `--allowedTools` NÃO sandboxa; o gate real é `--disallowedTools`.
        match req.permission.as_str() {
            "leitura" => {
                cmd.arg("--disallowedTools")
                    .arg("Bash,Edit,Write,MultiEdit,NotebookEdit");
            }
            // Fusion read-only: bloqueia edição E desliga TODO MCP (candidatos
            // especulativos não podem ter efeito externo — email/Notion/infra).
            "fusion-ro" => {
                cmd.arg("--disallowedTools")
                    .arg("Bash,Edit,Write,MultiEdit,NotebookEdit")
                    .arg("--strict-mcp-config")
                    .arg("--mcp-config")
                    .arg("{\"mcpServers\":{}}");
            }
            "liberado" => {
                cmd.arg("--permission-mode").arg("bypassPermissions");
            }
            _ => {
                cmd.arg("--permission-mode").arg("acceptEdits");
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
        Ok(cmd)
    }

    fn supports_attachment(&self, kind: &AttachmentKind) -> bool {
        matches!(kind, AttachmentKind::Image | AttachmentKind::Pdf)
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
            // H2 — deltas de texto em streaming. Outros sub-eventos (block
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
                    if is_session_not_found(&errs) {
                        return vec![AgentEvent::SessionNotFound { message: errs }];
                    }
                }
                let usage = v.get("usage");
                let tok = |k: &str| {
                    usage
                        .and_then(|u| u.get(k))
                        .and_then(|x| x.as_u64())
                        .unwrap_or(0)
                };
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
                    input_tokens: tok("input_tokens"),
                    output_tokens: tok("output_tokens"),
                    cache_read: tok("cache_read_input_tokens"),
                    cache_creation: tok("cache_creation_input_tokens"),
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

    fn build_command(&self, req: &RunRequest) -> Result<Command, String> {
        let mut cmd = Command::new("codex");
        cmd.arg("exec")
            .arg("--json")
            .arg("--skip-git-repo-check")
            .arg("-C")
            .arg(&req.cwd)
            .current_dir(&req.cwd);
        // permissão (3 níveis) → sandbox do Codex (exec não tem --ask-for-approval)
        let sandbox = match req.permission.as_str() {
            "leitura" | "fusion-ro" => "read-only",
            "liberado" => "danger-full-access",
            _ => "workspace-write",
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
        // anexos: -i por imagem (após `resume` — é opção do subcomando ativo). O -i
        // é VARIÁDICO (<FILE>...) e comeria o prompt → separa com `--` (verificado A0).
        let mut prompt = req.prompt.clone();
        self.render_attachments(&req.attachments, &mut cmd, &mut prompt);
        if !req.attachments.is_empty() {
            cmd.arg("--");
        }
        cmd.arg(&prompt);
        Ok(cmd)
    }

    fn supports_attachment(&self, kind: &AttachmentKind) -> bool {
        // -i do Codex é só imagem; PDF é bloqueado no envio (capacidade explícita).
        matches!(kind, AttachmentKind::Image)
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
                let tok = |k: &str| {
                    usage
                        .and_then(|u| u.get(k))
                        .and_then(|x| x.as_u64())
                        .unwrap_or(0)
                };
                let nu = crate::pricing::NormalizedUsage {
                    input: tok("input_tokens"),
                    cached_input: tok("cached_input_tokens"),
                    output: tok("output_tokens"),
                };
                // Codex NÃO dá USD → estima por tokens × tabela (default = config gpt-5.5)
                let model = self.model.clone().unwrap_or_else(|| "gpt-5.5".to_string());
                let (cost_usd, cost_source) = crate::pricing::estimate(&model, &nu);
                vec![AgentEvent::Result {
                    ok: true,
                    text: None,
                    cost_usd,
                    cost_source,
                    input_tokens: nu.input,
                    output_tokens: nu.output,
                    cache_read: nu.cached_input,
                    cache_creation: 0,
                }]
            }
            "turn.failed" => {
                let msg = v
                    .pointer("/error/message")
                    .and_then(|x| x.as_str())
                    .unwrap_or("o turno do codex falhou")
                    .to_string();
                if is_session_not_found(&msg) {
                    vec![AgentEvent::SessionNotFound { message: msg }]
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
        // reasoning, todo_list, error (não-fatal — ex. plugin warp quebrado) → ignora
        _ => vec![],
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
