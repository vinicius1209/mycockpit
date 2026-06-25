//! M3 — dispatch do Claude Code.
//!
//! Spawna `claude -p --output-format stream-json --verbose` na pasta do projeto,
//! parseia o JSONL (lógica portada do spike M0) e streama eventos normalizados
//! para o frontend via tauri::ipc::Channel.

use serde::Serialize;
use std::process::Stdio;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Evento normalizado enviado ao frontend (1º adapter do docs/agent-runner.md).
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    Session {
        session_id: String,
        model: Option<String>,
        tools: usize,
    },
    Text {
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
    },
    Done {
        code: Option<i32>,
    },
}

#[tauri::command]
pub async fn run_claude(
    prompt: String,
    cwd: String,
    resume: Option<String>,
    permission: String,
    on_event: Channel<AgentEvent>,
) -> Result<(), String> {
    let mut cmd = Command::new("claude");
    cmd.arg("-p")
        .arg(&prompt)
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

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
    let mut reader = BufReader::new(stdout).lines();

    while let Some(line) = reader.next_line().await.map_err(|e| e.to_string())? {
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

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let _ = on_event.send(AgentEvent::Done {
        code: status.code(),
    });
    Ok(())
}

/// Mapeia um evento bruto do stream-json para 0..N eventos normalizados.
/// Eventos de ruído (hooks, thinking_tokens, rate_limit, tool_result) são ignorados no M3.
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
                    model: v
                        .get("model")
                        .and_then(|x| x.as_str())
                        .map(str::to_string),
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
        "assistant" => {
            let mut out = Vec::new();
            if let Some(content) = v.pointer("/message/content").and_then(|x| x.as_array()) {
                for block in content {
                    match block.get("type").and_then(|x| x.as_str()) {
                        Some("text") => {
                            if let Some(t) = block.get("text").and_then(|x| x.as_str()) {
                                if !t.trim().is_empty() {
                                    out.push(AgentEvent::Text {
                                        text: t.to_string(),
                                    });
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
                            input: block.get("input").cloned().unwrap_or(serde_json::Value::Null),
                        }),
                        _ => {}
                    }
                }
            }
            out
        }
        "result" => vec![AgentEvent::Result {
            ok: !v.get("is_error").and_then(|x| x.as_bool()).unwrap_or(false),
            text: v.get("result").and_then(|x| x.as_str()).map(str::to_string),
            cost_usd: v.get("total_cost_usd").and_then(|x| x.as_f64()),
        }],
        _ => vec![],
    }
}
