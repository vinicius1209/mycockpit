//! Gateway de inferências auxiliares. Esta fronteira não executa tools, não
//! cria sessão de agente e nunca altera o estado de uma conversa.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::{oneshot, Semaphore};
use tokio::time::Instant;

const PROTOCOL_VERSION: u8 = 1;
const MAX_INPUT_BYTES: usize = 256 * 1024;
const MAX_OUTPUT_BYTES: usize = 64 * 1024;
const APPLE_SOURCE_ID: &str = "apple-foundation-model";
const LEGACY_HELPER_SOURCE_ID: &str = "legacy-helper-cli";

pub struct UtilityState {
    cancellations: Mutex<HashMap<String, oneshot::Sender<()>>>,
    apple_gate: Arc<Semaphore>,
    helper_gate: Arc<Semaphore>,
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
            apple_gate: Arc::new(Semaphore::new(1)),
            helper_gate: Arc::new(Semaphore::new(1)),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UtilityTask {
    ConversationMap,
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UtilityFailure {
    code: String,
    retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UtilitySourceDescriptor {
    id: String,
    availability: String,
    supported_tasks: Vec<UtilityTask>,
    locality: String,
    billable: bool,
    structured_output: bool,
    sessionless: bool,
    tools_disabled: bool,
    reports_cost: bool,
    supported_locales: Value,
    max_input_tokens: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    failure: Option<UtilityFailure>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbeEnvelope {
    protocol_version: u8,
    status: String,
    reason: Option<String>,
    supports_locale: bool,
    context_size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct SidecarError {
    code: String,
    #[allow(dead_code)]
    retryable: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateEnvelope {
    protocol_version: u8,
    attempt_id: String,
    task: UtilityTask,
    status: String,
    payload: Option<Value>,
    error: Option<SidecarError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarRequest<'a> {
    protocol_version: u8,
    attempt_id: &'a str,
    task: UtilityTask,
    locale: &'a str,
    prompt_version: u64,
    input_digest: &'a str,
    payload: &'a Value,
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

fn apple_source() -> UtilitySource {
    UtilitySource {
        id: APPLE_SOURCE_ID.into(),
        locality: "device".into(),
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

fn sidecar_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    if let Some(dir) = exe.parent() {
        let bundled = dir.join("frota-intelligence");
        if bundled.exists() {
            return Ok(bundled);
        }
    }
    let target = option_env!("TAURI_ENV_TARGET_TRIPLE").unwrap_or(match std::env::consts::ARCH {
        "x86_64" => "x86_64-apple-darwin",
        _ => "aarch64-apple-darwin",
    });
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("bin")
        .join(format!("frota-intelligence-{target}"));
    if dev.exists() {
        return Ok(dev);
    }
    Err("framework_unavailable".into())
}

fn helper_descriptor() -> UtilitySourceDescriptor {
    UtilitySourceDescriptor {
        id: LEGACY_HELPER_SOURCE_ID.into(),
        // A disponibilidade real depende de autenticação, cwd e modelo do
        // request. O probe global não inventa que isso está pronto.
        availability: "unknown".into(),
        supported_tasks: vec![
            UtilityTask::ComposerSuggestions,
            UtilityTask::TurnReceipt,
            UtilityTask::LessonDistillation,
            UtilityTask::SkillDraft,
            UtilityTask::ModelCurator,
            UtilityTask::CommitMessage,
        ],
        locality: "remote".into(),
        billable: true,
        structured_output: false,
        sessionless: true,
        tools_disabled: true,
        reports_cost: false,
        supported_locales: Value::String("runtime".into()),
        max_input_tokens: Value::String("runtime".into()),
        failure: None,
    }
}

fn unavailable_descriptor(code: &str, retryable: bool) -> UtilitySourceDescriptor {
    UtilitySourceDescriptor {
        id: APPLE_SOURCE_ID.into(),
        availability: "unavailable".into(),
        supported_tasks: vec![UtilityTask::ConversationMap],
        locality: "device".into(),
        billable: false,
        structured_output: true,
        sessionless: true,
        tools_disabled: true,
        reports_cost: false,
        supported_locales: Value::Array(vec![]),
        max_input_tokens: Value::String("runtime".into()),
        failure: Some(UtilityFailure {
            code: code.into(),
            retryable,
            retry_after_ms: None,
        }),
    }
}

async fn probe_apple(locale: &str) -> UtilitySourceDescriptor {
    let Ok(bin) = sidecar_path() else {
        return unavailable_descriptor("framework_unavailable", false);
    };
    let mut command = Command::new(bin);
    command
        .arg("--probe")
        .arg("--locale")
        .arg(locale)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    let Ok(child) = command.spawn() else {
        return unavailable_descriptor("probe_failed", true);
    };
    let (_keep_cancel, receive_cancel) = oneshot::channel();
    let output = match wait_bounded(
        child,
        receive_cancel,
        Instant::now() + Duration::from_secs(4),
    )
    .await
    {
        UtilityRun::Output(output) => output,
        UtilityRun::TimedOut => return unavailable_descriptor("deadline_exceeded", true),
        UtilityRun::Cancelled | UtilityRun::Failed => {
            return unavailable_descriptor("probe_failed", true)
        }
    };
    if !output.status.success() || output.stdout_truncated {
        return unavailable_descriptor("probe_failed", true);
    }
    let Ok(probe) = serde_json::from_slice::<ProbeEnvelope>(&output.stdout) else {
        return unavailable_descriptor("protocol_error", false);
    };
    if probe.protocol_version != PROTOCOL_VERSION {
        return unavailable_descriptor("protocol_error", false);
    }
    let available = probe.status == "available" && probe.supports_locale;
    UtilitySourceDescriptor {
        id: APPLE_SOURCE_ID.into(),
        availability: if available {
            "available"
        } else {
            "unavailable"
        }
        .into(),
        supported_tasks: vec![UtilityTask::ConversationMap],
        locality: "device".into(),
        billable: false,
        structured_output: true,
        sessionless: true,
        tools_disabled: true,
        reports_cost: false,
        supported_locales: if probe.supports_locale {
            Value::Array(vec![Value::String(locale.into())])
        } else {
            Value::Array(vec![])
        },
        max_input_tokens: probe
            .context_size
            .map(Value::from)
            .unwrap_or_else(|| Value::String("runtime".into())),
        failure: if available {
            None
        } else {
            Some(UtilityFailure {
                code: probe.reason.unwrap_or_else(|| "probe_failed".into()),
                retryable: false,
                retry_after_ms: None,
            })
        },
    }
}

#[tauri::command]
pub async fn utility_probe(locale: String) -> Vec<UtilitySourceDescriptor> {
    vec![probe_apple(&locale).await, helper_descriptor()]
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

async fn run_apple(
    request: &UtilityRequest,
    state: &Arc<UtilityState>,
    mut cancelled: oneshot::Receiver<()>,
    deadline_at: Instant,
) -> UtilityRun {
    let permit = tokio::select! {
        value = state.apple_gate.clone().acquire_owned() => match value {
            Ok(permit) => permit,
            Err(_) => return UtilityRun::Failed,
        },
        _ = &mut cancelled => return UtilityRun::Cancelled,
        _ = tokio::time::sleep_until(deadline_at) => return UtilityRun::TimedOut,
    };
    let Ok(bin) = sidecar_path() else {
        drop(permit);
        return UtilityRun::Failed;
    };
    let prompt_version = request
        .payload
        .get("promptVersion")
        .and_then(Value::as_u64)
        .unwrap_or(1);
    let frame = SidecarRequest {
        protocol_version: PROTOCOL_VERSION,
        attempt_id: &request.attempt_id,
        task: request.task,
        locale: &request.locale,
        prompt_version,
        input_digest: &request.input_digest,
        payload: &request.payload,
    };
    let Ok(input) = serde_json::to_vec(&frame) else {
        return UtilityRun::Failed;
    };
    if input.len() > MAX_INPUT_BYTES {
        return UtilityRun::Failed;
    }
    let mut command = Command::new(bin);
    command
        .arg("--generate")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    let Ok(mut child) = command.spawn() else {
        return UtilityRun::Failed;
    };
    let Some(mut stdin) = child.stdin.take() else {
        return UtilityRun::Failed;
    };
    if stdin.write_all(&input).await.is_err() {
        return UtilityRun::Failed;
    }
    drop(stdin);
    wait_bounded(child, cancelled, deadline_at).await
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
    let result = match command.spawn() {
        Ok(child) => wait_bounded(child, cancelled, deadline_at).await,
        Err(_) => UtilityRun::Failed,
    };
    drop(permit);
    result
}

#[derive(Clone, Copy)]
enum SelectedSource {
    Apple,
    LegacyHelper,
}

fn select_source(request: &UtilityRequest) -> Option<SelectedSource> {
    if request.route_policy == RoutePolicy::Off {
        return None;
    }
    if request.task == UtilityTask::ConversationMap {
        return Some(SelectedSource::Apple);
    }
    let helper_allowed = request.route_policy == RoutePolicy::ApprovedHelper
        && request.remote_authorized == Some(true)
        && request
            .helper_model
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        && request
            .working_directory
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty());
    helper_allowed.then_some(SelectedSource::LegacyHelper)
}

fn no_source_reason(request: &UtilityRequest) -> &'static str {
    if request.route_policy == RoutePolicy::ApprovedHelper
        && request.task != UtilityTask::ConversationMap
    {
        "auth_required"
    } else {
        "framework_unavailable"
    }
}

fn source_for(selected: SelectedSource) -> UtilitySource {
    match selected {
        SelectedSource::Apple => apple_source(),
        SelectedSource::LegacyHelper => helper_source(),
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
    if request.attempt_id.is_empty() || request.input_digest.is_empty() {
        return finish(started_at, "invalid", None, None, Some("invalid_request"));
    }
    let Ok(payload) = serde_json::to_vec(&request.payload) else {
        return finish(started_at, "invalid", None, None, Some("invalid_request"));
    };
    if payload.len() > MAX_INPUT_BYTES {
        return finish(started_at, "invalid", None, None, Some("input_too_large"));
    }
    let Some(selected) = select_source(&request) else {
        let reason = no_source_reason(&request);
        return finish(started_at, "unavailable", None, None, Some(reason));
    };
    if matches!(selected, SelectedSource::LegacyHelper)
        && request
            .payload
            .get("prompt")
            .and_then(Value::as_str)
            .is_none()
    {
        return finish(started_at, "invalid", None, None, Some("invalid_request"));
    }
    let (send_cancel, receive_cancel) = oneshot::channel();
    {
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
    let run = match selected {
        SelectedSource::Apple => run_apple(&request, &state, receive_cancel, deadline_at).await,
        SelectedSource::LegacyHelper => {
            run_helper(&request, &state, receive_cancel, deadline_at).await
        }
    };
    if let Ok(mut cancellations) = state.cancellations.lock() {
        cancellations.remove(&request.attempt_id);
    }
    match run {
        UtilityRun::TimedOut => finish(
            started_at,
            "timed_out",
            None,
            Some(source_for(selected)),
            Some("deadline_exceeded"),
        ),
        UtilityRun::Cancelled => finish(
            started_at,
            "cancelled",
            None,
            Some(source_for(selected)),
            Some("cancelled"),
        ),
        UtilityRun::Failed => finish(
            started_at,
            "unavailable",
            None,
            None,
            Some(match selected {
                SelectedSource::Apple => "framework_unavailable",
                SelectedSource::LegacyHelper => "spawn_failed",
            }),
        ),
        UtilityRun::Output(output) => {
            if output.stdout_truncated {
                return finish(
                    started_at,
                    "invalid",
                    None,
                    Some(source_for(selected)),
                    Some("invalid_response"),
                );
            }
            if !output.status.success() {
                let code = match selected {
                    SelectedSource::Apple => "process_failed",
                    SelectedSource::LegacyHelper => helper_failure_code(&output),
                };
                log::warn!(
                    "fonte de inferência encerrou com erro: source={} code={} stderr_truncated={}",
                    source_for(selected).id,
                    code,
                    output.stderr_truncated,
                );
                return finish(
                    started_at,
                    "failed",
                    None,
                    Some(source_for(selected)),
                    Some(code),
                );
            }
            if matches!(selected, SelectedSource::LegacyHelper) {
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
                return result;
            }
            if output
                .stdout
                .split(|byte| *byte == b'\n')
                .filter(|line| !line.iter().all(u8::is_ascii_whitespace))
                .count()
                != 1
            {
                return finish(
                    started_at,
                    "invalid",
                    None,
                    Some(apple_source()),
                    Some("protocol_error"),
                );
            }
            let Ok(envelope) = serde_json::from_slice::<GenerateEnvelope>(&output.stdout) else {
                return finish(
                    started_at,
                    "invalid",
                    None,
                    Some(apple_source()),
                    Some("protocol_error"),
                );
            };
            if envelope.protocol_version != PROTOCOL_VERSION
                || envelope.attempt_id != request.attempt_id
                || envelope.task != request.task
            {
                return finish(
                    started_at,
                    "invalid",
                    None,
                    Some(apple_source()),
                    Some("protocol_error"),
                );
            }
            if envelope.status == "ok" {
                return finish(
                    started_at,
                    "ok",
                    envelope.payload,
                    Some(apple_source()),
                    None,
                );
            }
            let code = envelope
                .error
                .map(|error| error.code)
                .unwrap_or_else(|| "process_failed".into());
            log::warn!(
                "fonte de inferência recusou a geração: source={} code={}",
                APPLE_SOURCE_ID,
                code,
            );
            finish(
                started_at,
                "unavailable",
                None,
                Some(apple_source()),
                Some(&code),
            )
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
    fn serializa_descriptor_no_contrato_camel_case() {
        let json = serde_json::to_value(unavailable_descriptor("unsupported_os", false)).unwrap();
        assert_eq!(json["supportedTasks"][0], "conversation_map");
        assert_eq!(json["toolsDisabled"], true);
        assert_eq!(json["failure"]["code"], "unsupported_os");
    }

    #[test]
    fn rota_desligada_nao_tem_fonte_ficticia() {
        let result = finish(10, "unavailable", None, None, Some("framework_unavailable"));
        let json = serde_json::to_value(result).unwrap();
        assert!(json["source"].is_null());
        assert_eq!(json["fallbackReason"], "framework_unavailable");
    }

    #[test]
    fn mapa_local_nunca_herda_autorizacao_do_helper_legado() {
        let mut req = request(UtilityTask::ConversationMap, RoutePolicy::ApprovedHelper);
        req.remote_authorized = Some(true);
        assert!(matches!(select_source(&req), Some(SelectedSource::Apple)));
    }

    #[test]
    fn helper_remoto_exige_autorizacao_da_finalidade() {
        let mut req = request(
            UtilityTask::ComposerSuggestions,
            RoutePolicy::ApprovedHelper,
        );
        assert!(select_source(&req).is_none());
        assert_eq!(no_source_reason(&req), "auth_required");
        req.remote_authorized = Some(true);
        assert!(matches!(
            select_source(&req),
            Some(SelectedSource::LegacyHelper)
        ));
    }

    #[test]
    fn rota_gratuita_nao_usa_helper_faturavel() {
        let mut req = request(UtilityTask::TurnReceipt, RoutePolicy::FreeOnly);
        req.remote_authorized = Some(true);
        assert!(select_source(&req).is_none());
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
