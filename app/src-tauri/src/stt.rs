// Ditado on-device: o cockpit fala com o sidecar Swift (mycockpit-stt) pelo
// mesmo padrão dos agents: spawn + JSON por linha + linha de vida via stdin.
// start abre o mic (espera "ready"); stop manda "STOP" e devolve o texto final;
// cancel descarta. UMA gravação por vez (sessão global).
//
// O stdout é DRENADO durante a gravação (task leitor): sem isso, cada parcial
// (texto completo até ali) acumulava no pipe de 64KB e o print do sidecar
// BLOQUEAVA o callback de áudio do Speech framework — ditados longos congelavam
// no meio. O leitor ainda: repassa parciais pra UI ("stt://partial") e detecta
// morte inesperada do sidecar ("stt://ended" fora de um stop).

use std::process::Stdio;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, Mutex};

/// Desfecho do sidecar, entregue pelo task leitor ao stop.
pub enum SttMsg {
    Final(String),
    Error(String),
    Eof,
}

pub struct SttChild {
    child: Child,
    stdin: ChildStdin,
    rx: mpsc::Receiver<SttMsg>,
}

#[derive(Default)]
pub struct SttSession(pub Mutex<Option<SttChild>>);

/// Resolve o binário do sidecar: ao lado do executável (bundle/dev via
/// externalBin) ou no bin/ do src-tauri (fallback de dev).
fn sidecar_path() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("executável sem diretório")?;
    let bundled = dir.join("mycockpit-stt");
    if bundled.exists() {
        return Ok(bundled);
    }
    let dev = dir.join("../../bin/mycockpit-stt-aarch64-apple-darwin");
    if dev.exists() {
        return Ok(dev);
    }
    Err("sidecar de ditado não encontrado (o build compila com swiftc)".into())
}

/// Abre o microfone e começa a transcrever (on-device, pt-BR). `vocab` são os
/// termos do projeto injetados no reconhecedor, a vantagem sobre ditado genérico.
#[tauri::command]
pub async fn stt_start(
    app: tauri::AppHandle,
    vocab: Vec<String>,
    session: tauri::State<'_, SttSession>,
) -> Result<(), String> {
    let mut guard = session.0.lock().await;
    if guard.is_some() {
        return Err("já existe uma gravação em andamento".into());
    }
    let bin = sidecar_path()?;
    let mut cmd = Command::new(bin);
    if !vocab.is_empty() {
        cmd.arg("--vocab").arg(vocab.join(","));
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("não consegui iniciar o ditado: {e}"))?;
    let stdin = child.stdin.take().ok_or("sidecar sem stdin")?;
    let stdout = child.stdout.take().ok_or("sidecar sem stdout")?;
    let mut lines = BufReader::new(stdout).lines();

    // espera "ready" (a 1ª vez pode abrir os diálogos de permissão → folga).
    let waited = tokio::time::timeout(std::time::Duration::from_secs(90), async {
        while let Ok(Some(l)) = lines.next_line().await {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&l) {
                if v.get("ready").is_some() {
                    return Ok(());
                }
                if let Some(e) = v.get("error").and_then(|x| x.as_str()) {
                    return Err(e.to_string());
                }
            }
        }
        Err("o sidecar de ditado encerrou sem responder".to_string())
    })
    .await
    .map_err(|_| "tempo esgotado esperando o microfone".to_string())?;
    waited?;

    // task leitor: drena o stdout até o desfecho (ver comentário do módulo).
    let (tx, rx) = mpsc::channel::<SttMsg>(8);
    let reader_app = app.clone();
    tokio::spawn(async move {
        let ended: serde_json::Value = loop {
            match lines.next_line().await {
                Ok(Some(l)) => {
                    let Ok(v) = serde_json::from_str::<serde_json::Value>(&l) else {
                        continue;
                    };
                    if let Some(p) = v.get("partial").and_then(|x| x.as_str()) {
                        let _ = reader_app.emit("stt://partial", p.to_string());
                    } else if let Some(t) = v.get("text").and_then(|x| x.as_str()) {
                        let _ = tx.send(SttMsg::Final(t.to_string())).await;
                        break serde_json::json!({ "text": t });
                    } else if let Some(e) = v.get("error").and_then(|x| x.as_str()) {
                        let _ = tx.send(SttMsg::Error(e.to_string())).await;
                        break serde_json::json!({ "error": e });
                    }
                }
                _ => {
                    let _ = tx.send(SttMsg::Eof).await;
                    break serde_json::json!({});
                }
            }
        };
        // num stop normal a UI está em "busy" e ignora; recebendo isto em "rec"
        // é morte inesperada do sidecar → o MicButton solta o estado.
        let _ = reader_app.emit("stt://ended", ended);
    });

    *guard = Some(SttChild { child, stdin, rx });
    Ok(())
}

/// Encerra a gravação e devolve o texto final.
#[tauri::command]
pub async fn stt_stop(session: tauri::State<'_, SttSession>) -> Result<String, String> {
    let mut s = {
        let mut guard = session.0.lock().await;
        let Some(s) = guard.take() else {
            return Err("nenhuma gravação ativa".into());
        };
        s
        // lock solto AQUI: a espera da transcrição não bloqueia cancel/start.
    };
    let _ = s.stdin.write_all(b"STOP\n").await;
    let _ = s.stdin.flush().await;
    let msg = tokio::time::timeout(std::time::Duration::from_secs(15), s.rx.recv())
        .await
        .map_err(|_| "tempo esgotado na transcrição".to_string())?;
    let _ = s.child.wait().await;
    match msg {
        Some(SttMsg::Final(t)) => Ok(t.trim().to_string()),
        Some(SttMsg::Error(e)) => Err(e),
        _ => Err("a transcrição não retornou".into()),
    }
}

/// Descarta a gravação (Esc) — e limpa sessão de sidecar já morto.
#[tauri::command]
pub async fn stt_cancel(session: tauri::State<'_, SttSession>) -> Result<(), String> {
    let mut guard = session.0.lock().await;
    if let Some(mut s) = guard.take() {
        let _ = s.stdin.write_all(b"CANCEL\n").await;
        let _ = s.stdin.flush().await;
        let _ = s.child.kill().await;
    }
    Ok(())
}
