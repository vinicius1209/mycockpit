//! v0.2-α — abstração de agent. Cada CLI vira um adapter; o LOOP de execução
//! (spawn, leitura linha-a-linha, cancel, stderr, Done) é compartilhado em
//! `agent::run_agent`. O adapter varia só em 2 pontos: montar o `Command` e
//! mapear cada linha JSON → `AgentEvent`. O Claude porta a lógica atual 1:1.

use crate::agent::AgentEvent;
use tokio::process::Command;

/// Parâmetros de um run — montados pelo `run_agent`, consumidos pelo adapter.
pub struct RunRequest {
    pub prompt: String,
    pub cwd: String,
    pub resume: Option<String>,
    pub permission: String,
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
}

/// Resolve o id do agent → adapter concreto.
pub fn resolve(agent: &str) -> Result<Box<dyn AgentAdapter>, String> {
    match agent {
        "claude-code" | "" => Ok(Box::new(ClaudeAdapter)),
        other => Err(format!("agent não suportado ainda: {other}")),
    }
}

// ---------------- Claude Code (porta o map_events 1:1) ----------------

pub struct ClaudeAdapter;

impl AgentAdapter for ClaudeAdapter {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn build_command(&self, req: &RunRequest) -> Result<Command, String> {
        let mut cmd = Command::new("claude");
        cmd.arg("-p")
            .arg(&req.prompt)
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
            "liberado" => {
                cmd.arg("--permission-mode").arg("bypassPermissions");
            }
            _ => {
                cmd.arg("--permission-mode").arg("acceptEdits");
            }
        }
        if let Some(r) = &req.resume {
            cmd.arg("--resume").arg(r);
        }
        Ok(cmd)
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
                let usage = v.get("usage");
                let tok = |k: &str| {
                    usage
                        .and_then(|u| u.get(k))
                        .and_then(|x| x.as_u64())
                        .unwrap_or(0)
                };
                vec![AgentEvent::Result {
                    ok: !v.get("is_error").and_then(|x| x.as_bool()).unwrap_or(false),
                    text: v.get("result").and_then(|x| x.as_str()).map(str::to_string),
                    cost_usd: v.get("total_cost_usd").and_then(|x| x.as_f64()),
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
