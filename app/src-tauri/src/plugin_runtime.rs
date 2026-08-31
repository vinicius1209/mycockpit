//! Runtime efêmero e supervisionado de plugins.
//!
//! O app nunca executa código durante discovery, grant ou abertura de tela. Um
//! worker nasce apenas para uma chamada concreta do Tool Catalog, sem shell,
//! com ambiente em allowlist, protocolo limitado, process group próprio e
//! timeout. Ao terminar a chamada, o processo termina também.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;
use tokio::io::{AsyncBufRead, AsyncReadExt, BufReader};
use tokio::process::{Child, ChildStderr, Command};
use tokio::time::timeout;

use crate::plugin_manifest::{PluginCapability, PluginPackage, ToolContribution};
use crate::plugin_protocol::{
    read_message, write_value, WorkerMessage, MAX_RESULT_BYTES, PROTOCOL_VERSION,
};
use crate::resource_broker::{PluginResourceLease, ResourceLeaseRegistry};

const READY_TIMEOUT: Duration = Duration::from_secs(4);
const CALL_TIMEOUT: Duration = Duration::from_secs(120);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_PROTOCOL_MESSAGES: usize = 128;
const MAX_STDERR_BYTES: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PluginRuntimeState {
    Idle,
    Starting,
    Running,
    Stopping,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginRuntimeView {
    pub(crate) state: PluginRuntimeState,
    pub(crate) pid: Option<u32>,
    pub(crate) active_tool: Option<String>,
    pub(crate) started_at: Option<i64>,
    pub(crate) last_error: Option<String>,
}

impl Default for PluginRuntimeView {
    fn default() -> Self {
        Self {
            state: PluginRuntimeState::Idle,
            pid: None,
            active_tool: None,
            started_at: None,
            last_error: None,
        }
    }
}

#[derive(Default)]
pub struct PluginRuntimeRegistry {
    entries: Mutex<HashMap<String, PluginRuntimeView>>,
}

impl PluginRuntimeRegistry {
    pub(crate) fn view(&self, plugin_key: &str) -> PluginRuntimeView {
        match self.entries.lock() {
            Ok(entries) => entries.get(plugin_key).cloned().unwrap_or_default(),
            Err(_) => PluginRuntimeView {
                state: PluginRuntimeState::Failed,
                last_error: Some("registry de plugins indisponível".into()),
                ..PluginRuntimeView::default()
            },
        }
    }

    fn reserve(&self, plugin_key: &str, tool_id: &str) -> Result<PluginRuntimeView, String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "registry de plugins indisponível".to_string())?;
        if entries.get(plugin_key).is_some_and(|view| {
            matches!(
                view.state,
                PluginRuntimeState::Starting
                    | PluginRuntimeState::Running
                    | PluginRuntimeState::Stopping
            )
        }) {
            return Err("este plugin já está atendendo outra chamada".into());
        }
        let view = PluginRuntimeView {
            state: PluginRuntimeState::Starting,
            pid: None,
            active_tool: Some(tool_id.into()),
            started_at: Some(now_ms()),
            last_error: None,
        };
        entries.insert(plugin_key.into(), view.clone());
        Ok(view)
    }

    fn running(&self, plugin_key: &str, pid: u32) -> PluginRuntimeView {
        let mut view = self.view(plugin_key);
        view.state = PluginRuntimeState::Running;
        view.pid = Some(pid);
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(plugin_key.into(), view.clone());
        }
        view
    }

    fn finish(&self, plugin_key: &str, error: Option<String>) -> PluginRuntimeView {
        let view = PluginRuntimeView {
            state: if error.is_some() {
                PluginRuntimeState::Failed
            } else {
                PluginRuntimeState::Idle
            },
            last_error: error,
            ..PluginRuntimeView::default()
        };
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(plugin_key.into(), view.clone());
        }
        view
    }

    pub(crate) fn stop(&self, plugin_key: &str) -> PluginRuntimeView {
        let mut view = self.view(plugin_key);
        if let Some(pid) = view.pid {
            view.state = PluginRuntimeState::Stopping;
            if let Ok(mut entries) = self.entries.lock() {
                entries.insert(plugin_key.into(), view.clone());
            }
            signal_process_group(pid, "-TERM");
        }
        view
    }

    pub fn kill_all(&self) {
        let pids = self
            .entries
            .lock()
            .map(|entries| {
                entries
                    .values()
                    .filter_map(|view| view.pid)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for pid in pids {
            signal_process_group(pid, "-KILL");
        }
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn call_id() -> String {
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    format!(
        "plugin-call-{}-{}",
        std::process::id(),
        SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

fn emit_runtime(app: &tauri::AppHandle, plugin_key: &str, runtime: PluginRuntimeView) {
    if let Err(error) = app.emit(
        "plugin://runtime",
        json!({ "pluginKey": plugin_key, "runtime": runtime }),
    ) {
        log::warn!("não consegui publicar o runtime do plugin {plugin_key}: {error}");
    }
}

pub(crate) fn signal_process_group(pid: u32, signal: &str) {
    if pid <= 1 {
        return;
    }
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .args([signal, &format!("-{pid}")])
            .output();
    }
    #[cfg(not(unix))]
    let _ = signal;
}

pub(crate) fn executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return path
            .metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false);
    }
    #[cfg(not(unix))]
    true
}

pub(crate) fn configure_base_environment(
    command: &mut Command,
    package: &PluginPackage,
    project_path: &str,
) {
    const ALLOWLIST: &[&str] = &[
        "PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR", "TEMP", "TMP",
    ];
    command.env_clear();
    for key in ALLOWLIST {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    command
        .env("FROTA_PLUGIN_PROTOCOL", PROTOCOL_VERSION.to_string())
        .env("FROTA_PLUGIN_KEY", package.key())
        .env(
            "FROTA_PLUGIN_CAPABILITIES",
            serde_json::to_string(&package.manifest.capability_names())
                .unwrap_or_else(|_| "[]".into()),
        );
    if package.manifest.capabilities.iter().any(|capability| {
        matches!(
            capability,
            PluginCapability::WorkspaceRead | PluginCapability::WorkspaceWrite
        )
    }) {
        command.env("FROTA_PROJECT_ROOT", project_path);
    }
}

fn configure_environment(
    command: &mut Command,
    package: &PluginPackage,
    project_path: &str,
    lease: &PluginResourceLease,
) {
    configure_base_environment(command, package, project_path);
    for (key, value) in &lease.env {
        command.env(key, value);
    }
}

fn append_log(logs: &mut VecDeque<String>, level: &str, message: &str) {
    let line = format!("{level}: {}", message.chars().take(800).collect::<String>());
    logs.push_back(line);
    while logs.len() > 40 {
        logs.pop_front();
    }
}

async fn ready<R>(
    reader: &mut R,
    expected_tools: &[String],
    logs: &mut VecDeque<String>,
) -> Result<(), String>
where
    R: AsyncBufRead + Unpin,
{
    for _ in 0..MAX_PROTOCOL_MESSAGES {
        match read_message(reader).await? {
            WorkerMessage::Ready {
                protocol_version,
                mut tools,
            } => {
                if protocol_version != PROTOCOL_VERSION {
                    return Err(format!(
                        "worker usa protocolo {protocol_version}; a Frota exige {PROTOCOL_VERSION}"
                    ));
                }
                tools.sort();
                tools.dedup();
                if tools != expected_tools {
                    return Err("worker registrou tools diferentes do manifesto revisado".into());
                }
                return Ok(());
            }
            WorkerMessage::Log { level, message } => append_log(logs, &level, &message),
            WorkerMessage::Fatal { error } => {
                return Err(format!("worker recusou a inicialização: {error}"));
            }
            _ => return Err("worker respondeu fora da sequência de inicialização".into()),
        }
    }
    Err("worker excedeu o limite de mensagens antes de ficar pronto".into())
}

async fn result<R>(
    reader: &mut R,
    request_id: &str,
    logs: &mut VecDeque<String>,
) -> Result<Value, String>
where
    R: AsyncBufRead + Unpin,
{
    for _ in 0..MAX_PROTOCOL_MESSAGES {
        match read_message(reader).await? {
            WorkerMessage::Result {
                request_id: returned,
                output,
            } if returned == request_id => {
                let size = serde_json::to_vec(&output)
                    .map_err(|error| format!("resultado inválido do worker: {error}"))?
                    .len();
                if size > MAX_RESULT_BYTES {
                    return Err(format!(
                        "resultado do worker excedeu o limite de {} KiB",
                        MAX_RESULT_BYTES / 1024
                    ));
                }
                return Ok(output);
            }
            WorkerMessage::Error {
                request_id: returned,
                error,
            } if returned == request_id => return Err(error.chars().take(2000).collect()),
            WorkerMessage::Log { level, message } => append_log(logs, &level, &message),
            WorkerMessage::Fatal { error } => {
                return Err(format!("worker encerrou a chamada: {error}"));
            }
            WorkerMessage::Result { .. } | WorkerMessage::Error { .. } => {
                return Err("worker respondeu com requestId diferente".into());
            }
            WorkerMessage::Ready { .. } => {
                return Err("worker enviou ready duas vezes".into());
            }
        }
    }
    Err("worker excedeu o limite de mensagens durante a chamada".into())
}

async fn drain_stderr(mut stderr: ChildStderr, retained: Arc<Mutex<VecDeque<u8>>>) {
    let mut chunk = [0_u8; 4096];
    loop {
        let Ok(read) = stderr.read(&mut chunk).await else {
            return;
        };
        if read == 0 {
            return;
        }
        if let Ok(mut output) = retained.lock() {
            output.extend(&chunk[..read]);
            while output.len() > MAX_STDERR_BYTES {
                output.pop_front();
            }
        }
    }
}

async fn settle_child(child: &mut Child, graceful: bool) {
    if graceful {
        if matches!(timeout(SHUTDOWN_TIMEOUT, child.wait()).await, Ok(Ok(_))) {
            return;
        }
    }
    if let Some(pid) = child.id() {
        signal_process_group(pid, "-KILL");
    }
    let _ = child.wait().await;
}

fn audit_outcome(result: &Result<Value, String>) -> (&'static str, Option<&'static str>) {
    match result {
        Ok(_) => ("completed", None),
        Err(error) if error.contains("timeout") => ("timeout", Some("worker excedeu o timeout")),
        Err(_) => ("failed", Some("worker ou protocolo devolveu falha")),
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn invoke(
    app: tauri::AppHandle,
    registry: Arc<PluginRuntimeRegistry>,
    leases: Arc<ResourceLeaseRegistry>,
    project_id: String,
    project_path: String,
    plugin_key: String,
    reviewed_fingerprint: String,
    tool_id: String,
    input: Value,
) -> Result<Value, String> {
    if !input.is_object() {
        return Err("input da tool precisa ser um objeto".into());
    }
    let package = crate::plugin_manifest::find_plugin(&app, &plugin_key)?;
    if package.fingerprint != reviewed_fingerprint {
        return Err("o plugin mudou depois que o catálogo deste run foi criado".into());
    }
    let conn = crate::mcp_control::db(&app)?;
    if !crate::plugin_grants::is_enabled(&conn, &package)? {
        return Err("o plugin não possui grant atual e habilitado".into());
    }
    drop(conn);
    let tool: ToolContribution = package
        .manifest
        .contributes
        .tools
        .iter()
        .find(|tool| tool.id == tool_id)
        .cloned()
        .ok_or_else(|| "tool não existe no manifesto atual".to_string())?;
    let current_call = call_id();
    let lease = crate::resource_broker::acquire_plugin_resources(
        &app,
        leases,
        &project_id,
        &plugin_key,
        &current_call,
        &tool.resources,
    )
    .await?;
    let main = package.main_path()?;
    if !executable(&main) {
        return Err("main do plugin precisa ser um arquivo executável".into());
    }

    emit_runtime(&app, &plugin_key, registry.reserve(&plugin_key, &tool_id)?);
    let mut command = Command::new(&main);
    command
        .current_dir(&package.root)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(false);
    configure_environment(&mut command, &package, &project_path, &lease);
    #[cfg(unix)]
    command.process_group(0);

    let spawned = command.spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(error) => {
            let message = format!("não consegui iniciar o worker: {error}");
            emit_runtime(
                &app,
                &plugin_key,
                registry.finish(&plugin_key, Some(message.clone())),
            );
            return Err(message);
        }
    };
    let Some(pid) = child.id() else {
        settle_child(&mut child, false).await;
        let message = "worker iniciou sem PID".to_string();
        emit_runtime(
            &app,
            &plugin_key,
            registry.finish(&plugin_key, Some(message.clone())),
        );
        return Err(message);
    };
    emit_runtime(&app, &plugin_key, registry.running(&plugin_key, pid));
    let pipes = (child.stdin.take(), child.stdout.take(), child.stderr.take());
    let (Some(mut stdin), Some(stdout), Some(stderr)) = pipes else {
        settle_child(&mut child, false).await;
        let message = "worker iniciou sem os canais do protocolo".to_string();
        emit_runtime(
            &app,
            &plugin_key,
            registry.finish(&plugin_key, Some(message.clone())),
        );
        return Err(message);
    };
    let retained_stderr = Arc::new(Mutex::new(VecDeque::new()));
    let stderr_task = tokio::spawn(drain_stderr(stderr, retained_stderr.clone()));
    let mut reader = BufReader::new(stdout);
    let mut logs = VecDeque::new();
    let expected_tools = {
        let mut tools: Vec<String> = package
            .manifest
            .contributes
            .tools
            .iter()
            .map(|tool| tool.id.clone())
            .collect();
        tools.sort();
        tools.dedup();
        tools
    };
    let context = if package.manifest.capabilities.iter().any(|capability| {
        matches!(
            capability,
            PluginCapability::WorkspaceRead | PluginCapability::WorkspaceWrite
        )
    }) {
        json!({ "projectRoot": project_path })
    } else {
        json!({})
    };

    let execution = async {
        write_value(
            &mut stdin,
            &json!({
                "type": "initialize",
                "protocolVersion": PROTOCOL_VERSION,
                "pluginKey": plugin_key,
                "fingerprint": reviewed_fingerprint,
                "grantedCapabilities": package.manifest.capability_names(),
                "tools": expected_tools,
                "resourceClaims": &lease.claims,
            }),
        )
        .await?;
        timeout(
            READY_TIMEOUT,
            ready(&mut reader, &expected_tools, &mut logs),
        )
        .await
        .map_err(|_| "timeout esperando o worker ficar pronto".to_string())??;
        write_value(
            &mut stdin,
            &json!({
                "type": "invoke",
                "requestId": current_call,
                "tool": tool_id,
                "input": input,
                "context": context,
            }),
        )
        .await?;
        timeout(CALL_TIMEOUT, result(&mut reader, &current_call, &mut logs))
            .await
            .map_err(|_| "timeout na execução da tool".to_string())?
    }
    .await;

    let graceful = execution.is_ok()
        && write_value(&mut stdin, &json!({ "type": "shutdown" }))
            .await
            .is_ok();
    drop(stdin);
    settle_child(&mut child, graceful).await;
    let _ = stderr_task.await;
    let stderr_bytes = retained_stderr
        .lock()
        .map(|output| output.len())
        .unwrap_or_default();
    if stderr_bytes > 0 {
        log::debug!(
            "plugin {} escreveu {} bytes no stderr durante {}",
            plugin_key,
            stderr_bytes,
            tool_id
        );
    }
    let runtime_error = execution.as_ref().err().cloned();
    emit_runtime(
        &app,
        &plugin_key,
        registry.finish(&plugin_key, runtime_error),
    );
    let (outcome, detail) = audit_outcome(&execution);
    match crate::mcp_control::db(&app) {
        Ok(conn) => {
            if let Err(error) = crate::plugin_grants::audit(
                &conn,
                &plugin_key,
                "tool-call",
                outcome,
                detail,
                Some(&package.fingerprint),
            ) {
                log::warn!("não consegui auditar chamada do plugin {plugin_key}: {error}");
            }
        }
        Err(error) => {
            log::warn!("não consegui abrir auditoria do plugin {plugin_key}: {error}");
        }
    }
    execution
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_impede_duas_chamadas_e_stop_marca_estado_real() {
        let registry = PluginRuntimeRegistry::default();
        assert_eq!(
            registry.reserve("acme.quality", "review").unwrap().state,
            PluginRuntimeState::Starting
        );
        assert!(registry.reserve("acme.quality", "again").is_err());
        let running = registry.running("acme.quality", 0);
        assert_eq!(running.state, PluginRuntimeState::Running);
        assert_eq!(
            registry.stop("acme.quality").state,
            PluginRuntimeState::Stopping
        );
        assert_eq!(
            registry.finish("acme.quality", None).state,
            PluginRuntimeState::Idle
        );
    }

    #[test]
    fn worker_precisa_ser_executavel_no_unix() {
        let root = std::env::temp_dir().join(format!("frota-worker-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let main = root.join("main");
        std::fs::write(&main, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        assert!(!executable(&main));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn handshake_exige_as_tools_exatas_do_manifesto() {
        let input = b"{\"type\":\"log\",\"level\":\"info\",\"message\":\"boot\"}\n{\"type\":\"ready\",\"protocolVersion\":1,\"tools\":[\"b\",\"a\"]}\n";
        let mut reader = BufReader::new(&input[..]);
        let mut logs = VecDeque::new();
        ready(&mut reader, &["a".into(), "b".into()], &mut logs)
            .await
            .unwrap();
        assert_eq!(logs.front().map(String::as_str), Some("info: boot"));

        let mismatch = b"{\"type\":\"ready\",\"protocolVersion\":1,\"tools\":[\"outra\"]}\n";
        let mut reader = BufReader::new(&mismatch[..]);
        assert!(ready(&mut reader, &["a".into()], &mut VecDeque::new())
            .await
            .unwrap_err()
            .contains("diferentes do manifesto"));
    }

    #[tokio::test]
    async fn resultado_precisa_pertencer_a_chamada_atual() {
        let input = b"{\"type\":\"result\",\"requestId\":\"outra\",\"output\":{}}\n";
        let mut reader = BufReader::new(&input[..]);
        assert!(result(&mut reader, "call-1", &mut VecDeque::new())
            .await
            .unwrap_err()
            .contains("requestId diferente"));
    }

    #[tokio::test]
    async fn resultado_reserva_espaco_para_o_envelope_do_gateway() {
        let output = "x".repeat(MAX_RESULT_BYTES + 1);
        let frame = serde_json::json!({
            "type": "result",
            "requestId": "call-1",
            "output": output,
        })
        .to_string()
            + "\n";
        let mut reader = BufReader::new(frame.as_bytes());
        assert!(result(&mut reader, "call-1", &mut VecDeque::new())
            .await
            .unwrap_err()
            .contains("resultado do worker excedeu"));
    }
}
