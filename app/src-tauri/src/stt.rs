// Ditado on-device: o cockpit fala com o sidecar Swift (mycockpit-stt) pelo
// mesmo padrão dos agents: spawn + JSON por linha + linha de vida via stdin.
// start abre o mic (espera "ready"); stop manda "STOP" e devolve o texto final;
// cancel descarta. UMA gravação por vez (sessão global).

use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

pub struct SttChild {
    child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
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

    *guard = Some(SttChild {
        child,
        stdin,
        lines,
    });
    Ok(())
}

/// Encerra a gravação e devolve o texto final.
#[tauri::command]
pub async fn stt_stop(session: tauri::State<'_, SttSession>) -> Result<String, String> {
    let mut guard = session.0.lock().await;
    let Some(mut s) = guard.take() else {
        return Err("nenhuma gravação ativa".into());
    };
    let _ = s.stdin.write_all(b"STOP\n").await;
    let _ = s.stdin.flush().await;
    let text = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        while let Ok(Some(l)) = s.lines.next_line().await {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&l) {
                if let Some(t) = v.get("text").and_then(|x| x.as_str()) {
                    return Ok(t.to_string());
                }
                if let Some(e) = v.get("error").and_then(|x| x.as_str()) {
                    return Err(e.to_string());
                }
            }
        }
        Err("a transcrição não retornou".to_string())
    })
    .await
    .map_err(|_| "tempo esgotado na transcrição".to_string())?;
    let _ = s.child.wait().await;
    text.map(|t| t.trim().to_string())
}

/// Descarta a gravação (Esc).
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
