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
    /// Aviso honesto que ANTECEDE o final (ex.: a passada sobre o arquivo de
    /// áudio falhou e o texto veio do reconhecimento ao vivo). Nunca substitui
    /// o texto: só explica de onde ele veio.
    Warn(String),
    Error(String),
    Eof,
}

/// Resultado do stop: o texto SEMPRE (nunca se perde fala) e, quando houve
/// degradação, o aviso do porquê — a UI mostra os dois.
#[derive(serde::Serialize)]
pub struct SttOutcome {
    pub text: String,
    pub warn: Option<String>,
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

/// Um microfone que o sistema oferece. `uid` é o identificador ESTÁVEL do
/// CoreAudio (é ele que a preferência guarda): o nome muda com o idioma do SO e
/// se repete entre dois headsets iguais, então guardar nome daria a preferência
/// apontando pro device errado.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct MicDevice {
    pub uid: String,
    pub name: String,
}

#[derive(serde::Deserialize)]
struct ListaDeDevices {
    devices: Vec<MicDevice>,
}

/// Lista os microfones de ENTRADA. Lista vazia em qualquer falha: a UI então
/// mostra só "padrão do sistema", que é o comportamento que sempre existiu —
/// nunca uma lista inventada.
#[tauri::command]
pub async fn stt_devices() -> Vec<MicDevice> {
    let Ok(bin) = sidecar_path() else {
        return Vec::new();
    };
    let out = match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        Command::new(bin).arg("--list-devices").output(),
    )
    .await
    {
        Ok(Ok(o)) if o.status.success() => o,
        _ => return Vec::new(),
    };
    serde_json::from_slice::<ListaDeDevices>(&out.stdout)
        .map(|l| l.devices)
        .unwrap_or_default()
}

/// Abre o microfone e começa a transcrever (on-device, pt-BR). `vocab` são os
/// termos do projeto injetados no reconhecedor, a vantagem sobre ditado genérico.
/// `device`: UID do microfone escolhido; None/vazio = padrão do sistema.
#[tauri::command]
pub async fn stt_start(
    app: tauri::AppHandle,
    vocab: Vec<String>,
    device: Option<String>,
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
    // Device sumido NÃO é tratado aqui: o sidecar cai no padrão do sistema e
    // emite `warn`, que já viaja até a UI. Validar antes duplicaria a regra em
    // dois lugares que podem discordar — e o sidecar é quem sabe a verdade no
    // instante em que abre o microfone.
    if let Some(uid) = device.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
        cmd.arg("--device").arg(uid);
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
                    } else if let Some(w) = v.get("warn").and_then(|x| x.as_str()) {
                        // aviso vem ANTES do final: guarda no canal e segue lendo.
                        let _ = tx.send(SttMsg::Warn(w.to_string())).await;
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

/// Encerra a gravação e devolve o texto final (+ aviso, quando o sidecar teve
/// que degradar). O sidecar, no STOP, drena o mic, encerra o áudio e roda a
/// passada sobre o ARQUIVO da sessão — por isso a resposta demora ~1s a mais
/// que antes; os 15s aqui seguem sendo só a rede de segurança.
#[tauri::command]
pub async fn stt_stop(session: tauri::State<'_, SttSession>) -> Result<SttOutcome, String> {
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
    // o prazo é do DESFECHO inteiro: um {"warn"} no meio não renova o relógio.
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(15);
    let mut warn: Option<String> = None;
    let out = loop {
        let msg = tokio::time::timeout_at(deadline, s.rx.recv())
            .await
            .map_err(|_| "tempo esgotado na transcrição".to_string())?;
        match msg {
            Some(SttMsg::Warn(w)) => warn = Some(w),
            Some(SttMsg::Final(t)) => {
                break Ok(SttOutcome {
                    text: t.trim().to_string(),
                    warn,
                })
            }
            Some(SttMsg::Error(e)) => break Err(e),
            _ => break Err("a transcrição não retornou".into()),
        }
    };
    let _ = s.child.wait().await;
    out
}

/// Descarta a gravação (Esc) — e limpa sessão de sidecar já morto. O sidecar
/// apaga o arquivo de áudio da sessão no CANCEL (e num kill, a varredura do
/// próximo boot recolhe a sobra).
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

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::process::Command;

    /// A regra "o final nunca encurta" (moreComplete) mora no sidecar Swift, e o
    /// projeto NÃO tem harness de teste Swift: o sidecar é um único arquivo
    /// compilado pelo build.rs com swiftc, sem SwiftPM/XCTest. Em vez de deixar a
    /// regra sem prova, a suíte vive DENTRO do binário (`--selftest`, que não
    /// toca mic nem permissão) e este teste a executa de verdade.
    ///
    /// Se o binário não existe, ou é ANTERIOR ao `--selftest` (swiftc da máquina
    /// falhou e sobrou o binário velho — o build.rs avisa nesse caso), o teste
    /// pula com aviso RUIDOSO em vez de rodar um binário que ia abrir o
    /// microfone. Nunca finge que rodou.
    fn sidecar_bin() -> Option<PathBuf> {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin");
        let entries = std::fs::read_dir(dir).ok()?;
        entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .find(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("mycockpit-stt-"))
            })
    }

    #[test]
    fn selftest_do_sidecar_prova_que_o_final_nunca_encurta() {
        if !cfg!(target_os = "macos") {
            return;
        }
        let Some(bin) = sidecar_bin() else {
            eprintln!("[stt] PULADO: sidecar não compilado (bin/mycockpit-stt-*)");
            return;
        };
        let bytes = std::fs::read(&bin).expect("ler o binário do sidecar");
        if !bytes.windows(10).any(|w| w == b"--selftest") {
            eprintln!(
                "[stt] PULADO: {} é anterior ao --selftest (swiftc não recompilou; \
                 veja o cargo:warning do build.rs)",
                bin.display()
            );
            return;
        }
        let out = Command::new(&bin)
            .arg("--selftest")
            .output()
            .expect("executar o sidecar com --selftest");
        let stdout = String::from_utf8_lossy(&out.stdout);
        assert!(
            out.status.success(),
            "--selftest falhou:\n{stdout}{}",
            String::from_utf8_lossy(&out.stderr)
        );
        // a última linha resume: {"selftest":"moreComplete","cases":N,"failures":0}
        let resumo: serde_json::Value = stdout
            .lines()
            .filter_map(|l| serde_json::from_str(l).ok())
            .last()
            .expect("resumo do --selftest em JSON");
        assert_eq!(resumo["failures"], 0, "casos falharam:\n{stdout}");
        assert!(
            resumo["cases"].as_u64().unwrap_or(0) >= 8,
            "a suíte da regra encolheu: {resumo}"
        );
    }
}
