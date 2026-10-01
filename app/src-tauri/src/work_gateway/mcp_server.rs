use std::path::Path;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

use super::{
    ferramentas::tool_specs, is_process_tool, MAX_REQUEST_BYTES, MCP_SERVER_NAME, REQUEST_TIMEOUT,
    SOCK_ENV,
};

pub(crate) const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

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
            "tools/list" => {
                let readiness = request_parent("work_ready", &json!({})).await;
                Some(json!({ "tools": available_tools(readiness.as_ref()) }))
            }
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
                            "content": [{ "type": "text", "text": "Frota indisponível" }],
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

pub(crate) fn available_tools(readiness: Option<&Value>) -> Vec<Value> {
    let Some(reply) =
        readiness.filter(|reply| reply["ok"] == true && reply["result"]["ready"] == true)
    else {
        return Vec::new();
    };
    let processes_allowed = reply["result"]["processesAllowed"] == true;
    tool_specs()
        .into_iter()
        .filter(|tool| processes_allowed || !is_process_tool(tool["name"].as_str().unwrap_or("")))
        .collect()
}

pub(crate) async fn request_parent(action: &str, args: &Value) -> Option<Value> {
    let socket = std::env::var(SOCK_ENV).ok()?;
    request_socket(Path::new(&socket), action, args).await
}

/// Quanto uma ação pode levar do lado do app. Navegador e computador podem
/// esperar o gesto da pessoa (até 90 s, ADR-228 e ADR-242); a página roda código
/// até 30 s e o computador digita a 16 ms por caractere. O resto segue nos 6 s.
pub(crate) fn teto_do_pedido(action: &str) -> std::time::Duration {
    if crate::browser_gateway::is_browser_tool(action) {
        std::time::Duration::from_secs(130)
    } else if crate::desktop_gateway::is_desktop_tool(action) {
        std::time::Duration::from_secs(150)
    } else {
        REQUEST_TIMEOUT
    }
}

pub(crate) async fn request_socket(socket: &Path, action: &str, args: &Value) -> Option<Value> {
    tokio::time::timeout(teto_do_pedido(action), async {
        let mut stream = UnixStream::connect(socket).await.ok()?;
        let mut request = json!({ "action": action, "args": args }).to_string();
        request.push('\n');
        stream.write_all(request.as_bytes()).await.ok()?;
        stream.flush().await.ok()?;
        let mut line = String::new();
        BufReader::new(stream.take(MAX_REQUEST_BYTES + 1))
            .read_line(&mut line)
            .await
            .ok()?;
        if line.len() as u64 > MAX_REQUEST_BYTES {
            return None;
        }
        serde_json::from_str(line.trim()).ok()
    })
    .await
    .ok()
    .flatten()
}

async fn write_line(stdout: &mut tokio::io::Stdout, value: &Value) {
    let mut line = value.to_string();
    line.push('\n');
    let _ = stdout.write_all(line.as_bytes()).await;
    let _ = stdout.flush().await;
}
