//! `frota-desktop`: o controlador de desktop da Frota para qualquer motor que fale MCP,
//! servido por este binário (`desktop-server`) pelo MESMO socket do run (`FROTA_WORK_SOCK`).
//!
//! Só `desktop_status` (tamanho da tela e permissões) é livre. Ver a tela
//! (`desktop_capture`) exige o grant da pessoa para o run; pilotar (clique,
//! movimento, digitação, atalhos e arraste) exige o grant, uma lease exclusiva
//! que o broker confirma a cada ação, e um modo de permissão que aja.

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

/// Ferramentas que AGEM no computador. Modo plano ou leitura não as recebe
/// (mesma régua dos processos gerenciados, `processes_allowed`).
pub fn is_pilot_tool(name: &str) -> bool {
    matches!(name, CLICK_TOOL | MOVE_TOOL | TYPE_TOOL | KEY_TOOL | DRAG_TOOL)
}

/// Estado do gateway de desktop por run: a lease de piloto e o relógio do
/// pedido. A lease guardada aqui NÃO é prova de posse: a cada ação o broker
/// confirma que a geração dela ainda é a dona (revogar vale na hora).
#[derive(Default)]
pub struct DesktopGateway {
    lease: Mutex<Option<crate::desktop_broker::DesktopPilotLease>>,
    ultimo_pedido_ms: Mutex<i64>,
}

impl DesktopGateway {
    /// O run chegou a pedir o controle (há um aviso na tela a recolher).
    fn pediu(&self) -> bool {
        self.ultimo_pedido_ms.lock().map(|t| *t > 0).unwrap_or(false)
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|t| t.as_millis() as i64)
        .unwrap_or(0)
}

const RECUSA: &str = "A pessoa preferiu não liberar o computador agora. Siga sem ele, ou diga o que queria ver ou fazer na tela e peça que ela confira.";
const SEM_RESPOSTA: &str = "Pedi à pessoa para liberar o computador e esperei 90 s sem resposta. Siga com outra parte do trabalho e diga o que falta ver ou fazer na tela.";
const TURNO_ENCERRADO: &str = "O turno terminou enquanto o pedido de controle do computador esperava a pessoa.";

/// Quanto a tool espera o gesto da pessoa antes de desistir: o mesmo teto do
/// navegador (ADR-228), para os dois pedidos se comportarem igual.
const ESPERA_PELO_GESTO: std::time::Duration = std::time::Duration::from_secs(90);

/// Exige o grant da pessoa. Sem ele, registra o pedido, avisa a tela e ESPERA
/// (ADR-242): liberou → segue na mesma chamada; fechou o aviso → responde na
/// hora; o turno acabou ou ninguém respondeu em 90 s → diz isso. Antes a tool
/// recusava na hora, e o aceite da pessoa chegava depois da chamada já ter
/// falhado (24/09/2026: "eu liberei, aceitei", e o agente não viu a tela).
async fn assegurar_grant(
    app: &tauri::AppHandle,
    gateway: &DesktopGateway,
    run_id: &str,
    conv_id: &str,
) -> Result<Arc<crate::desktop_broker::DesktopBroker>, String> {
    use crate::desktop_broker::EsperaDoGrant;
    use tauri::Manager;
    let broker = app
        .try_state::<Arc<crate::desktop_broker::DesktopBroker>>()
        .ok_or("broker de desktop indisponível")?
        .inner()
        .clone();
    if broker.has_grant(run_id) {
        return Ok(broker);
    }
    // Lease de um grant já revogado: cai aqui, sem efeito físico (a posse já
    // foi devolvida no revoke).
    if let Ok(mut lease) = gateway.lease.lock() {
        lease.take();
    }
    broker.registrar_pedido(run_id);
    let agora = now_ms();
    // Recusa recente vale como resposta: o agente que insiste não reabre o
    // aviso que a pessoa acabou de fechar.
    if broker.recusado_desde(run_id, agora - PEDIDO_INTERVALO_MS) {
        return Err(RECUSA.into());
    }
    // Sem limite de frequência: o aviso tem id por run, então o mesmo pedido
    // nunca aparece duas vezes, e quem espera sempre tem um aviso na tela.
    if let Ok(mut t) = gateway.ultimo_pedido_ms.lock() {
        *t = agora;
    }
    crate::work_gateway::emit_work(
        app,
        "desktop_needed",
        json!({ "runId": run_id, "convId": conv_id }),
    );
    match broker
        .esperar_grant(run_id, agora, ESPERA_PELO_GESTO, std::time::Duration::from_millis(250))
        .await
    {
        EsperaDoGrant::Liberado => Ok(broker),
        EsperaDoGrant::Recusado => Err(RECUSA.into()),
        EsperaDoGrant::Encerrado => Err(TURNO_ENCERRADO.into()),
        EsperaDoGrant::Esgotou => Err(SEM_RESPOSTA.into()),
    }
}



/// Grant e posse exclusiva. Devolve o broker e a geração da posse, para a
/// ação longa conferir a cada passo se continua dona.
async fn assegurar_lease(
    app: &tauri::AppHandle,
    gateway: &DesktopGateway,
    run_id: &str,
    conv_id: &str,
) -> Result<(Arc<crate::desktop_broker::DesktopBroker>, u64), String> {
    let broker = assegurar_grant(app, gateway, run_id, conv_id).await?;
    let mut lease = gateway
        .lease
        .lock()
        .map_err(|_| "lease indisponível".to_string())?;
    if let Some(atual) = lease.as_ref() {
        if broker.is_current(atual.generation()) {
            return Ok((broker.clone(), atual.generation()));
        }
    }
    // Troca a velha pela nova; a velha cai sem efeito (não é mais a dona).
    let nova = broker.acquire_pilot(run_id)?;
    let generation = nova.generation();
    *lease = Some(nova);
    Ok((broker, generation))
}

/// Fim do run (o `WorkListener` caiu): esquece pedido e grant, devolve a posse
/// e recolhe o aviso da tela. Genérico no runtime porque o listener é.
pub fn encerrar_run<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    gateway: &DesktopGateway,
    run_id: &str,
    conv_id: &str,
) {
    use tauri::Manager;
    let had_grant = app
        .try_state::<Arc<crate::desktop_broker::DesktopBroker>>()
        .map(|broker| broker.end_run(run_id))
        .unwrap_or(false);
    if let Ok(mut lease) = gateway.lease.lock() {
        lease.take();
    }
    if had_grant || gateway.pediu() {
        crate::work_gateway::emit_work(
            app,
            "desktop_state",
            json!({ "runId": run_id, "convId": conv_id, "granted": false }),
        );
    }
}

/// Caminho único temporário para captura de tela (permissão 0600).
fn temp_capture_path(conv_id: &str) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("frota-captures");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    let safe_conv: String = conv_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(16)
        .collect();
    let nome = format!("desktop_{}_{}_{}.jpg", safe_conv, now_ms(), std::process::id());
    Ok(dir.join(nome))
}

/// O driver dorme entre eventos (16 ms por caractere) e chama processos: fora
/// das threads do runtime.
async fn bloqueante<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| format!("falha no driver de desktop: {e}"))?
}

/// Trata uma ação do `frota-desktop` vinda pelo socket do run.
/// `pilot_allowed` é o `processes_allowed` do run: modo plano ou leitura não
/// age no computador, mesmo em chamada direta ao socket.
pub async fn handle(
    app: &tauri::AppHandle,
    gateway: &DesktopGateway,
    run_id: &str,
    conv_id: &str,
    pilot_allowed: bool,
    action: &str,
    args: &Value,
) -> Result<Value, String> {
    if is_pilot_tool(action) && !pilot_allowed {
        return Err("pilotar o computador não está disponível neste modo de permissão".into());
    }
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
            // A tela inteira mostra outros apps, senhas e notificações: ver
            // também é gesto da pessoa, não só pilotar.
            assegurar_grant(app, gateway, run_id, conv_id).await?;
            let dest = temp_capture_path(conv_id)?;
            let path = bloqueante(move || crate::desktop_driver::capture_screen(&dest)).await?;
            let info = crate::desktop_driver::display_info();
            Ok(json!({
                "jpeg_path": path.to_string_lossy(),
                "width": info.width,
                "height": info.height,
                "unit": "pontos (as mesmas coordenadas de desktop_click)",
            }))
        }
        CLICK_TOOL => {
            let x = args.get("x").and_then(Value::as_f64).ok_or("parâmetro 'x' ausente")?;
            let y = args.get("y").and_then(Value::as_f64).ok_or("parâmetro 'y' ausente")?;
            let button = args.get("button").and_then(Value::as_str).unwrap_or("left").to_string();
            let double = args.get("double").and_then(Value::as_bool).unwrap_or(false);
            assegurar_lease(app, gateway, run_id, conv_id).await?;
            let botao = button.clone();
            bloqueante(move || crate::desktop_driver::mouse_click(x, y, &botao, double)).await?;
            Ok(json!({ "clicked": true, "x": x, "y": y, "button": button }))
        }
        MOVE_TOOL => {
            let x = args.get("x").and_then(Value::as_f64).ok_or("parâmetro 'x' ausente")?;
            let y = args.get("y").and_then(Value::as_f64).ok_or("parâmetro 'y' ausente")?;
            assegurar_lease(app, gateway, run_id, conv_id).await?;
            bloqueante(move || crate::desktop_driver::mouse_move(x, y)).await?;
            Ok(json!({ "moved": true, "x": x, "y": y }))
        }
        TYPE_TOOL => {
            let text = args
                .get("text")
                .and_then(Value::as_str)
                .ok_or("parâmetro 'text' ausente")?
                .to_string();
            let (broker, generation) = assegurar_lease(app, gateway, run_id, conv_id).await?;
            let length = text.chars().count();
            bloqueante(move || {
                crate::desktop_driver::type_text(&text, &|| broker.is_current(generation))
            })
            .await?;
            Ok(json!({ "typed": true, "length": length }))
        }
        KEY_TOOL => {
            let key = args
                .get("key")
                .and_then(Value::as_str)
                .ok_or("parâmetro 'key' ausente")?
                .to_string();
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
            assegurar_lease(app, gateway, run_id, conv_id).await?;
            let (tecla, mods) = (key.clone(), modifiers.clone());
            bloqueante(move || crate::desktop_driver::press_key(&tecla, &mods)).await?;
            Ok(json!({ "pressed": key, "modifiers": modifiers }))
        }
        DRAG_TOOL => {
            let from_x = args.get("from_x").and_then(Value::as_f64).ok_or("parâmetro 'from_x' ausente")?;
            let from_y = args.get("from_y").and_then(Value::as_f64).ok_or("parâmetro 'from_y' ausente")?;
            let to_x = args.get("to_x").and_then(Value::as_f64).ok_or("parâmetro 'to_x' ausente")?;
            let to_y = args.get("to_y").and_then(Value::as_f64).ok_or("parâmetro 'to_y' ausente")?;
            let (broker, generation) = assegurar_lease(app, gateway, run_id, conv_id).await?;
            bloqueante(move || {
                crate::desktop_driver::mouse_drag(from_x, from_y, to_x, to_y, &|| {
                    broker.is_current(generation)
                })
            })
            .await?;
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
            "tools/list" => {
                let readiness = crate::work_gateway::request_parent("work_ready", &json!({})).await;
                Some(json!({ "tools": available_tools(readiness.as_ref()) }))
            }
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
                if let Some(path) = result.get("jpeg_path").and_then(Value::as_str) {
                    let bytes = std::fs::read(path);
                    let _ = std::fs::remove_file(path);
                    if let Ok(bytes) = bytes {
                        use base64::Engine;
                        let data = base64::engine::general_purpose::STANDARD.encode(bytes);
                        let mut texto = result.clone();
                        if let Some(obj) = texto.as_object_mut() {
                            obj.remove("jpeg_path");
                        }
                        return json!({
                            "content": [
                                { "type": "image", "data": data, "mimeType": "image/jpeg" },
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

/// Sem o app pronto, nenhuma tool; em modo plano ou leitura, só as de ver.
fn available_tools(readiness: Option<&Value>) -> Vec<Value> {
    let Some(reply) =
        readiness.filter(|reply| reply["ok"] == true && reply["result"]["ready"] == true)
    else {
        return Vec::new();
    };
    let pilot_allowed = reply["result"]["processesAllowed"] == true;
    tool_specs()
        .into_iter()
        .filter(|tool| pilot_allowed || !is_pilot_tool(tool["name"].as_str().unwrap_or("")))
        .collect()
}

fn tool_specs() -> Vec<Value> {
    vec![
        json!({
            "name": STATUS_TOOL,
            "description": "Informa o tamanho da tela principal em pontos, a plataforma e o status das permissões de desktop (Gravação de tela e Acessibilidade). Não requer liberação da pessoa.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": CAPTURE_TOOL,
            "description": "Captura a tela principal como imagem JPEG em pontos (o mesmo espaço de coordenadas de desktop_click). Requer que a pessoa libere o computador para este turno.",
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
        assert!(!is_pilot_tool(STATUS_TOOL));
        assert!(!is_pilot_tool(CAPTURE_TOOL));
        assert!(is_pilot_tool(TYPE_TOOL));
    }

    #[test]
    fn modo_plano_ou_leitura_so_recebe_as_tools_de_ver() {
        let nomes = |reply: Value| -> Vec<String> {
            available_tools(Some(&reply))
                .iter()
                .map(|t| t["name"].as_str().unwrap().to_string())
                .collect()
        };
        let restrito = nomes(json!({ "ok": true, "result": { "ready": true, "processesAllowed": false } }));
        assert_eq!(restrito, vec![STATUS_TOOL, CAPTURE_TOOL]);
        let pleno = nomes(json!({ "ok": true, "result": { "ready": true, "processesAllowed": true } }));
        assert_eq!(pleno.len(), 7);
        assert!(available_tools(None).is_empty(), "sem app, nenhuma tool");
    }

    #[test]
    fn captura_vira_bloco_jpeg_e_apaga_o_arquivo() {
        let jpeg = std::env::temp_dir().join(format!("frota-desktop-teste-{}.jpg", std::process::id()));
        std::fs::write(&jpeg, [0xFF, 0xD8, 0xFF]).unwrap();
        let resposta = resposta_da_tool(
            CAPTURE_TOOL,
            Some(json!({ "ok": true, "result": { "jpeg_path": jpeg.to_string_lossy(), "width": 1512, "height": 982 } })),
        );
        let blocos = resposta["content"].as_array().unwrap();
        assert_eq!(blocos[0]["mimeType"], "image/jpeg");
        assert!(!blocos[1]["text"].as_str().unwrap().contains("jpeg_path"));
        assert!(!jpeg.exists());
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
