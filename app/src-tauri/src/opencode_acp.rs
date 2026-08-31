//! Transporte ACP do OpenCode. Diferente de `opencode run`, este canal é
//! bidirecional: pedidos de permissão param o agente e viram os mesmos cards de
//! interação já usados pelo Codex app-server.

use crate::acp::{self, MensagemAcp};
use crate::adapters::RunRequest;
use crate::agent::{AgentEvent, CostSource, RunRegistry};
use crate::approval::{DirectInteractions, PendingApprovals};
use serde_json::{json, Value};
use std::process::Stdio;
use std::sync::Arc;
use tauri::ipc::Channel;
use tokio::io::AsyncWriteExt;
use tokio::process::{ChildStdin, Command};
use tokio::sync::{Mutex, Notify};

const INIT: i64 = 1;
const SESSION: i64 = 2;
const MODEL: i64 = 3;
const EFFORT: i64 = 4;
const MODE: i64 = 5;
const PROMPT: i64 = 6;

pub struct Outcome {
    pub cancelled: bool,
    pub failed: bool,
    pub startup_error: Option<String>,
}

impl Outcome {
    fn startup(message: impl Into<String>) -> Self {
        Self {
            cancelled: false,
            failed: false,
            startup_error: Some(message.into()),
        }
    }
    fn done(cancelled: bool, failed: bool) -> Self {
        Self {
            cancelled,
            failed,
            startup_error: None,
        }
    }
}

fn request(id: i64, method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
}

async fn write(stdin: &Arc<Mutex<ChildStdin>>, message: &Value) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(message).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    let mut guard = stdin.lock().await;
    guard.write_all(&bytes).await.map_err(|e| e.to_string())?;
    guard.flush().await.map_err(|e| e.to_string())
}

fn session_params(req: &RunRequest) -> (&'static str, Value) {
    match req.resume.as_deref() {
        Some(session_id) => (
            "session/load",
            json!({
                "sessionId": session_id, "cwd": req.cwd, "mcpServers": []
            }),
        ),
        None => ("session/new", json!({ "cwd": req.cwd, "mcpServers": [] })),
    }
}

fn prompt_params(session_id: &str, prompt: &str) -> Value {
    json!({ "sessionId": session_id, "prompt": [{ "type": "text", "text": prompt }] })
}

/// Continua depois de modelo/esforço e diz se o prompt já foi enviado.
async fn continue_after_effort(
    stdin: &Arc<Mutex<ChildStdin>>,
    req: &RunRequest,
    session_id: &str,
) -> Result<bool, String> {
    if req.plan_first {
        write(
            stdin,
            &request(
                MODE,
                "session/set_config_option",
                json!({
                    "sessionId": session_id, "configId": "mode", "value": "plan"
                }),
            ),
        )
        .await?;
        Ok(false)
    } else {
        write(
            stdin,
            &request(
                PROMPT,
                "session/prompt",
                prompt_params(session_id, &req.prompt),
            ),
        )
        .await?;
        Ok(true)
    }
}

async fn continue_after_model(
    stdin: &Arc<Mutex<ChildStdin>>,
    req: &RunRequest,
    session_id: &str,
) -> Result<bool, String> {
    if let Some(effort) = req.effort.as_deref() {
        write(
            stdin,
            &request(
                EFFORT,
                "session/set_config_option",
                json!({ "sessionId": session_id, "configId": "effort", "value": effort }),
            ),
        )
        .await?;
        Ok(false)
    } else {
        continue_after_effort(stdin, req, session_id).await
    }
}

pub async fn run(
    app: &tauri::AppHandle,
    run_id: &str,
    req: &RunRequest,
    on_event: &Channel<AgentEvent>,
    notify: &Arc<Notify>,
    registry: &RunRegistry,
    pending: Arc<PendingApprovals>,
) -> Outcome {
    let mut cmd = Command::new("opencode");
    cmd.args(["acp", "--cwd", &req.cwd])
        .current_dir(&req.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    crate::hook_sessions::correlate_run(&mut cmd, run_id);
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => return Outcome::startup(format!("não consegui subir `opencode acp`: {e}")),
    };
    let child_pid = child.id();
    if let Some(pid) = child_pid {
        if let Ok(mut pids) = registry.1.lock() {
            pids.insert(run_id.to_string(), pid);
        }
    }
    let stdin = match child.stdin.take() {
        Some(stdin) => Arc::new(Mutex::new(stdin)),
        None => return Outcome::startup("o ACP abriu sem stdin"),
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => return Outcome::startup("o ACP abriu sem stdout"),
    };
    let stderr = child.stderr.take();
    let stderr_task = tokio::spawn(async move {
        match stderr {
            Some(stderr) => crate::run_resources::collect_stderr_tail(stderr).await,
            None => crate::run_resources::CapturedTail::default(),
        }
    });
    let mut memory_watch = crate::run_resources::ProcessMemoryWatch::new(child_pid);
    let interactions = Arc::new(DirectInteractions::new(app.clone(), pending));
    let mut reader = crate::run_resources::LimitedLineReader::new(stdout);
    let mut session_id: Option<String> = None;
    let mut prompt_started = false;
    let mut approval_seq = 0u64;
    let mut cancelled = false;
    let mut failed = false;

    if let Err(e) = write(&stdin, &request(INIT, "initialize", json!({
        "protocolVersion": 1,
        "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false }, "terminal": false },
        "clientInfo": { "name": "mycockpit", "version": env!("CARGO_PKG_VERSION") }
    }))).await {
        return Outcome::startup(format!("falha no handshake ACP: {e}"));
    }

    loop {
        tokio::select! {
            status = child.wait() => {
                let detail = status
                    .ok()
                    .and_then(|value| value.code())
                    .map(|code| format!(" (código {code})"))
                    .unwrap_or_default();
                if !prompt_started {
                    interactions.shutdown();
                    crate::run_processes::terminate_run(run_id, child_pid);
                    let stderr = stderr_task.await.unwrap_or_default();
                    let message = if stderr.text.trim().is_empty() {
                        format!("o ACP encerrou antes do turno{detail}")
                    } else {
                        let suffix = if stderr.truncated { "\n[stderr limitado aos 64 KiB finais]" } else { "" };
                        format!("{}{suffix}", stderr.text.trim())
                    };
                    return Outcome::startup(message);
                }
                failed = true;
                let _ = on_event.send(AgentEvent::Error {
                    message: format!("o ACP encerrou antes do desfecho do turno{detail}"),
                });
                break;
            }
            _ = notify.notified() => {
                cancelled = true;
                if let Some(sid) = &session_id {
                    let _ = write(&stdin, &json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":sid}})).await;
                }
                crate::run_processes::terminate_run(run_id, child_pid);
                break;
            }
            line = reader.next_line() => {
                let line = match line {
                    Ok(Some(line)) => line,
                    Ok(None) => {
                        if !prompt_started {
                            let stderr = stderr_task.await.unwrap_or_default();
                            let message = if stderr.text.trim().is_empty() {
                                "o ACP encerrou antes do turno".to_string()
                            } else {
                                let suffix = if stderr.truncated { "\n[stderr limitado aos 64 KiB finais]" } else { "" };
                                format!("{}{suffix}", stderr.text.trim())
                            };
                            return Outcome::startup(message);
                        }
                        failed = true;
                        let _ = on_event.send(AgentEvent::Error {
                            message: "o ACP encerrou antes do desfecho do turno".into(),
                        });
                        break;
                    }
                    Err(error) => {
                        failed = true;
                        let _ = on_event.send(AgentEvent::Error {
                            message: format!("{error}; interrompi o run antes de processar um payload sem teto."),
                        });
                        crate::run_processes::terminate_run(run_id, child_pid);
                        break;
                    }
                };
                let Ok(value) = serde_json::from_str::<Value>(line.trim()) else { continue };
                match acp::classificar(&value) {
                    MensagemAcp::Pedido { id, metodo, params } => {
                        if metodo == "session/request_permission" {
                            if let Some(permission) = acp::ler_pedido_de_permissao(&id, &params) {
                                approval_seq += 1;
                                let ui_id = format!("{run_id}-oc{approval_seq}");
                                let data = json!({
                                    "tool_name": permission.titulo,
                                    "command": params.pointer("/toolCall/rawInput/command"),
                                    "input": params.pointer("/toolCall/rawInput").cloned().unwrap_or(Value::Null)
                                });
                                let interactions = interactions.clone();
                                let stdin = stdin.clone();
                                let run_id = run_id.to_string();
                                tokio::spawn(async move {
                                    let answer = interactions.request(&run_id, &ui_id, "approval", data).await;
                                    let outcome = acp::escolher_opcao(&answer, &permission.opcoes);
                                    let response = json!({ "jsonrpc":"2.0", "id":permission.id, "result": {"outcome":outcome} });
                                    if let Err(e) = write(&stdin, &response).await { log::warn!("ACP: falha ao responder permissão: {e}"); }
                                });
                            } else {
                                let _ = write(&stdin, &json!({"jsonrpc":"2.0","id":id,"error":{"code":-32602,"message":"pedido de permissão incompleto"}})).await;
                            }
                        } else {
                            let _ = write(&stdin, &json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"pedido ainda não suportado pela Frota"}})).await;
                            let _ = on_event.send(AgentEvent::Notice { message: format!("OpenCode pediu `{metodo}`, ainda sem tela correspondente; o pedido foi recusado.") });
                        }
                    }
                    MensagemAcp::Notificacao { metodo, params } => {
                        if metodo == "session/update" {
                            for event in acp::mapear_update(&params) { let _ = on_event.send(event); }
                        }
                    }
                    MensagemAcp::Resposta { id, result, erro } => {
                        let id = id.as_i64().unwrap_or(-1);
                        if let Some(error) = erro {
                            let message = error.get("message").and_then(Value::as_str).unwrap_or("erro ACP").to_string();
                            if !prompt_started { return Outcome::startup(message); }
                            failed = true;
                            let event = match crate::adapters::opencode_limit(&message) {
                                Some(hit) => AgentEvent::LimitReached { message, reset_hint: hit.reset_hint },
                                None => AgentEvent::Error { message },
                            };
                            let _ = on_event.send(event);
                            break;
                        }
                        let result = result.unwrap_or(Value::Null);
                        match id {
                            INIT => {
                                let (method, params) = session_params(req);
                                if let Err(e) = write(&stdin, &request(SESSION, method, params)).await { return Outcome::startup(e); }
                            }
                            SESSION => {
                                let Some(sid) = result.get("sessionId").and_then(Value::as_str)
                                    .or(req.resume.as_deref()).map(str::to_string)
                                else { return Outcome::startup("ACP não devolveu sessionId"); };
                                session_id = Some(sid.clone());
                                let _ = on_event.send(AgentEvent::Session { session_id: sid.clone(), model: req.model.clone(), tools: 0 });
                                if let Some(model) = req.model.as_deref() {
                                    if let Err(e) = write(&stdin, &request(MODEL, "session/set_config_option", json!({"sessionId":sid,"configId":"model","value":model}))).await { return Outcome::startup(e); }
                                } else {
                                    match continue_after_model(&stdin, req, &sid).await {
                                        Ok(started) => prompt_started = started,
                                        Err(e) => return Outcome::startup(e),
                                    }
                                }
                            }
                            MODEL => {
                                let sid = session_id.as_deref().unwrap_or_default();
                                match continue_after_model(&stdin, req, sid).await {
                                    Ok(started) => prompt_started = started,
                                    Err(e) => return Outcome::startup(e),
                                }
                            }
                            EFFORT => {
                                let sid = session_id.as_deref().unwrap_or_default();
                                match continue_after_effort(&stdin, req, sid).await {
                                    Ok(started) => prompt_started = started,
                                    Err(e) => return Outcome::startup(e),
                                }
                            }
                            MODE => {
                                let sid = session_id.as_deref().unwrap_or_default();
                                prompt_started = true;
                                if let Err(e) = write(&stdin, &request(PROMPT, "session/prompt", prompt_params(sid, &req.prompt))).await { return Outcome::startup(e); }
                            }
                            PROMPT => {
                                let (input, output, cache) = acp::ler_usage(&result);
                                if input > 0 { let _ = on_event.send(AgentEvent::ContextUsage { tokens: input, window_tokens: None }); }
                                let _ = on_event.send(AgentEvent::Result {
                                    ok: true, text: None, cost_usd: None, cost_source: CostSource::Unknown,
                                    input_tokens: input, output_tokens: output, cache_read: cache,
                                    cache_creation: 0, cumulative_usage: None,
                                });
                                break;
                            }
                            _ => {}
                        }
                    }
                    MensagemAcp::Ruido => {}
                }
            }
            memory = memory_watch.next() => {
                match memory {
                    crate::run_resources::MemoryEvent::Warning { rss_mb } => {
                        let _ = on_event.send(AgentEvent::Notice {
                            message: format!(
                                "Este run chegou a {rss_mb} MB de memória e continua rodando sem teto artificial. Use Parar se esse consumo não for intencional."
                            ),
                        });
                    }
                }
            }
        }
    }
    interactions.shutdown();
    crate::run_processes::terminate_run(run_id, child_pid);
    let _ = child.wait().await;
    let _ = stderr_task.await;
    Outcome::done(cancelled, failed)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prompt_acp_preserva_texto_sem_shell() {
        let params = prompt_params("ses_1", "use $HOME e `pwd`");
        assert_eq!(params["prompt"][0]["text"], "use $HOME e `pwd`");
    }
}
