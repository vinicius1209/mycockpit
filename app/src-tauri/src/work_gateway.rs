//! MCP interno de trabalho vivo.
//!
//! O provider relata o trabalho interno com a granularidade que possui. Para
//! processos externos, o MyCockpit precisa ser o dono: este módulo oferece um
//! server MCP por-run e mantém os filhos no processo Tauri, com PID, tail,
//! poll/stop/retry e eventos ao frontend.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::process::Command;

pub const MCP_SERVER_NAME: &str = "mc-work";
pub const PROCESS_START_TOOL: &str = "process_start";
pub const PROCESS_POLL_TOOL: &str = "process_poll";
pub const PROCESS_STOP_TOOL: &str = "process_stop";
pub const WORK_PLAN_TOOL: &str = "work_plan";
pub const WORK_UPDATE_TOOL: &str = "work_update";
pub const SOCK_ENV: &str = "MYCOCKPIT_WORK_SOCK";

const TAIL_LINES: usize = 240;
const MAX_COMMAND_CHARS: usize = 8_000;

#[derive(Clone, Debug)]
pub struct GatewayConfig {
    pub server_bin: String,
    pub socket: String,
}

impl GatewayConfig {
    pub fn claude_server_json(&self) -> Value {
        json!({
            "type": "stdio",
            "command": self.server_bin,
            "args": ["work-server"],
            "env": { SOCK_ENV: self.socket }
        })
    }

    pub fn configure_codex(&self, cmd: &mut Command) {
        let key = format!("mcp_servers.{MCP_SERVER_NAME}");
        cmd.arg("-c")
            .arg(format!("{key}.enabled=true"))
            .arg("-c")
            .arg(format!("{key}.command={}", json_string(&self.server_bin)))
            .arg("-c")
            .arg(format!("{key}.args=[\"work-server\"]"))
            .arg("-c")
            .arg(format!(
                "{key}.env.{SOCK_ENV}={}",
                json_string(&self.socket)
            ));
    }
}

fn json_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedProcessView {
    pub id: String,
    pub run_id: String,
    pub conv_id: String,
    pub label: String,
    pub command: String,
    pub cwd: String,
    pub pid: u32,
    pub status: String,
    pub exit_code: Option<i32>,
    pub output: String,
    pub started_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug)]
struct ProcessRecord {
    view: ManagedProcessView,
    tail: VecDeque<String>,
}

impl ProcessRecord {
    fn refresh_output(&mut self) {
        self.view.output = self.tail.iter().cloned().collect::<Vec<_>>().join("\n");
    }
}

#[derive(Default)]
pub struct ProcessRegistry {
    processes: Arc<Mutex<HashMap<String, ProcessRecord>>>,
}

impl ProcessRegistry {
    pub fn kill_all(&self) {
        let pids: Vec<u32> = self
            .processes
            .lock()
            .map(|map| {
                map.values()
                    .filter(|record| record.view.status == "running")
                    .map(|record| record.view.pid)
                    .collect()
            })
            .unwrap_or_default();
        for pid in pids {
            signal_process_group(pid, "-KILL");
        }
    }

    /// pub(crate): o navegador do projeto (browser.rs) lê o tail deste mesmo
    /// registry para achar a linha "DevTools listening on ws://…".
    pub(crate) fn view(&self, id: &str) -> Option<ManagedProcessView> {
        self.processes
            .lock()
            .ok()
            .and_then(|map| map.get(id).map(|record| record.view.clone()))
    }

    fn append_output(&self, app: &tauri::AppHandle, id: &str, stream: &str, line: String) {
        let mut view = None;
        if let Ok(mut map) = self.processes.lock() {
            if let Some(record) = map.get_mut(id) {
                record.tail.push_back(line.clone());
                while record.tail.len() > TAIL_LINES {
                    record.tail.pop_front();
                }
                record.view.updated_at = now_ms();
                record.refresh_output();
                view = Some(record.view.clone());
            }
        }
        if let Some(process) = view {
            emit_work(
                app,
                "process_output",
                json!({ "process": process, "stream": stream, "line": line }),
            );
        }
    }

    fn finish(&self, app: &tauri::AppHandle, id: &str, exit_code: Option<i32>) {
        let mut view = None;
        if let Ok(mut map) = self.processes.lock() {
            if let Some(record) = map.get_mut(id) {
                // Um stop explícito vence a classificação por exit code.
                if record.view.status == "stopping" {
                    record.view.status = "stopped".into();
                } else if record.view.status == "running" {
                    record.view.status = if exit_code == Some(0) {
                        "exited".into()
                    } else {
                        "failed".into()
                    };
                }
                record.view.exit_code = exit_code;
                record.view.updated_at = now_ms();
                view = Some(record.view.clone());
            }
        }
        if let Some(process) = view {
            emit_work(app, "process_exited", json!({ "process": process }));
        }
    }

    /// pub(crate): mesmo substrato para todo processo que o app POSSUI (o
    /// navegador do projeto entra por aqui, com eixo de posse sintético).
    pub(crate) async fn spawn(
        &self,
        app: tauri::AppHandle,
        run_id: String,
        conv_id: String,
        command: String,
        cwd: String,
        label: Option<String>,
    ) -> Result<ManagedProcessView, String> {
        validate_command(&command)?;
        let cwd_path = Path::new(&cwd);
        if !cwd_path.is_dir() {
            return Err(format!("pasta de execução não existe: {cwd}"));
        }
        let id = format!("proc-{}-{}", std::process::id(), next_id());
        let label = label
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| compact_label(&command));

        let mut cmd = Command::new("/bin/zsh");
        cmd.arg("-lc")
            .arg(&command)
            .current_dir(&cwd)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(false);
        #[cfg(unix)]
        cmd.process_group(0);
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("falha ao iniciar processo: {e}"))?;
        let pid = child.id().ok_or("processo iniciado sem PID")?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let started_at = now_ms();
        let view = ManagedProcessView {
            id: id.clone(),
            run_id,
            conv_id,
            label,
            command,
            cwd,
            pid,
            status: "running".into(),
            exit_code: None,
            output: String::new(),
            started_at,
            updated_at: started_at,
        };
        if let Ok(mut map) = self.processes.lock() {
            map.insert(
                id.clone(),
                ProcessRecord {
                    view: view.clone(),
                    tail: VecDeque::new(),
                },
            );
        }
        emit_work(&app, "process_started", json!({ "process": view.clone() }));

        if let Some(stdout) = stdout {
            let registry = self.clone_arc();
            let app = app.clone();
            let id = id.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    registry.append_output(&app, &id, "stdout", line);
                }
            });
        }
        if let Some(stderr) = stderr {
            let registry = self.clone_arc();
            let app = app.clone();
            let id = id.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    registry.append_output(&app, &id, "stderr", line);
                }
            });
        }
        let registry = self.clone_arc();
        let app2 = app.clone();
        let id2 = id.clone();
        tokio::spawn(async move {
            let code = child.wait().await.ok().and_then(|status| status.code());
            registry.finish(&app2, &id2, code);
        });
        Ok(view)
    }

    fn clone_arc(&self) -> Self {
        Self {
            processes: self.processes.clone(),
        }
    }

    pub(crate) fn stop(
        &self,
        app: &tauri::AppHandle,
        id: &str,
    ) -> Result<ManagedProcessView, String> {
        let pid = {
            let mut map = self.processes.lock().map_err(|_| "registry indisponível")?;
            let record = map.get_mut(id).ok_or("processo não encontrado")?;
            if record.view.status != "running" {
                return Ok(record.view.clone());
            }
            record.view.status = "stopping".into();
            record.view.updated_at = now_ms();
            record.view.pid
        };
        signal_process_group(pid, "-TERM");
        let process = self.view(id).ok_or("processo não encontrado")?;
        emit_work(
            app,
            "process_stopping",
            json!({ "process": process.clone() }),
        );
        Ok(process)
    }
}

fn validate_command(command: &str) -> Result<(), String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("comando vazio".into());
    }
    if trimmed.chars().count() > MAX_COMMAND_CHARS {
        return Err("comando longo demais".into());
    }
    Ok(())
}

fn compact_label(command: &str) -> String {
    let one = command
        .split_whitespace()
        .take(6)
        .collect::<Vec<_>>()
        .join(" ");
    if one.chars().count() > 72 {
        one.chars().take(71).collect::<String>() + "…"
    } else {
        one
    }
}

fn signal_process_group(pid: u32, signal: &str) {
    if pid <= 1 {
        return;
    }
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .args([signal, &format!("-{pid}")])
            .output();
    }
}

fn next_id() -> u64 {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkEvent {
    kind: String,
    data: Value,
}

/// pub(crate): `work://event` é o canal único de trabalho vivo da UI. O estado
/// do navegador do projeto (`browser_state`) viaja por ele, sem inventar canal.
pub(crate) fn emit_work(app: &tauri::AppHandle, kind: &str, data: Value) {
    let _ = app.emit(
        "work://event",
        WorkEvent {
            kind: kind.into(),
            data,
        },
    );
}

fn socket_candidates(run_id: &str) -> [PathBuf; 3] {
    let short: String = run_id.chars().take(8).collect();
    let dir = std::env::temp_dir();
    [
        dir.join(format!("mc-work-{short}.sock")),
        dir.join(format!("mc-work-{short}-1.sock")),
        dir.join(format!("mc-work-{short}-2.sock")),
    ]
}

fn bind_socket(run_id: &str) -> Option<(PathBuf, UnixListener)> {
    for path in socket_candidates(run_id) {
        if path.exists() {
            if std::os::unix::net::UnixStream::connect(&path).is_ok() {
                continue;
            }
            let _ = std::fs::remove_file(&path);
        }
        if let Ok(listener) = UnixListener::bind(&path) {
            return Some((path, listener));
        }
    }
    None
}

pub struct WorkListener {
    path: PathBuf,
    task: tokio::task::JoinHandle<()>,
}

impl WorkListener {
    pub fn spawn(
        app: tauri::AppHandle,
        run_id: String,
        conv_id: String,
        cwd: String,
        registry: Arc<ProcessRegistry>,
    ) -> Option<Self> {
        let (path, listener) = bind_socket(&run_id)?;
        let task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let app = app.clone();
                let run_id = run_id.clone();
                let conv_id = conv_id.clone();
                let cwd = cwd.clone();
                let registry = registry.clone();
                tokio::spawn(async move {
                    handle_request(stream, app, run_id, conv_id, cwd, registry).await;
                });
            }
        });
        Some(Self { path, task })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for WorkListener {
    fn drop(&mut self) {
        self.task.abort();
        let _ = std::fs::remove_file(&self.path);
    }
}

async fn handle_request(
    stream: UnixStream,
    app: tauri::AppHandle,
    run_id: String,
    conv_id: String,
    cwd: String,
    registry: Arc<ProcessRegistry>,
) {
    let (rd, mut wr) = stream.into_split();
    let mut line = String::new();
    let mut reader = BufReader::new(rd);
    if reader.read_line(&mut line).await.is_err() {
        return;
    }
    let request: Value = match serde_json::from_str(line.trim()) {
        Ok(value) => value,
        Err(_) => return,
    };
    let action = request.get("action").and_then(Value::as_str).unwrap_or("");
    let args = request.get("args").cloned().unwrap_or(Value::Null);
    let answer = match action {
        PROCESS_START_TOOL => {
            let command = args
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let label = args
                .get("label")
                .and_then(Value::as_str)
                .map(str::to_string);
            registry
                .spawn(app.clone(), run_id, conv_id, command, cwd, label)
                .await
                .map(|process| json!({ "process": process }))
        }
        PROCESS_POLL_TOOL => args
            .get("process_id")
            .and_then(Value::as_str)
            .and_then(|id| registry.view(id))
            .map(|process| json!({ "process": process }))
            .ok_or_else(|| "processo não encontrado".to_string()),
        PROCESS_STOP_TOOL => args
            .get("process_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "process_id ausente".to_string())
            .and_then(|id| registry.stop(&app, id))
            .map(|process| json!({ "process": process })),
        WORK_PLAN_TOOL => {
            emit_work(
                &app,
                "work_plan",
                json!({ "runId": run_id, "convId": conv_id, "tasks": args.get("tasks").cloned().unwrap_or(json!([])) }),
            );
            Ok(json!({ "accepted": true }))
        }
        WORK_UPDATE_TOOL => {
            emit_work(
                &app,
                "work_update",
                json!({ "runId": run_id, "convId": conv_id, "task": args }),
            );
            Ok(json!({ "accepted": true }))
        }
        _ => Err("ação desconhecida".into()),
    };
    let response = match answer {
        Ok(result) => json!({ "ok": true, "result": result }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    let mut buf = response.to_string();
    buf.push('\n');
    let _ = wr.write_all(buf.as_bytes()).await;
    let _ = wr.flush().await;
}

#[tauri::command]
pub fn managed_process_stop(
    app: tauri::AppHandle,
    process_id: String,
    registry: tauri::State<'_, Arc<ProcessRegistry>>,
) -> Result<ManagedProcessView, String> {
    registry.stop(&app, &process_id)
}

#[tauri::command]
pub async fn managed_process_retry(
    app: tauri::AppHandle,
    process_id: String,
    registry: tauri::State<'_, Arc<ProcessRegistry>>,
) -> Result<ManagedProcessView, String> {
    let old = registry
        .view(&process_id)
        .ok_or_else(|| "processo não encontrado".to_string())?;
    registry
        .spawn(
            app,
            old.run_id,
            old.conv_id,
            old.command,
            old.cwd,
            Some(old.label),
        )
        .await
}

#[tauri::command]
pub async fn managed_process_start(
    app: tauri::AppHandle,
    conv_id: String,
    command: String,
    cwd: String,
    label: Option<String>,
    registry: tauri::State<'_, Arc<ProcessRegistry>>,
) -> Result<ManagedProcessView, String> {
    registry
        .spawn(
            app,
            format!("manual-{}", next_id()),
            conv_id,
            command,
            cwd,
            label,
        )
        .await
}

// ---- MCP stdio ------------------------------------------------------------

const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

pub fn run_mcp_server() {
    let rt = tokio::runtime::Runtime::new().expect("work-server: runtime tokio");
    rt.block_on(mcp_loop());
}

async fn mcp_loop() {
    let mut reader = BufReader::new(tokio::io::stdin()).lines();
    let mut stdout = tokio::io::stdout();
    while let Ok(Some(line)) = reader.next_line().await {
        let message: Value = match serde_json::from_str(line.trim()) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
        let id = message.get("id").cloned();
        let result = match method {
            "initialize" => Some(json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": MCP_SERVER_NAME, "version": "0.1.0" }
            })),
            "ping" => Some(json!({})),
            "notifications/initialized" | "initialized" => None,
            "tools/list" => Some(json!({ "tools": tool_specs() })),
            "tools/call" => {
                if id.as_ref().is_none_or(Value::is_null) {
                    None
                } else {
                    let params = message.get("params");
                    let tool = params
                        .and_then(|value| value.get("name"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let args = params
                        .and_then(|value| value.get("arguments"))
                        .cloned()
                        .unwrap_or(Value::Null);
                    let payload = request_parent(tool, &args).await;
                    Some(match payload {
                        Some(value) if value.get("ok").and_then(Value::as_bool) == Some(true) => {
                            json!({ "content": [{ "type": "text", "text": value.get("result").cloned().unwrap_or(Value::Null).to_string() }] })
                        }
                        Some(value) => json!({
                            "content": [{ "type": "text", "text": value.get("error").and_then(Value::as_str).unwrap_or("falha no processo") }],
                            "isError": true
                        }),
                        None => json!({
                            "content": [{ "type": "text", "text": "MyCockpit indisponível" }],
                            "isError": true
                        }),
                    })
                }
            }
            _ => {
                if id.as_ref().is_some_and(|value| !value.is_null()) {
                    let response = json!({
                        "jsonrpc": "2.0", "id": id,
                        "error": { "code": -32601, "message": "method not found" }
                    });
                    write_line(&mut stdout, &response).await;
                }
                None
            }
        };
        if let Some(result) = result {
            if let Some(id) = id {
                write_line(
                    &mut stdout,
                    &json!({ "jsonrpc": "2.0", "id": id, "result": result }),
                )
                .await;
            }
        }
    }
}

fn tool_specs() -> Vec<Value> {
    vec![
        json!({
            "name": PROCESS_START_TOOL,
            "description": "Inicia um processo externo de longa duração sob controle do MyCockpit. Use para dev servers, watchers, containers e comandos que precisam continuar enquanto o turno segue.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "command": { "type": "string" },
                    "label": { "type": "string" }
                },
                "required": ["command"]
            }
        }),
        json!({
            "name": PROCESS_POLL_TOOL,
            "description": "Consulta estado, PID e tail de um processo gerenciado.",
            "inputSchema": {
                "type": "object",
                "properties": { "process_id": { "type": "string" } },
                "required": ["process_id"]
            }
        }),
        json!({
            "name": PROCESS_STOP_TOOL,
            "description": "Interrompe um processo gerenciado e o seu grupo de filhos.",
            "inputSchema": {
                "type": "object",
                "properties": { "process_id": { "type": "string" } },
                "required": ["process_id"]
            }
        }),
        json!({
            "name": WORK_PLAN_TOOL,
            "description": "Publica o plano/to-do vivo do turno para o MyCockpit.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tasks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "title": { "type": "string" },
                                "description": { "type": "string" },
                                "status": { "type": "string", "enum": ["pending", "in_progress", "completed"] }
                            },
                            "required": ["id", "title"]
                        }
                    }
                },
                "required": ["tasks"]
            }
        }),
        json!({
            "name": WORK_UPDATE_TOOL,
            "description": "Atualiza uma tarefa publicada no plano vivo.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "title": { "type": "string" },
                    "description": { "type": "string" },
                    "status": { "type": "string", "enum": ["pending", "in_progress", "completed"] }
                },
                "required": ["id", "status"]
            }
        }),
    ]
}

async fn request_parent(action: &str, args: &Value) -> Option<Value> {
    let socket = std::env::var(SOCK_ENV).ok()?;
    let mut stream = UnixStream::connect(socket).await.ok()?;
    let mut request = json!({ "action": action, "args": args }).to_string();
    request.push('\n');
    stream.write_all(request.as_bytes()).await.ok()?;
    stream.flush().await.ok()?;
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line).await.ok()?;
    serde_json::from_str(line.trim()).ok()
}

async fn write_line(stdout: &mut tokio::io::Stdout, value: &Value) {
    let mut line = value.to_string();
    line.push('\n');
    let _ = stdout.write_all(line.as_bytes()).await;
    let _ = stdout.flush().await;
}

impl Clone for ProcessRegistry {
    fn clone(&self) -> Self {
        self.clone_arc()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valida_comando_e_rotulo_sem_expor_linha_inteira() {
        assert!(validate_command("").is_err());
        assert!(validate_command("pnpm dev").is_ok());
        let label = compact_label("pnpm --filter aplicativo dev --host 0.0.0.0 --verbose");
        assert!(label.starts_with("pnpm --filter"));
        assert!(label.chars().count() <= 72);
    }

    #[test]
    fn gateway_codex_e_claude_apontam_o_mesmo_server() {
        let cfg = GatewayConfig {
            server_bin: "/Applications/MyCockpit".into(),
            socket: "/tmp/mc-work.sock".into(),
        };
        assert_eq!(
            cfg.claude_server_json()["command"],
            "/Applications/MyCockpit"
        );
        let mut cmd = Command::new("codex");
        cfg.configure_codex(&mut cmd);
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert!(args.iter().any(|arg| arg.contains(MCP_SERVER_NAME)));
        assert!(args.iter().any(|arg| arg.contains(SOCK_ENV)));
    }
}
