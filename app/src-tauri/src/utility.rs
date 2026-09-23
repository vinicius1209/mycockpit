//! Gateway de inferências auxiliares. Esta fronteira não executa tools, não
//! cria sessão de agente e nunca altera o estado de uma conversa.
//!
//! Uma fonte só: o helper (CLI do motor, com consentimento por finalidade).
//! O modelo local da Apple (`frota-intelligence`) servia apenas o resumo da
//! aba Conversa e saiu junto com ele (ADR-233): em 20 dias, 1.165 chamadas e
//! nenhum resumo salvo.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Child;
use tokio::sync::{oneshot, Semaphore};
use tokio::time::Instant;

const MAX_INPUT_BYTES: usize = 256 * 1024;
const MAX_OUTPUT_BYTES: usize = 64 * 1024;
const LEGACY_HELPER_SOURCE_ID: &str = "legacy-helper-cli";

pub struct UtilityState {
    cancellations: Mutex<HashMap<String, oneshot::Sender<()>>>,
    helper_gate: Arc<Semaphore>,
    accepting: AtomicBool,
}

impl Default for UtilityState {
    fn default() -> Self {
        Self::new()
    }
}

impl UtilityState {
    pub fn new() -> Self {
        Self {
            cancellations: Mutex::new(HashMap::new()),
            helper_gate: Arc::new(Semaphore::new(1)),
            accepting: AtomicBool::new(true),
        }
    }

    pub(crate) fn ensure_accepting(&self) -> Result<(), String> {
        self.accepting
            .load(Ordering::Acquire)
            .then_some(())
            .ok_or_else(|| "o Frota está encerrando e não pode iniciar outra análise".into())
    }

    pub(crate) fn begin_shutdown(&self) {
        self.accepting.store(false, Ordering::Release);
    }

    pub(crate) fn active_count(&self) -> usize {
        self.cancellations
            .lock()
            .map(|items| items.len())
            .unwrap_or(0)
    }

    pub(crate) fn cancel_all(&self) {
        let senders = self
            .cancellations
            .lock()
            .map(|mut items| items.drain().map(|(_, sender)| sender).collect::<Vec<_>>())
            .unwrap_or_default();
        for sender in senders {
            let _ = sender.send(());
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UtilityTask {
    ComposerSuggestions,
    TurnReceipt,
    LessonDistillation,
    SkillDraft,
    ModelCurator,
    CommitMessage,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RoutePolicy {
    DeviceOnly,
    FreeOnly,
    ApprovedHelper,
    Off,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UtilityRequest {
    attempt_id: String,
    task: UtilityTask,
    #[allow(dead_code)]
    locale: String,
    payload: Value,
    input_digest: String,
    route_policy: RoutePolicy,
    deadline_ms: u64,
    #[allow(dead_code)]
    project_id: Option<String>,
    #[allow(dead_code)]
    conversation_id: Option<String>,
    working_directory: Option<String>,
    helper_model: Option<String>,
    remote_authorized: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UtilitySource {
    id: String,
    locality: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UtilityTiming {
    started_at: u64,
    duration_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UtilityCost {
    usd: Option<f64>,
    source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UtilityResult {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<Value>,
    source: Option<UtilitySource>,
    timing: UtilityTiming,
    #[serde(skip_serializing_if = "Option::is_none")]
    cost: Option<UtilityCost>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fallback_reason: Option<String>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn finish(
    started_at: u64,
    status: &str,
    value: Option<Value>,
    source: Option<UtilitySource>,
    reason: Option<&str>,
) -> UtilityResult {
    UtilityResult {
        status: status.into(),
        value,
        source,
        timing: UtilityTiming {
            started_at,
            duration_ms: now_ms().saturating_sub(started_at),
        },
        cost: None,
        fallback_reason: reason.map(str::to_string),
    }
}

fn helper_source() -> UtilitySource {
    UtilitySource {
        id: LEGACY_HELPER_SOURCE_ID.into(),
        // O transporte é um processo local, mas o conteúdo deixa o aparelho.
        // Privacidade e consentimento seguem a localidade efetiva dos dados.
        locality: "remote".into(),
    }
}

struct BoundedOutput {
    status: std::process::ExitStatus,
    stdout: Vec<u8>,
    stderr: String,
    stdout_truncated: bool,
    stderr_truncated: bool,
}

enum UtilityRun {
    Output(BoundedOutput),
    TimedOut,
    Cancelled,
    Failed,
}

async fn collect_stdout_capped<R>(mut reader: R) -> (Vec<u8>, bool)
where
    R: AsyncRead + Unpin,
{
    let mut retained = Vec::with_capacity(MAX_OUTPUT_BYTES);
    let mut chunk = [0_u8; 8192];
    let mut truncated = false;
    loop {
        let read = match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };
        let remaining = MAX_OUTPUT_BYTES.saturating_sub(retained.len());
        retained.extend_from_slice(&chunk[..read.min(remaining)]);
        truncated |= read > remaining;
    }
    (retained, truncated)
}

async fn terminate_child(child: &mut Child) {
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        crate::plugin_runtime::signal_process_group(pid, "-TERM");
        if tokio::time::timeout(Duration::from_millis(350), child.wait())
            .await
            .is_err()
        {
            crate::plugin_runtime::signal_process_group(pid, "-KILL");
            let _ = child.wait().await;
        }
        return;
    }
    let _ = child.kill().await;
}

async fn wait_bounded(
    mut child: Child,
    mut cancelled: oneshot::Receiver<()>,
    deadline_at: Instant,
) -> UtilityRun {
    let Some(stdout) = child.stdout.take() else {
        return UtilityRun::Failed;
    };
    let Some(stderr) = child.stderr.take() else {
        return UtilityRun::Failed;
    };
    let stdout_task = tokio::spawn(collect_stdout_capped(stdout));
    let stderr_task = tokio::spawn(crate::run_resources::collect_stderr_tail(stderr));
    let status = tokio::select! {
        value = child.wait() => match value {
            Ok(status) => status,
            Err(_) => return UtilityRun::Failed,
        },
        _ = &mut cancelled => {
            terminate_child(&mut child).await;
            return UtilityRun::Cancelled;
        },
        _ = tokio::time::sleep_until(deadline_at) => {
            terminate_child(&mut child).await;
            return UtilityRun::TimedOut;
        },
    };
    let Ok((stdout, stdout_truncated)) = stdout_task.await else {
        return UtilityRun::Failed;
    };
    let Ok(stderr) = stderr_task.await else {
        return UtilityRun::Failed;
    };
    UtilityRun::Output(BoundedOutput {
        status,
        stdout,
        stderr: stderr.text,
        stdout_truncated,
        stderr_truncated: stderr.truncated,
    })
}

async fn run_helper(
    request: &UtilityRequest,
    state: &Arc<UtilityState>,
    mut cancelled: oneshot::Receiver<()>,
    deadline_at: Instant,
) -> UtilityRun {
    let permit = tokio::select! {
        value = state.helper_gate.clone().acquire_owned() => match value {
            Ok(permit) => permit,
            Err(_) => return UtilityRun::Failed,
        },
        _ = &mut cancelled => return UtilityRun::Cancelled,
        _ = tokio::time::sleep_until(deadline_at) => return UtilityRun::TimedOut,
    };
    let Some(model) = request
        .helper_model
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    else {
        return UtilityRun::Failed;
    };
    let Some(cwd) = request
        .working_directory
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    else {
        return UtilityRun::Failed;
    };
    let Some(prompt) = request.payload.get("prompt").and_then(Value::as_str) else {
        return UtilityRun::Failed;
    };
    let mut command = crate::agent::utility_helper_command(model, cwd, prompt);
    command.kill_on_drop(true);
    command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    if state.ensure_accepting().is_err() {
        return UtilityRun::Cancelled;
    }
    let result = match command.spawn() {
        Ok(child) => wait_bounded(child, cancelled, deadline_at).await,
        Err(_) => UtilityRun::Failed,
    };
    drop(permit);
    result
}

/// O helper só roda com a finalidade autorizada, um modelo escolhido e uma
/// pasta de trabalho. Sem isso não há fonte, e o motivo diz o que falta.
fn helper_permitido(request: &UtilityRequest) -> bool {
    request.route_policy == RoutePolicy::ApprovedHelper
        && request.remote_authorized == Some(true)
        && request
            .helper_model
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        && request
            .working_directory
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
}

fn no_source_reason(request: &UtilityRequest) -> &'static str {
    if request.route_policy == RoutePolicy::ApprovedHelper {
        "auth_required"
    } else {
        "framework_unavailable"
    }
}

fn helper_failure_code(output: &BoundedOutput) -> &'static str {
    let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
    let detail = format!("{stdout}\n{}", output.stderr.to_lowercase());
    if detail.contains("not logged in") || detail.contains("authentication") {
        "auth_required"
    } else if detail.contains("rate limit") || detail.contains("rate_limit") {
        "rate_limited"
    } else {
        "process_failed"
    }
}

async fn generate_utility(request: UtilityRequest, state: Arc<UtilityState>) -> UtilityResult {
    let started_at = now_ms();
    if state.ensure_accepting().is_err() {
        return finish(started_at, "cancelled", None, None, Some("cancelled"));
    }
    if request.attempt_id.is_empty() || request.input_digest.is_empty() {
        return finish(started_at, "invalid", None, None, Some("invalid_request"));
    }
    let Ok(payload) = serde_json::to_vec(&request.payload) else {
        return finish(started_at, "invalid", None, None, Some("invalid_request"));
    };
    if payload.len() > MAX_INPUT_BYTES {
        return finish(started_at, "invalid", None, None, Some("input_too_large"));
    }
    if request.route_policy == RoutePolicy::Off || !helper_permitido(&request) {
        let reason = no_source_reason(&request);
        return finish(started_at, "unavailable", None, None, Some(reason));
    }
    if request.payload.get("prompt").and_then(Value::as_str).is_none() {
        return finish(started_at, "invalid", None, None, Some("invalid_request"));
    }
    let (send_cancel, receive_cancel) = oneshot::channel();
    {
        if state.ensure_accepting().is_err() {
            return finish(started_at, "cancelled", None, None, Some("cancelled"));
        }
        let Ok(mut cancellations) = state.cancellations.lock() else {
            return finish(started_at, "failed", None, None, Some("process_failed"));
        };
        if cancellations.contains_key(&request.attempt_id) {
            return finish(started_at, "invalid", None, None, Some("invalid_request"));
        }
        cancellations.insert(request.attempt_id.clone(), send_cancel);
    }
    let deadline_at =
        Instant::now() + Duration::from_millis(request.deadline_ms.clamp(500, 45_000));
    let run = run_helper(&request, &state, receive_cancel, deadline_at).await;
    if let Ok(mut cancellations) = state.cancellations.lock() {
        cancellations.remove(&request.attempt_id);
    }
    match run {
        UtilityRun::TimedOut => {
            // Estouro de prazo também é falha, e era a única sem registro: o
            // helper passou semanas com 0 sucessos sem uma linha no log.
            log::warn!(
                "fonte de inferência estourou o prazo: source={} task={:?} deadline_ms={}",
                LEGACY_HELPER_SOURCE_ID,
                request.task,
                request.deadline_ms,
            );
            finish(
            started_at,
            "timed_out",
            None,
            Some(helper_source()),
            Some("deadline_exceeded"),
            )
        }
        UtilityRun::Cancelled => finish(
            started_at,
            "cancelled",
            None,
            Some(helper_source()),
            Some("cancelled"),
        ),
        UtilityRun::Failed => finish(
            started_at,
            "unavailable",
            None,
            None,
            Some("spawn_failed"),
        ),
        UtilityRun::Output(output) => {
            if output.stdout_truncated {
                return finish(
                    started_at,
                    "invalid",
                    None,
                    Some(helper_source()),
                    Some("invalid_response"),
                );
            }
            if !output.status.success() {
                let code = helper_failure_code(&output);
                log::warn!(
                    "fonte de inferência encerrou com erro: source={} code={} stderr_truncated={}",
                    LEGACY_HELPER_SOURCE_ID,
                    code,
                    output.stderr_truncated,
                );
                return finish(
                    started_at,
                    "failed",
                    None,
                    Some(helper_source()),
                    Some(code),
                );
            }
            let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if text.is_empty() {
                return finish(
                    started_at,
                    "invalid",
                    None,
                    Some(helper_source()),
                    Some("invalid_response"),
                );
            }
            let mut result = finish(
                started_at,
                "ok",
                Some(Value::String(text)),
                Some(helper_source()),
                None,
            );
            result.cost = Some(UtilityCost {
                usd: None,
                source: "unknown".into(),
            });
            result
        }
    }
}

#[tauri::command]
pub async fn utility_generate(
    request: UtilityRequest,
    state: State<'_, Arc<UtilityState>>,
) -> Result<UtilityResult, String> {
    let owned = Arc::clone(state.inner());
    Ok(generate_utility(request, owned).await)
}

#[tauri::command]
pub fn utility_cancel(attempt_id: String, state: State<'_, Arc<UtilityState>>) -> bool {
    let Ok(mut cancellations) = state.cancellations.lock() else {
        return false;
    };
    cancellations
        .remove(&attempt_id)
        .is_some_and(|sender| sender.send(()).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    fn request(task: UtilityTask, route_policy: RoutePolicy) -> UtilityRequest {
        UtilityRequest {
            attempt_id: "attempt-1".into(),
            task,
            locale: "pt-BR".into(),
            payload: serde_json::json!({ "prompt": "resuma" }),
            input_digest: "digest".into(),
            route_policy,
            deadline_ms: 3_000,
            project_id: None,
            conversation_id: None,
            working_directory: Some("/tmp".into()),
            helper_model: Some("haiku".into()),
            remote_authorized: Some(false),
        }
    }

    #[test]
    fn rota_desligada_nao_tem_fonte_ficticia() {
        let result = finish(10, "unavailable", None, None, Some("framework_unavailable"));
        let json = serde_json::to_value(result).unwrap();
        assert!(json["source"].is_null());
        assert_eq!(json["fallbackReason"], "framework_unavailable");
    }

    #[test]
    fn helper_remoto_exige_autorizacao_da_finalidade() {
        let mut req = request(
            UtilityTask::ComposerSuggestions,
            RoutePolicy::ApprovedHelper,
        );
        assert!(!helper_permitido(&req));
        assert_eq!(no_source_reason(&req), "auth_required");
        req.remote_authorized = Some(true);
        assert!(helper_permitido(&req));
    }

    #[test]
    fn rota_gratuita_nao_usa_helper_faturavel() {
        let mut req = request(UtilityTask::TurnReceipt, RoutePolicy::FreeOnly);
        req.remote_authorized = Some(true);
        assert!(!helper_permitido(&req));
        assert_eq!(no_source_reason(&req), "framework_unavailable");
    }

    #[tokio::test]
    async fn stdout_tagarela_e_drenado_mas_retido_ate_64_kib() {
        let (mut writer, reader) = tokio::io::duplex(8 * 1024);
        let total = MAX_OUTPUT_BYTES + 137;
        let producer = tokio::spawn(async move {
            writer.write_all(&vec![b'x'; total]).await.unwrap();
        });

        let (captured, truncated) = collect_stdout_capped(reader).await;
        producer.await.unwrap();
        assert_eq!(captured.len(), MAX_OUTPUT_BYTES);
        assert!(truncated);
    }
}
