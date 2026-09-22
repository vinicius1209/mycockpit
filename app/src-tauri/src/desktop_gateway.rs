//! `frota-desktop`: o controlador de desktop da Frota para qualquer motor que fale MCP,
//! servido por este binário (`desktop-server`) pelo MESMO socket do run (`FROTA_WORK_SOCK`).
//!
//! A observação (status e captura de tela) é livre; ações de pilotagem (clique,
//! movimento, digitação, atalhos de teclado e arraste) exigem concessão explícita (grant)
//! da pessoa e uma lease RAII de piloto segurada até o fim do run.

use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

pub const MCP_SERVER_NAME: &str = "frota-desktop";
pub const SUBCOMANDO: &str = "desktop-server";

pub const STATUS_TOOL: &str = "desktop_status";
pub const CAPTURE_TOOL: &str = "desktop_capture";
pub const CLICK_TOOL: &str = "desktop_click";
pub const MOVE_TOOL: &str = "desktop_move";
pub const TYPE_TOOL: &str = "desktop_type";
pub const KEY_TOOL: &str = "desktop_key";
pub const DRAG_TOOL: &str = "desktop_drag";

const PEDIDO_INTERVALO_MS: i64 = 30_000;

pub fn is_desktop_tool(name: &str) -> bool {
    matches!(
        name,
        STATUS_TOOL | CAPTURE_TOOL | CLICK_TOOL | MOVE_TOOL | TYPE_TOOL | KEY_TOOL | DRAG_TOOL
    )
}

pub const TOOLS: [&str; 7] = [
    STATUS_TOOL,
    CAPTURE_TOOL,
    CLICK_TOOL,
    MOVE_TOOL,
    TYPE_TOOL,
    KEY_TOOL,
    DRAG_TOOL,
];

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
            "args": [SUBCOMANDO],
            "env": { crate::work_gateway::SOCK_ENV: self.socket }
        })
    }

    pub fn configure_codex(&self, cmd: &mut Command) {
        let key = format!("mcp_servers.{MCP_SERVER_NAME}");
        let quote = |value: &str| serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into());
        cmd.arg("-c")
            .arg(format!("{key}.enabled=true"))
            .arg("-c")
            .arg(format!("{key}.command={}", quote(&self.server_bin)))
            .arg("-c")
            .arg(format!("{key}.args=[\"{SUBCOMANDO}\"]"))
            .arg("-c")
            .arg(format!(
                "{key}.env.{}={}",
                crate::work_gateway::SOCK_ENV,
                quote(&self.socket)
            ));
    }
}

/// Estado do gateway de desktop por run: a lease de piloto e relógio do pedido.
#[derive(Default)]
pub struct DesktopGateway {
    lease: Mutex<Option<crate::desktop_broker::DesktopPilotLease>>,
    ultimo_pedido_ms: Mutex<i64>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|t| t.as_millis() as i64)
        .unwrap_or(0)
}

/// Assegura que o run possui grant e adquire a lease exclusiva de piloto.
fn assegurar_lease(
    app: &tauri::AppHandle,
    gateway: &DesktopGateway,
    run_id: &str,
    conv_id: &str,
) -> Result<(), String> {
    use tauri::Manager;

    let mut lease = gateway
        .lease
        .lock()
        .map_err(|_| "lease indisponível".to_string())?;

    if lease.is_some() {
        return Ok(());
    }

    let broker = app.state::<Arc<crate::desktop_broker::DesktopBroker>>();

    // Se o run ainda não recebeu grant da pessoa:
    if !broker.has_grant(run_id) {
        let agora = now_ms();
        let pedir = gateway
            .ultimo_pedido_ms
            .lock()
            .map(|mut t| {
                if agora - *t >= PEDIDO_INTERVALO_MS {
                    *t = agora;
                    true
                } else {
                    false
                }
            })
            .unwrap_or(false);

        if pedir {
            crate::work_gateway::emit_work(
                app,
                "desktop_needed",
                json!({
                    "runId": run_id,
                    "convId": conv_id,
                    "reason": "o agente solicitou autorização para pilotar o desktop",
                }),
            );
        }

        return Err("O controle do desktop ainda não foi autorizado pela pessoa para este turno. A Frota solicitou a confirmação na tela; peça autorização à pessoa ou aguarde o aceite.".into());
    }

    match broker.acquire_pilot(run_id) {
        Ok(nova) => {
            *lease = Some(nova);
            Ok(())
        }
        Err(erro) => Err(erro),
    }
}

/// Caminho único temporário para captura de tela (permissão 0600).
fn temp_capture_path(conv_id: &str) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("frota-captures");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe_conv: String = conv_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(16)
        .collect();
    let nome = format!("desktop_{}_{}_{}.png", safe_conv, now_ms(), std::process::id());
    Ok(dir.join(nome))
}

/// Trata uma ação do `frota-desktop` vinda pelo socket do run.
pub async fn handle(
    app: &tauri::AppHandle,
    gateway: &DesktopGateway,
    run_id: &str,
    conv_id: &str,
    action: &str,
    args: &Value,
) -> Result<Value, String> {
    match action {
        STATUS_TOOL => {
            let info = crate::desktop_driver::display_info();
            Ok(json!({
                "platform": info.platform,
                "width": info.width,
                "height": info.height,
                "screenRecording": info.screen_recording_granted,
                "accessibility": info.accessibility_granted,
            }))
        }
        CAPTURE_TOOL => {
            let dest = temp_capture_path(conv_id)?;
            let path = crate::desktop_driver::capture_screen(&dest)?;
            let info = crate::desktop_driver::display_info();
            Ok(json!({
                "png_path": path.to_string_lossy(),
                "width": info.width,
                "height": info.height,
            }))
        }
        CLICK_TOOL => {
            assegurar_lease(app, gateway, run_id, conv_id)?;
            let x = args.get("x").and_then(Value::as_f64).ok_or("parâmetro 'x' ausente")?;
            let y = args.get("y").and_then(Value::as_f64).ok_or("parâmetro 'y' ausente")?;
            let button = args.get("button").and_then(Value::as_str).unwrap_or("left");
            let double = args.get("double").and_then(Value::as_bool).unwrap_or(false);
            crate::desktop_driver::mouse_click(x, y, button, double)?;
            Ok(json!({ "clicked": true, "x": x, "y": y, "button": button }))
        }
        MOVE_TOOL => {
            assegurar_lease(app, gateway, run_id, conv_id)?;
            let x = args.get("x").and_then(Value::as_f64).ok_or("parâmetro 'x' ausente")?;
            let y = args.get("y").and_then(Value::as_f64).ok_or("parâmetro 'y' ausente")?;
            crate::desktop_driver::mouse_move(x, y)?;
            Ok(json!({ "moved": true, "x": x, "y": y }))
        }
        TYPE_TOOL => {
            assegurar_lease(app, gateway, run_id, conv_id)?;
            let text = args.get("text").and_then(Value::as_str).ok_or("parâmetro 'text' ausente")?;
            crate::desktop_driver::type_text(text)?;
            Ok(json!({ "typed": true, "length": text.len() }))
        }
        KEY_TOOL => {
            assegurar_lease(app, gateway, run_id, conv_id)?;
            let key = args.get("key").and_then(Value::as_str).ok_or("parâmetro 'key' ausente")?;
            let modifiers: Vec<String> = args
                .get("modifiers")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            crate::desktop_driver::press_key(key, &modifiers)?;
            Ok(json!({ "pressed": key, "modifiers": modifiers }))
        }
        DRAG_TOOL => {
            assegurar_lease(app, gateway, run_id, conv_id)?;
            let from_x = args.get("from_x").and_then(Value::as_f64).ok_or("parâmetro 'from_x' ausente")?;
            let from_y = args.get("from_y").and_then(Value::as_f64).ok_or("parâmetro 'from_y' ausente")?;
            let to_x = args.get("to_x").and_then(Value::as_f64).ok_or("parâmetro 'to_x' ausente")?;
            let to_y = args.get("to_y").and_then(Value::as_f64).ok_or("parâmetro 'to_y' ausente")?;
            crate::desktop_driver::mouse_drag(from_x, from_y, to_x, to_y)?;
            Ok(json!({ "dragged": true, "from": [from_x, from_y], "to": [to_x, to_y] }))
        }
        _ => Err(format!("ferramenta de desktop desconhecida: {action}")),
    }
}

// ------------------------------------------------------------ processo MCP ---

pub fn run_mcp_server() {
    let rt = tokio::runtime::Runtime::new().expect("desktop-server: runtime tokio");
    rt.block_on(mcp_loop());
}

async fn mcp_loop() {
    let mut reader = BufReader::new(tokio::io::stdin()).lines();
    let mut stdout = tokio::io::stdout();

    async fn write(stdout: &mut tokio::io::Stdout, value: Value) {
        let mut line = value.to_string();
        line.push('\n');
        let _ = stdout.write_all(line.as_bytes()).await;
        let _ = stdout.flush().await;
    }

    while let Ok(Some(line)) = reader.next_line().await {
        let message: Value = match serde_json::from_str(line.trim()) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
        let id = message.get("id").cloned();
        let result = match method {
            "initialize" => Some(json!({
                "protocolVersion": crate::work_gateway::MCP_PROTOCOL_VERSION,
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
                        .and_then(|v| v.get("name"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let args = params
                        .and_then(|v| v.get("arguments"))
                        .cloned()
                        .unwrap_or(Value::Null);
                    let payload = crate::work_gateway::request_parent(tool, &args).await;
                    Some(resposta_da_tool(tool, payload))
                }
            }
            _ => {
                if id.as_ref().is_some_and(|value| !value.is_null()) {
                    write(
                        &mut stdout,
                        json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": { "code": -32601, "message": "method not found" }
                        }),
                    )
                    .await;
                }
                None
            }
        };
        if let (Some(result), Some(id)) = (result, id) {
            write(
                &mut stdout,
                json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            )
            .await;
        }
    }
}

fn resposta_da_tool(tool: &str, payload: Option<Value>) -> Value {
    match payload {
        Some(value) if value.get("ok").and_then(Value::as_bool) == Some(true) => {
            let result = value.get("result").cloned().unwrap_or(Value::Null);
            if tool == CAPTURE_TOOL {
                if let Some(path) = result.get("png_path").and_then(Value::as_str) {
                    let bytes = std::fs::read(path);
                    let _ = std::fs::remove_file(path);
                    if let Ok(bytes) = bytes {
                        use base64::Engine;
                        let data = base64::engine::general_purpose::STANDARD.encode(bytes);
                        let mut texto = result.clone();
                        if let Some(obj) = texto.as_object_mut() {
                            obj.remove("png_path");
                        }
                        return json!({
                            "content": [
                                { "type": "image", "data": data, "mimeType": "image/png" },
                                { "type": "text", "text": texto.to_string() }
                            ]
                        });
                    }
                }
            }
            json!({ "content": [{ "type": "text", "text": result.to_string() }] })
        }
        Some(value) => json!({
            "content": [{ "type": "text", "text": value.get("error").and_then(Value::as_str).unwrap_or("falha no desktop") }],
            "isError": true
        }),
        None => json!({
            "content": [{ "type": "text", "text": "Frota indisponível" }],
            "isError": true
        }),
    }
}

fn tool_specs() -> Vec<Value> {
    vec![
        json!({
            "name": STATUS_TOOL,
            "description": "Informa a resolução da tela principal, plataforma e status das permissões de desktop (Gravação de tela e Acessibilidade). Não requer posse.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": CAPTURE_TOOL,
            "description": "Captura a tela inteira como imagem PNG em alta resolução. Não requer posse.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": CLICK_TOOL,
            "description": "Clica nas coordenadas lógicas (x, y) da tela. Requer grant e posse de pilotagem.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "x": { "type": "number", "description": "Coordenada X em pontos lógicos" },
                    "y": { "type": "number", "description": "Coordenada Y em pontos lógicos" },
                    "button": { "type": "string", "enum": ["left", "right"], "default": "left" },
                    "double": { "type": "boolean", "default": false, "description": "Se verdadeiro, executa clique duplo" }
                },
                "required": ["x", "y"]
            }
        }),
        json!({
            "name": MOVE_TOOL,
            "description": "Move o cursor do mouse para as coordenadas lógicas (x, y) da tela. Requer grant e posse.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "x": { "type": "number" },
                    "y": { "type": "number" }
                },
                "required": ["x", "y"]
            }
        }),
        json!({
            "name": TYPE_TOOL,
            "description": "Digita uma sequência de texto no elemento atualmente focado. Requer grant e posse.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string", "description": "Texto Unicode a digitar" }
                },
                "required": ["text"]
            }
        }),
        json!({
            "name": KEY_TOOL,
            "description": "Pressiona uma tecla com modificadores opcionais (ex: 'Return', 'Tab', 'Escape', modificadores: ['cmd', 'shift']). Requer grant e posse.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "key": { "type": "string", "description": "Nome da tecla (ex: Return, Tab, Escape, c, v)" },
                    "modifiers": {
                        "type": "array",
                        "items": { "type": "string", "enum": ["cmd", "command", "option", "alt", "shift", "ctrl", "control"] }
                    }
                },
                "required": ["key"]
            }
        }),
        json!({
            "name": DRAG_TOOL,
            "description": "Arrasta o mouse das coordenadas (from_x, from_y) até (to_x, to_y). Requer grant e posse.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "from_x": { "type": "number" },
                    "from_y": { "type": "number" },
                    "to_x": { "type": "number" },
                    "to_y": { "type": "number" }
                },
                "required": ["from_x", "from_y", "to_x", "to_y"]
            }
        }),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ferramentas_sao_reconhecidas() {
        assert!(is_desktop_tool(STATUS_TOOL));
        assert!(is_desktop_tool(CAPTURE_TOOL));
        assert!(is_desktop_tool(CLICK_TOOL));
        assert!(!is_desktop_tool("browser_click"));
    }

    #[test]
    fn specs_possuem_schema_valido() {
        let specs = tool_specs();
        assert_eq!(specs.len(), 7);
        for spec in specs {
            assert!(spec.get("name").is_some());
            assert!(spec.get("inputSchema").is_some());
        }
    }
}
