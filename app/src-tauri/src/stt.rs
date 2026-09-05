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
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

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

/// Evidência do início real da captura. A UI não repete a preferência salva:
/// mostra o dispositivo que o sidecar efetivamente abriu naquele instante.
#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SttStartOutcome {
    pub attempt_id: String,
    pub device_uid: String,
    pub device_name: String,
    pub warn: Option<String>,
}

pub struct SttChild {
    id: u64,
    child: Child,
    stdin: ChildStdin,
    rx: mpsc::Receiver<SttMsg>,
}

enum SttPhase {
    /// Publicada antes de esperar permissões/primeiro buffer. Assim o comando
    /// de cancelamento consegue alcançar e matar um start que ainda aguarda.
    Starting {
        id: u64,
        child: Child,
        stdin: ChildStdin,
    },
    Active(SttChild),
    /// O sidecar já recebeu STOP/CANCEL, mas ainda está saindo. Manter a vaga
    /// ocupada impede uma segunda captura de nascer durante esse trecho.
    Stopping {
        id: u64,
    },
}

pub struct SttSession {
    phase: Mutex<Option<SttPhase>>,
    next_id: AtomicU64,
    accepting: AtomicBool,
}

impl Default for SttSession {
    fn default() -> Self {
        Self {
            phase: Mutex::new(None),
            next_id: AtomicU64::new(0),
            accepting: AtomicBool::new(true),
        }
    }
}

impl SttSession {
    pub(crate) fn ensure_accepting(&self) -> Result<(), String> {
        self.accepting
            .load(Ordering::Acquire)
            .then_some(())
            .ok_or_else(|| "o Frota está encerrando e não pode iniciar outro ditado".into())
    }

    pub(crate) fn begin_shutdown(&self) {
        self.accepting.store(false, Ordering::Release);
    }

    pub(crate) async fn active_count(&self) -> usize {
        usize::from(self.phase.lock().await.is_some())
    }

    pub(crate) async fn shutdown_all(&self) {
        self.begin_shutdown();
        let target = {
            let mut guard = self.phase.lock().await;
            match guard.take() {
                Some(SttPhase::Starting { id, child, stdin }) => {
                    *guard = Some(SttPhase::Stopping { id });
                    Some((id, child, stdin))
                }
                Some(SttPhase::Active(active)) => {
                    let id = active.id;
                    *guard = Some(SttPhase::Stopping { id });
                    Some((id, active.child, active.stdin))
                }
                other => {
                    *guard = other;
                    None
                }
            }
        };
        if let Some((id, mut child, mut stdin)) = target {
            let _ = stdin.write_all(b"CANCEL\n").await;
            let _ = stdin.flush().await;
            if tokio::time::timeout(std::time::Duration::from_millis(300), child.wait())
                .await
                .is_err()
            {
                let _ = child.kill().await;
            }
            clear_stopping(self, id).await;
        }
    }
}

fn ready_outcome(
    value: &serde_json::Value,
    warn: Option<String>,
    attempt_id: &str,
) -> Option<SttStartOutcome> {
    if !value.get("ready")?.as_bool()? {
        return None;
    }
    Some(SttStartOutcome {
        attempt_id: attempt_id.to_string(),
        device_uid: value.get("deviceUid")?.as_str()?.to_string(),
        device_name: value.get("deviceName")?.as_str()?.to_string(),
        warn,
    })
}

fn input_level(value: &serde_json::Value) -> Option<f64> {
    value
        .get("level")?
        .as_f64()
        .filter(|level| level.is_finite())
        .map(|level| level.clamp(0.0, 1.0))
}

fn consume_startup_value(
    value: &serde_json::Value,
    warn: &mut Option<String>,
    attempt_id: &str,
) -> Result<Option<SttStartOutcome>, String> {
    if value.get("ready").and_then(|ready| ready.as_bool()) == Some(true) {
        return ready_outcome(value, warn.take(), attempt_id)
            .map(Some)
            .ok_or_else(|| "o sidecar abriu o microfone sem identificar o dispositivo".into());
    }
    if let Some(message) = value.get("warn").and_then(|item| item.as_str()) {
        *warn = Some(message.to_string());
    }
    if let Some(error) = value.get("error").and_then(|item| item.as_str()) {
        return Err(error.to_string());
    }
    Ok(None)
}

/// Remove somente a tentativa que chamou esta função. Sem o `id`, o fim
/// atrasado de um start cancelado poderia matar uma segunda tentativa nova.
async fn discard_starting(session: &SttSession, id: u64) {
    let phase = {
        let mut guard = session.phase.lock().await;
        let phase = guard.take();
        match phase {
            Some(SttPhase::Starting {
                id: current,
                child,
                stdin,
            }) if current == id => Some((child, stdin)),
            other => {
                *guard = other;
                None
            }
        }
    };
    if let Some((mut child, mut stdin)) = phase {
        let _ = stdin.write_all(b"CANCEL\n").await;
        let _ = stdin.flush().await;
        let _ = child.kill().await;
    }
}

async fn clear_stopping(session: &SttSession, id: u64) {
    let mut guard = session.phase.lock().await;
    let phase = guard.take();
    match phase {
        Some(SttPhase::Stopping { id: current }) if current == id => {}
        other => *guard = other,
    }
}

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
    attempt_id: String,
    session: tauri::State<'_, SttSession>,
) -> Result<SttStartOutcome, String> {
    session.ensure_accepting()?;
    let attempt_id = attempt_id.trim().to_string();
    if attempt_id.is_empty() || attempt_id.len() > 128 {
        return Err("identificador da tentativa de ditado inválido".into());
    }
    let id = session.next_id.fetch_add(1, Ordering::Relaxed);
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
    #[cfg(unix)]
    cmd.process_group(0);
    let stdout = {
        let mut guard = session.phase.lock().await;
        session.ensure_accepting()?;
        if guard.is_some() {
            return Err("já existe uma gravação em andamento".into());
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("não consegui iniciar o ditado: {e}"))?;
        let stdin = child.stdin.take().ok_or("sidecar sem stdin")?;
        let stdout = child.stdout.take().ok_or("sidecar sem stdout")?;
        *guard = Some(SttPhase::Starting { id, child, stdin });
        stdout
    };
    let mut lines = BufReader::new(stdout).lines();

    // espera "ready" (a 1ª vez pode abrir os diálogos de permissão → folga).
    let mut startup_warn: Option<String> = None;
    let waited = tokio::time::timeout(std::time::Duration::from_secs(90), async {
        while let Ok(Some(l)) = lines.next_line().await {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&l) {
                if let Some(level) = input_level(&v) {
                    let _ = app.emit(
                        "stt://level",
                        serde_json::json!({ "attemptId": attempt_id, "level": level }),
                    );
                }
                // Aviso de fallback pode vir antes de vários níveis e do ready;
                // só é consumido quando o device efetivo também chegou.
                if let Some(outcome) = consume_startup_value(&v, &mut startup_warn, &attempt_id)? {
                    return Ok(outcome);
                }
            }
        }
        Err("o sidecar de ditado encerrou sem responder".to_string())
    })
    .await;
    let outcome = match waited {
        Ok(Ok(outcome)) => outcome,
        Ok(Err(error)) => {
            discard_starting(&session, id).await;
            return Err(error);
        }
        Err(_) => {
            discard_starting(&session, id).await;
            return Err("tempo esgotado esperando o microfone".to_string());
        }
    };

    // task leitor: drena o stdout até o desfecho (ver comentário do módulo).
    let (tx, rx) = mpsc::channel::<SttMsg>(8);
    let (reader_gate_tx, reader_gate_rx) = oneshot::channel::<()>();
    let reader_app = app.clone();
    let reader_attempt_id = attempt_id.clone();
    tokio::spawn(async move {
        // Não publique eventos de uma tentativa que foi cancelada no intervalo
        // mínimo entre o ready do sidecar e a promoção para Active.
        if reader_gate_rx.await.is_err() {
            return;
        }
        let mut ended_warn: Option<String> = None;
        let ended: serde_json::Value = loop {
            match lines.next_line().await {
                Ok(Some(l)) => {
                    let Ok(v) = serde_json::from_str::<serde_json::Value>(&l) else {
                        continue;
                    };
                    if let Some(p) = v.get("partial").and_then(|x| x.as_str()) {
                        let _ = reader_app.emit(
                            "stt://partial",
                            serde_json::json!({
                                "attemptId": reader_attempt_id,
                                "text": p,
                            }),
                        );
                    } else if let Some(level) = input_level(&v) {
                        let _ = reader_app.emit(
                            "stt://level",
                            serde_json::json!({
                                "attemptId": reader_attempt_id,
                                "level": level,
                            }),
                        );
                    } else if let Some(lost) = v.get("captureLost").and_then(|x| x.as_str()) {
                        ended_warn = Some(lost.to_string());
                        let _ = reader_app.emit(
                            "stt://capture-lost",
                            serde_json::json!({
                                "attemptId": reader_attempt_id,
                                "message": lost,
                            }),
                        );
                    } else if let Some(w) = v.get("warn").and_then(|x| x.as_str()) {
                        // aviso vem ANTES do final: guarda no canal e segue lendo.
                        ended_warn = Some(w.to_string());
                        let _ = tx.send(SttMsg::Warn(w.to_string())).await;
                    } else if let Some(t) = v.get("text").and_then(|x| x.as_str()) {
                        let _ = tx.send(SttMsg::Final(t.to_string())).await;
                        break serde_json::json!({
                            "attemptId": reader_attempt_id,
                            "text": t,
                            "warn": ended_warn,
                        });
                    } else if let Some(e) = v.get("error").and_then(|x| x.as_str()) {
                        let _ = tx.send(SttMsg::Error(e.to_string())).await;
                        break serde_json::json!({
                            "attemptId": reader_attempt_id,
                            "error": e,
                            "warn": ended_warn,
                        });
                    }
                }
                _ => {
                    let _ = tx.send(SttMsg::Eof).await;
                    break serde_json::json!({ "attemptId": reader_attempt_id });
                }
            }
        };
        // num stop normal a UI está em "busy" e ignora; recebendo isto em "rec"
        // é morte inesperada do sidecar → o MicButton solta o estado.
        let _ = reader_app.emit("stt://ended", ended);
    });

    let mut guard = session.phase.lock().await;
    let phase = guard.take();
    match phase {
        Some(SttPhase::Starting {
            id: current,
            child,
            stdin,
        }) if current == id => {
            *guard = Some(SttPhase::Active(SttChild {
                id,
                child,
                stdin,
                rx,
            }));
            let _ = reader_gate_tx.send(());
            Ok(outcome)
        }
        other => {
            *guard = other;
            Err("inicialização do ditado cancelada".into())
        }
    }
}

/// Encerra a gravação e devolve o texto final (+ aviso, quando o sidecar teve
/// que degradar). O sidecar, no STOP, drena o mic, encerra o áudio e roda a
/// passada sobre o ARQUIVO da sessão — por isso a resposta demora ~1s a mais
/// que antes; os 15s aqui seguem sendo só a rede de segurança.
#[tauri::command]
pub async fn stt_stop(session: tauri::State<'_, SttSession>) -> Result<SttOutcome, String> {
    let mut s = {
        let mut guard = session.phase.lock().await;
        match guard.take() {
            Some(SttPhase::Active(s)) => {
                let id = s.id;
                *guard = Some(SttPhase::Stopping { id });
                s
            }
            Some(starting @ SttPhase::Starting { .. }) => {
                *guard = Some(starting);
                return Err("o microfone ainda está abrindo".into());
            }
            Some(stopping @ SttPhase::Stopping { .. }) => {
                *guard = Some(stopping);
                return Err("o ditado já está finalizando".into());
            }
            None => return Err("nenhuma gravação ativa".into()),
        }
        // lock solto AQUI, mas Stopping reserva a sessão até o filho terminar.
    };
    let id = s.id;
    let _ = s.stdin.write_all(b"STOP\n").await;
    let _ = s.stdin.flush().await;
    // o prazo é do DESFECHO inteiro: um {"warn"} no meio não renova o relógio.
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(15);
    let mut warn: Option<String> = None;
    let out = loop {
        let msg = match tokio::time::timeout_at(deadline, s.rx.recv()).await {
            Ok(msg) => msg,
            Err(_) => break Err("tempo esgotado na transcrição".to_string()),
        };
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
    if tokio::time::timeout(std::time::Duration::from_secs(2), s.child.wait())
        .await
        .is_err()
    {
        let _ = s.child.kill().await;
    }
    clear_stopping(&session, id).await;
    out
}

/// Descarta a gravação (Esc) — e limpa sessão de sidecar já morto. O sidecar
/// apaga o arquivo de áudio da sessão no CANCEL (e num kill, a varredura do
/// próximo boot recolhe a sobra).
#[tauri::command]
pub async fn stt_cancel(session: tauri::State<'_, SttSession>) -> Result<(), String> {
    let target = {
        let mut guard = session.phase.lock().await;
        match guard.take() {
            Some(SttPhase::Starting { id, child, stdin }) => {
                *guard = Some(SttPhase::Stopping { id });
                Some((id, child, stdin))
            }
            Some(SttPhase::Active(s)) => {
                let id = s.id;
                *guard = Some(SttPhase::Stopping { id });
                Some((id, s.child, s.stdin))
            }
            Some(stopping @ SttPhase::Stopping { .. }) => {
                *guard = Some(stopping);
                return Err("o ditado já está finalizando".into());
            }
            None => None,
        }
    };
    if let Some((id, mut child, mut stdin)) = target {
        let _ = stdin.write_all(b"CANCEL\n").await;
        let _ = stdin.flush().await;
        let _ = child.kill().await;
        clear_stopping(&session, id).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{consume_startup_value, input_level, ready_outcome};
    use std::path::PathBuf;
    use std::process::Command;

    #[test]
    fn ready_traz_o_microfone_real_e_o_aviso_de_fallback() {
        let value = serde_json::json!({
            "ready": true,
            "deviceUid": "uid-interno",
            "deviceName": "Microfone do MacBook"
        });
        let outcome = ready_outcome(
            &value,
            Some("microfone salvo sumiu; usando o padrão".into()),
            "tentativa-a",
        )
        .expect("ready válido");
        assert_eq!(outcome.attempt_id, "tentativa-a");
        assert_eq!(outcome.device_uid, "uid-interno");
        assert_eq!(outcome.device_name, "Microfone do MacBook");
        assert_eq!(
            outcome.warn.as_deref(),
            Some("microfone salvo sumiu; usando o padrão")
        );
    }

    #[test]
    fn ready_sem_identidade_do_device_nao_finge_que_abriu() {
        let value = serde_json::json!({ "ready": true });
        assert!(ready_outcome(&value, None, "tentativa-a").is_none());
    }

    #[test]
    fn niveis_entre_o_fallback_e_o_ready_nao_apagam_o_aviso() {
        let mut warn = None;
        assert!(consume_startup_value(
            &serde_json::json!({ "warn": "usando o padrão" }),
            &mut warn,
            "tentativa-a",
        )
        .expect("warn válido")
        .is_none());
        assert!(consume_startup_value(
            &serde_json::json!({ "level": 0.2 }),
            &mut warn,
            "tentativa-a",
        )
        .expect("nível válido")
        .is_none());
        let outcome = consume_startup_value(
            &serde_json::json!({
                "ready": true,
                "deviceUid": "uid-padrao",
                "deviceName": "Microfone padrão"
            }),
            &mut warn,
            "tentativa-a",
        )
        .expect("ready válido")
        .expect("desfecho do início");
        assert_eq!(outcome.warn.as_deref(), Some("usando o padrão"));
    }

    #[test]
    fn nivel_de_entrada_e_limitado_ao_contrato_da_interface() {
        assert_eq!(
            input_level(&serde_json::json!({ "level": -0.2 })),
            Some(0.0)
        );
        assert_eq!(
            input_level(&serde_json::json!({ "level": 0.42 })),
            Some(0.42)
        );
        assert_eq!(input_level(&serde_json::json!({ "level": 4.0 })), Some(1.0));
        assert_eq!(input_level(&serde_json::json!({ "partial": "oi" })), None);
    }

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
        entries.filter_map(|e| e.ok()).map(|e| e.path()).find(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("mycockpit-stt-"))
        })
    }

    #[test]
    fn selftest_do_sidecar_prova_texto_completo_e_avisos_honestos() {
        if !cfg!(target_os = "macos") {
            return;
        }
        let Some(bin) = sidecar_bin() else {
            eprintln!("[stt] PULADO: sidecar não compilado (bin/mycockpit-stt-*)");
            return;
        };
        let bytes = std::fs::read(&bin).expect("ler o binário do sidecar");
        // Em `-O`, o Swift pode dobrar a comparação de argumentos e remover
        // a string literal `--selftest` do Mach-O. O nome do contrato emitido
        // pelo próprio harness permanece e distingue o binário que tem a suíte.
        if !bytes
            .windows(b"moreComplete".len())
            .any(|window| window == b"moreComplete")
        {
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
        // a última linha resume as regras de completude, nível e fallback.
        let resumo: serde_json::Value = stdout
            .lines()
            .filter_map(|l| serde_json::from_str(l).ok())
            .last()
            .expect("resumo do --selftest em JSON");
        assert_eq!(resumo["failures"], 0, "casos falharam:\n{stdout}");
        assert!(
            resumo["cases"].as_u64().unwrap_or(0) >= 18,
            "a suíte da regra encolheu: {resumo}"
        );
    }
}
