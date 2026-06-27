//! M3 / v0.2-α — dispatch de agents de código.
//!
//! O LOOP de execução (spawn, leitura do JSONL linha-a-linha, cancel, stderr,
//! Done) é compartilhado em `run_agent`; cada CLI (Claude/Codex/OpenCode) vira
//! um `adapters::AgentAdapter` que só varia em montar o comando e mapear linhas.

use crate::adapters::{self, RunRequest};
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
    /// Linha de tipo desconhecido — surfaçada em vez de descartada (regra de ouro
    /// do agent-runner.md). A UI ignora; serve p/ não perder eventos quando o CLI
    /// muda. No-op no front (default do reduceEvent).
    Unknown {
        raw: serde_json::Value,
    },
}

/// Roda um agent de código na pasta `cwd` e streama eventos normalizados via Channel.
/// `agent` seleciona o adapter (claude-code / codex / opencode).
#[tauri::command]
pub async fn run_agent(
    run_id: String,
    agent: String,
    prompt: String,
    cwd: String,
    resume: Option<String>,
    permission: String,
    on_event: Channel<AgentEvent>,
    registry: tauri::State<'_, RunRegistry>,
) -> Result<(), String> {
    let mut adapter = adapters::resolve(&agent)?;
    let req = RunRequest {
        prompt,
        cwd,
        resume,
        permission,
    };
    let mut cmd = adapter.build_command(&req)?;
    // stdin null é OBRIGATÓRIO: sem isso o `codex exec` trava lendo stdin
    // (verificado). Inofensivo p/ o Claude (que não lê stdin em -p).
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let bin = adapter.id();
    let mut child = cmd.spawn().map_err(|e| {
        format!("não consegui executar o agent `{bin}`: {e}. Ele está instalado e no PATH?")
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
                            for ev in adapter.map_line(&v) {
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
                // SIGKILL no processo; a sessão segue resumível via resume.
                let _ = child.start_kill();
                break;
            }
        }
    }

    // Flush de itens pendentes (begin sem end) só no fim normal, não no cancel.
    if !cancelled {
        for ev in adapter.on_close() {
            let _ = on_event.send(ev);
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
            format!(
                "o agent `{bin}` saiu com código {}",
                status.code().unwrap_or(-1)
            )
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
pub fn cancel_agent(run_id: String, registry: tauri::State<'_, RunRegistry>) {
    if let Ok(map) = registry.0.lock() {
        if let Some(n) = map.get(&run_id) {
            n.notify_one();
        }
    }
}

/// Helper one-shot (Sprint 3): roda um modelo barato (ex. `haiku`) SEM tools,
/// sem persistir sessão, p/ meta-tarefas (sugestões/títulos). Retorna o texto puro.
/// NÃO usa `--bare`: esse modo "minimal" pula o carregamento das credenciais e a
/// chamada cai em "Not logged in". Os runs principais (sem --bare) são autenticados.
#[tauri::command]
pub async fn suggest(model: String, cwd: String, prompt: String) -> Result<String, String> {
    let out = Command::new("claude")
        .arg("-p")
        .arg(&prompt)
        .arg("--model")
        .arg(&model)
        .arg("--tools")
        .arg("")
        .arg("--output-format")
        .arg("text")
        .arg("--no-session-persistence")
        .current_dir(&cwd)
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
