//! M3 — dispatch do Claude Code.
//!
//! Spawna `claude -p --output-format stream-json --verbose --include-partial-messages`
//! na pasta do projeto, parseia o JSONL (lógica portada do spike M0) e streama
//! eventos normalizados para o frontend via tauri::ipc::Channel.

use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Notify;

/// Registro de runs ativos → permite cancelar um run em andamento (H1).
/// Mapeia run_id → sinal de cancelamento; o loop do run escuta esse sinal.
#[derive(Default)]
pub struct RunRegistry(pub Mutex<HashMap<String, Arc<Notify>>>);

/// Evento normalizado enviado ao frontend (1º adapter do docs/agent-runner.md).
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
    /// Pedaço de texto em streaming (H2 — `--include-partial-messages`).
    TextDelta {
        text: String,
    },
    Tool {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    Result {
        ok: bool,
        text: Option<String>,
        cost_usd: Option<f64>,
        input_tokens: u64,
        output_tokens: u64,
        cache_read: u64,
        cache_creation: u64,
    },
    /// Erro do processo/agent (H3): spawn, stderr ou exit code ≠ 0.
    Error {
        message: String,
    },
    /// Run interrompido pelo usuário (H1).
    Cancelled,
    Done {
        code: Option<i32>,
    },
}

#[tauri::command]
pub async fn run_claude(
    run_id: String,
    prompt: String,
    cwd: String,
    resume: Option<String>,
    permission: String,
    on_event: Channel<AgentEvent>,
    registry: tauri::State<'_, RunRegistry>,
) -> Result<(), String> {
    let mut cmd = Command::new("claude");
    cmd.arg("-p")
        .arg(&prompt)
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        .arg("--include-partial-messages")
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Política de permissão por projeto (ver docs/agent-runner.md §7).
    // Achado do M0: `--allowedTools` NÃO sandboxa; o gate real é `--disallowedTools`.
    match permission.as_str() {
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

    if let Some(r) = &resume {
        cmd.arg("--resume").arg(r);
    }

    let mut child = cmd.spawn().map_err(|e| {
        format!("não consegui executar `claude`: {e}. Ele está instalado e no PATH?")
    })?;

    let stdout = child.stdout.take().ok_or("sem stdout do processo")?;
    let stderr = child.stderr.take();
    let mut reader = BufReader::new(stdout).lines();

    // H3 — coleta o stderr em paralelo p/ reportar erros de processo.
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

    // H1 — registra o sinal de cancelamento deste run.
    let notify = Arc::new(Notify::new());
    if let Ok(mut map) = registry.0.lock() {
        map.insert(run_id.clone(), notify.clone());
    }

    let mut cancelled = false;
    loop {
        tokio::select! {
            line = reader.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        let line = line.trim();
                        if line.is_empty() {
                            continue;
                        }
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                            for ev in map_events(&v) {
                                let _ = on_event.send(ev);
                            }
                        }
                    }
                    Ok(None) => break, // EOF — processo terminou
                    Err(_) => break,
                }
            }
            _ = notify.notified() => {
                cancelled = true;
                // SIGKILL no processo; a sessão segue resumível via --resume.
                let _ = child.start_kill();
                break;
            }
        }
    }

    if let Ok(mut map) = registry.0.lock() {
        map.remove(&run_id);
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let stderr_text = stderr_task.await.unwrap_or_default();

    if cancelled {
        let _ = on_event.send(AgentEvent::Cancelled);
    } else if !status.success() {
        let msg = if stderr_text.trim().is_empty() {
            format!("o `claude` saiu com código {}", status.code().unwrap_or(-1))
        } else {
            stderr_text.trim().to_string()
        };
        let _ = on_event.send(AgentEvent::Error { message: msg });
    }

    let _ = on_event.send(AgentEvent::Done {
        code: status.code(),
    });
    Ok(())
}

/// Cancela um run em andamento (H1) — sinaliza o loop, que mata o processo.
#[tauri::command]
pub fn cancel_claude(run_id: String, registry: tauri::State<'_, RunRegistry>) {
    if let Ok(map) = registry.0.lock() {
        if let Some(n) = map.get(&run_id) {
            n.notify_one();
        }
    }
}

/// Mapeia um evento bruto do stream-json para 0..N eventos normalizados.
fn map_events(v: &serde_json::Value) -> Vec<AgentEvent> {
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
        // H2 — deltas de texto em streaming. Outros sub-eventos (block start/stop,
        // tool input deltas, message_*) são ignorados; o texto é montado pelos deltas.
        "stream_event" => {
            let ev = v.get("event");
            let is_delta = ev.and_then(|e| e.get("type")).and_then(|x| x.as_str())
                == Some("content_block_delta");
            if is_delta {
                let delta = ev.and_then(|e| e.get("delta"));
                let is_text = delta.and_then(|d| d.get("type")).and_then(|x| x.as_str())
                    == Some("text_delta");
                if is_text {
                    if let Some(t) = delta.and_then(|d| d.get("text")).and_then(|x| x.as_str()) {
                        return vec![AgentEvent::TextDelta {
                            text: t.to_string(),
                        }];
                    }
                }
            }
            vec![]
        }
        // Mensagem assistant completa: emite o texto (o frontend deduplica com os
        // deltas) e os tool_use como cartões.
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
        _ => vec![],
    }
}
