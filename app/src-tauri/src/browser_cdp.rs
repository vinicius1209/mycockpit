//! Observação e pilotagem do Navegador do projeto por CDP.
//!
//! URLs WebSocket ficam somente no backend. A UI recebe inventário sanitizado
//! e, quando pede preview, busca apenas o frame mais recente mantido em memória.
//! Eventos carregam revisão, nunca imagem/base64. Todo input valida uma lease
//! humana no Experience Broker antes de tocar o navegador.

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use tokio::sync::watch;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;

const CDP_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_TEXT_CHARS: usize = 8_000;
const PREVIEW_NOTICE_INTERVAL_MS: i64 = 100;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawPage {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) url: String,
    #[serde(rename = "type")]
    pub(crate) kind: String,
    #[serde(rename = "webSocketDebuggerUrl")]
    pub(crate) websocket_url: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPage {
    pub id: String,
    pub title: String,
    pub url: String,
    pub display_url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPreviewStatus {
    pub project_id: String,
    pub target_id: String,
    pub running: bool,
    pub revision: u64,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPreviewFrame {
    pub project_id: String,
    pub target_id: String,
    pub revision: u64,
    pub captured_at: i64,
    pub data: String,
    pub width: Option<f64>,
    pub height: Option<f64>,
}

#[derive(Default)]
struct LatestFrame {
    captured_at: i64,
    data: String,
    width: Option<f64>,
    height: Option<f64>,
}

struct PreviewSession {
    project_id: String,
    target_id: String,
    latest: Mutex<LatestFrame>,
    revision: AtomicU64,
    last_notice_at: AtomicI64,
    running: AtomicBool,
    error: Mutex<Option<String>>,
    stop: watch::Sender<bool>,
}

impl PreviewSession {
    fn status(&self) -> BrowserPreviewStatus {
        BrowserPreviewStatus {
            project_id: self.project_id.clone(),
            target_id: self.target_id.clone(),
            running: self.running.load(Ordering::Relaxed),
            revision: self.revision.load(Ordering::Relaxed),
            error: self.error.lock().ok().and_then(|value| value.clone()),
        }
    }
}

#[derive(Default)]
pub struct BrowserPreviewRegistry {
    sessions: Mutex<HashMap<String, Arc<PreviewSession>>>,
}

impl BrowserPreviewRegistry {
    pub fn stop_project(&self, project_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(session) = sessions.remove(project_id) {
                let _ = session.stop.send(true);
            }
        }
    }

    fn get(&self, project_id: &str) -> Option<Arc<PreviewSession>> {
        self.sessions
            .lock()
            .ok()
            .and_then(|sessions| sessions.get(project_id).cloned())
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn should_notify_preview(last_notice_at: i64, captured_at: i64) -> bool {
    last_notice_at == 0 || captured_at.saturating_sub(last_notice_at) >= PREVIEW_NOTICE_INTERVAL_MS
}

pub(crate) fn sanitize_page_url(raw: &str) -> String {
    sanitize_page_url_no_projeto(raw, None)
}

/// Caminho local RELATIVO ao projeto quando o arquivo é dele (ADR-224): mock
/// aberto pela barra aparece como `docs/mocks/x.html`, que é o que a pessoa
/// digitou. Fora do projeto continua `file://…`: caminho da máquina não vaza
/// para o inventário público.
fn caminho_no_projeto(parsed: &url::Url, raiz: &Path) -> Option<String> {
    let arquivo = parsed.to_file_path().ok()?;
    let arquivo = arquivo.canonicalize().unwrap_or(arquivo);
    let raiz = raiz.canonicalize().ok()?;
    let relativo = arquivo.strip_prefix(&raiz).ok()?;
    let texto = relativo.to_string_lossy();
    if texto.is_empty() {
        return None;
    }
    Some(texto.chars().take(512).collect())
}

pub(crate) fn sanitize_page_url_no_projeto(raw: &str, raiz: Option<&Path>) -> String {
    let Ok(mut parsed) = url::Url::parse(raw) else {
        return "Endereço indisponível".into();
    };
    if parsed.scheme() == "file" {
        if let Some(relativo) = raiz.and_then(|raiz| caminho_no_projeto(&parsed, raiz)) {
            return relativo;
        }
    }
    match parsed.scheme() {
        "http" | "https" => {
            let _ = parsed.set_username("");
            let _ = parsed.set_password(None);
            parsed.set_query(None);
            parsed.set_fragment(None);
            parsed.to_string().chars().take(512).collect()
        }
        "about" | "chrome" | "devtools" => {
            parsed.set_query(None);
            parsed.set_fragment(None);
            parsed.to_string().chars().take(160).collect()
        }
        "file" => "file://…".into(),
        scheme => format!("{scheme}:…"),
    }
}

fn public_page(page: RawPage, raiz: &Path) -> BrowserPage {
    let url = sanitize_page_url_no_projeto(&page.url, Some(raiz));
    BrowserPage {
        id: page.id,
        title: page.title.chars().take(240).collect(),
        display_url: url.clone(),
        url,
    }
}

pub(crate) async fn raw_pages(endpoint: &str) -> Result<Vec<RawPage>, String> {
    let response = timeout(
        CDP_TIMEOUT,
        reqwest::Client::new()
            .get(format!("{endpoint}/json/list"))
            .send(),
    )
    .await
    .map_err(|_| "o inventário do navegador excedeu o tempo limite".to_string())?
    .map_err(|error| format!("não consegui consultar o navegador: {error}"))?;
    if !response.status().is_success() {
        return Err("o navegador não respondeu ao inventário de páginas".into());
    }
    timeout(CDP_TIMEOUT, response.json::<Vec<RawPage>>())
        .await
        .map_err(|_| "a resposta do inventário excedeu o tempo limite".to_string())?
        .map_err(|error| format!("inventário de páginas inválido: {error}"))
}

pub(crate) async fn project_session(
    app: &tauri::AppHandle,
    project_path: &str,
) -> Result<(String, crate::browser::BrowserSession), String> {
    let project_id = crate::browser::project_id_of(app, project_path)?;
    crate::browser::live_endpoint(app, &project_id)
        .await
        .ok_or("o Navegador do projeto está desligado")?;
    let session = app
        .state::<Arc<crate::browser::BrowserRegistry>>()
        .get(&project_id)
        .ok_or("a sessão do navegador deixou de existir")?;
    Ok((project_id, session))
}

pub(crate) async fn target_for(
    app: &tauri::AppHandle,
    project_path: &str,
    target_id: &str,
) -> Result<(String, RawPage), String> {
    let (project_id, session) = project_session(app, project_path).await?;
    let page = raw_pages(&session.endpoint)
        .await?
        .into_iter()
        .find(|page| page.kind == "page" && page.id == target_id)
        .ok_or("a página escolhida não existe mais")?;
    if page.websocket_url.is_none() {
        return Err("a página não publicou um canal de observação".into());
    }
    Ok((project_id, page))
}

#[tauri::command]
pub async fn browser_pages(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<Vec<BrowserPage>, String> {
    let (_, session) = project_session(&app, &project_path).await?;
    Ok(raw_pages(&session.endpoint)
        .await?
        .into_iter()
        .filter(|page| page.kind == "page")
        .map(|page| public_page(page, Path::new(&project_path)))
        .collect())
}

async fn run_screencast(
    app: tauri::AppHandle,
    session: Arc<PreviewSession>,
    websocket_url: String,
    mut stop: watch::Receiver<bool>,
) -> Result<(), String> {
    let (mut socket, _) = timeout(CDP_TIMEOUT, tokio_tungstenite::connect_async(websocket_url))
        .await
        .map_err(|_| "a conexão de preview excedeu o tempo limite".to_string())?
        .map_err(|error| format!("não consegui observar a página: {error}"))?;
    socket
        .send(Message::Text(
            json!({
                "id": 1,
                "method": "Page.startScreencast",
                "params": {"format": "jpeg", "quality": 68, "maxWidth": 1440, "maxHeight": 1000, "everyNthFrame": 1}
            })
            .to_string()
            .into(),
        ))
        .await
        .map_err(|error| format!("não consegui iniciar o preview: {error}"))?;
    let mut message_id = 2_u64;
    // Ritmo do screencast (ADR-232): o Chromium só manda o próximo quadro
    // depois do ack. Confirmar na hora fazia ele codificar ~60 JPEGs por
    // segundo (151 KB cada em 1280×800, medido) para uma tela que puxa no
    // máximo 10. O ack espera o intervalo do aviso, e o Chromium codifica só
    // o que alguém vai ver.
    let mut ultimo_ack: Option<tokio::time::Instant> = None;
    let mut ack_pendente: Option<u64> = None;
    let intervalo = std::time::Duration::from_millis(PREVIEW_NOTICE_INTERVAL_MS as u64);
    loop {
        let ack_em = ultimo_ack.map(|t| t + intervalo).unwrap_or_else(tokio::time::Instant::now);
        tokio::select! {
            changed = stop.changed() => {
                if changed.is_err() || *stop.borrow() { break; }
            }
            _ = tokio::time::sleep_until(ack_em), if ack_pendente.is_some() => {
                let cdp_session = ack_pendente.take().expect("guardado acima");
                socket.send(Message::Text(json!({
                    "id": message_id,
                    "method": "Page.screencastFrameAck",
                    "params": {"sessionId": cdp_session}
                }).to_string().into())).await.map_err(|error| format!("preview interrompido: {error}"))?;
                message_id += 1;
                ultimo_ack = Some(tokio::time::Instant::now());
            }
            incoming = socket.next() => {
                let Some(message) = incoming else { return Err("o canal de preview foi encerrado".into()); };
                let message = message.map_err(|error| format!("preview interrompido: {error}"))?;
                let Message::Text(text) = message else { continue; };
                let Ok(value) = serde_json::from_str::<Value>(&text) else { continue; };
                if value.get("method").and_then(Value::as_str) != Some("Page.screencastFrame") {
                    continue;
                }
                let Some(params) = value.get("params") else { continue; };
                let Some(data) = params.get("data").and_then(Value::as_str) else { continue; };
                let cdp_session = params.get("sessionId").and_then(Value::as_u64);
                let metadata = params.get("metadata");
                let captured_at = now_ms();
                if let Ok(mut latest) = session.latest.lock() {
                    latest.captured_at = captured_at;
                    latest.data.clear();
                    latest.data.push_str(data);
                    latest.width = metadata.and_then(|item| item.get("deviceWidth")).and_then(Value::as_f64);
                    latest.height = metadata.and_then(|item| item.get("deviceHeight")).and_then(Value::as_f64);
                }
                let revision = session.revision.fetch_add(1, Ordering::Relaxed) + 1;
                let last_notice_at = session.last_notice_at.load(Ordering::Relaxed);
                if should_notify_preview(last_notice_at, captured_at) {
                    session
                        .last_notice_at
                        .store(captured_at, Ordering::Relaxed);
                    let _ = app.emit("browser-preview://frame", json!({
                        "projectId": session.project_id,
                        "targetId": session.target_id,
                        "revision": revision,
                    }));
                }
                // O ack sai no ritmo, pelo braço de cima do select.
                if let Some(cdp_session) = cdp_session {
                    ack_pendente = Some(cdp_session);
                }
            }
        }
    }
    let _ = socket
        .send(Message::Text(
            json!({"id": message_id, "method": "Page.stopScreencast"})
                .to_string()
                .into(),
        ))
        .await;
    Ok(())
}

#[tauri::command]
pub async fn browser_preview_start(
    app: tauri::AppHandle,
    project_path: String,
    target_id: String,
) -> Result<BrowserPreviewStatus, String> {
    let (project_id, page) = target_for(&app, &project_path, &target_id).await?;
    // Navegador ligado antes do ADR-229 ainda tem a página de 756×413: a
    // primeira vista acerta, sem segurar o quadro (no-op quando já está certa).
    let ajuste = app.clone();
    let caminho = project_path.clone();
    tauri::async_runtime::spawn(async move {
        crate::browser_janela::ajustar_no_projeto(&ajuste, &caminho).await;
    });
    let registry = app.state::<Arc<BrowserPreviewRegistry>>().inner().clone();
    if let Some(current) = registry.get(&project_id) {
        if current.target_id == target_id && current.running.load(Ordering::Relaxed) {
            return Ok(current.status());
        }
        registry.stop_project(&project_id);
    }
    let (stop, receiver) = watch::channel(false);
    let preview = Arc::new(PreviewSession {
        project_id: project_id.clone(),
        target_id,
        latest: Mutex::new(LatestFrame::default()),
        revision: AtomicU64::new(0),
        last_notice_at: AtomicI64::new(0),
        running: AtomicBool::new(true),
        error: Mutex::new(None),
        stop,
    });
    registry
        .sessions
        .lock()
        .map_err(|_| "registry de preview indisponível".to_string())?
        .insert(project_id, preview.clone());
    let status = preview.status();
    let websocket_url = page.websocket_url.expect("target_for exige websocket");
    tauri::async_runtime::spawn(async move {
        let result = run_screencast(app, preview.clone(), websocket_url, receiver).await;
        preview.running.store(false, Ordering::Relaxed);
        if let Err(error) = result {
            if let Ok(mut stored) = preview.error.lock() {
                *stored = Some(error);
            }
        }
    });
    Ok(status)
}

#[tauri::command]
pub fn browser_preview_frame(
    app: tauri::AppHandle,
    project_path: String,
    after_revision: Option<u64>,
) -> Result<Option<BrowserPreviewFrame>, String> {
    let project_id = crate::browser::project_id_of(&app, &project_path)?;
    let session = app
        .state::<Arc<BrowserPreviewRegistry>>()
        .get(&project_id)
        .ok_or("nenhum preview ativo para este projeto")?;
    let revision = session.revision.load(Ordering::Relaxed);
    if revision == 0 || after_revision.is_some_and(|after| revision <= after) {
        return Ok(None);
    }
    let latest = session
        .latest
        .lock()
        .map_err(|_| "frame do preview indisponível".to_string())?;
    Ok(Some(BrowserPreviewFrame {
        project_id,
        target_id: session.target_id.clone(),
        revision,
        captured_at: latest.captured_at,
        data: latest.data.clone(),
        width: latest.width,
        height: latest.height,
    }))
}

#[tauri::command]
pub fn browser_preview_stop(app: tauri::AppHandle, project_path: String) -> Result<(), String> {
    let project_id = crate::browser::project_id_of(&app, &project_path)?;
    app.state::<Arc<BrowserPreviewRegistry>>()
        .stop_project(&project_id);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum BrowserInputAction {
    Click {
        x: f64,
        y: f64,
    },
    Scroll {
        x: f64,
        y: f64,
        delta_x: f64,
        delta_y: f64,
    },
    Text {
        text: String,
    },
    Key {
        key: String,
        code: String,
    },
    History {
        direction: String,
    },
    Navigate {
        url: String,
    },
}

fn finite(value: f64) -> Result<f64, String> {
    if value.is_finite() && (-100_000.0..=100_000.0).contains(&value) {
        Ok(value)
    } else {
        Err("coordenada de input inválida".into())
    }
}

/// O que a pessoa digita na barra do navegador raramente tem esquema
/// ("www.google.com.br"). Sem host plausível não se inventa endereço: fica o
/// erro, que é honesto ("busca na barra" seria outra decisão, e não é esta).
fn com_esquema(raw: &str) -> String {
    let texto = raw.trim();
    if texto.is_empty() || texto.contains("://") || texto.starts_with("about:") {
        return texto.to_string();
    }
    let host = texto.split(['/', '?', '#']).next().unwrap_or(texto);
    let host = host.split('@').next_back().unwrap_or(host);
    let so_host = host.split(':').next().unwrap_or(host);
    let parece_host = so_host == "localhost"
        || (so_host.contains('.')
            && !so_host.starts_with('.')
            && !so_host.ends_with('.')
            && so_host
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_')));
    if !parece_host {
        return texto.to_string();
    }
    // Na máquina o servidor é http: pedir https em localhost só daria erro de
    // certificado. Fora dela, https.
    let local = so_host == "localhost"
        || so_host == "127.0.0.1"
        || so_host.ends_with(".local")
        || so_host.ends_with(".localhost");
    format!("{}://{texto}", if local { "http" } else { "https" })
}

/// A política do que a PESSOA digita na barra. Não é a política do navegador:
/// o agente fala CDP direto e a única régua dele é a lease do piloto
/// (ADR-131). Chamava-se `validate_navigation` e enganava (ADR-224).
///
/// `javascript:` fica fora (injeção de script pela URL, sem valor de
/// produto). `file://` entra quando o arquivo é do PROJETO: é assim que um mock
/// em `docs/mocks/` abre no navegador da Frota sem servidor HTTP. Até
/// 21/09/2026 era recusado junto com o `javascript:`, sem decisão escrita.
pub(crate) fn politica_da_barra(raw: &str, raiz_do_projeto: &Path) -> Result<String, String> {
    if raw == "about:blank" {
        return Ok(raw.into());
    }
    let raw = raw.trim();
    // Caminho do projeto digitado cru (`docs/mocks/x.html`) vira file://.
    let candidato = if raw.starts_with("file://") {
        raw.to_string()
    } else if !raw.contains("://") && Path::new(raw).extension().is_some_and(|e| e.eq_ignore_ascii_case("html") || e.eq_ignore_ascii_case("htm")) && raiz_do_projeto.join(raw).is_file() {
        let arquivo = raiz_do_projeto.join(raw);
        let arquivo = arquivo.canonicalize().unwrap_or(arquivo);
        url::Url::from_file_path(arquivo).map(|u| u.to_string()).unwrap_or_else(|_| raw.to_string())
    } else {
        com_esquema(raw)
    };
    let parsed = url::Url::parse(&candidato)
        .map_err(|_| "digite um endereço, como exemplo.com ou https://exemplo.com".to_string())?;
    if parsed.scheme() == "file" {
        return match caminho_no_projeto(&parsed, raiz_do_projeto) {
            Some(_) => Ok(parsed.to_string()),
            None => Err("arquivo local só abre quando está dentro deste projeto".into()),
        };
    }
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("a navegação aceita http/https sem credenciais na URL, ou um arquivo deste projeto".into());
    }
    Ok(parsed.to_string())
}

pub(crate) async fn send_cdp(websocket_url: &str, commands: Vec<Value>) -> Result<(), String> {
    timeout(CDP_TIMEOUT, async {
        let (mut socket, _) = tokio_tungstenite::connect_async(websocket_url)
            .await
            .map_err(|error| format!("não consegui pilotar a página: {error}"))?;
        for command in commands {
            let id = command.get("id").and_then(Value::as_u64).unwrap_or(0);
            socket
                .send(Message::Text(command.to_string().into()))
                .await
                .map_err(|error| format!("input não foi enviado: {error}"))?;
            loop {
                let message = socket
                    .next()
                    .await
                    .ok_or("a página encerrou o canal de input")?
                    .map_err(|error| format!("input interrompido: {error}"))?;
                let Message::Text(text) = message else {
                    continue;
                };
                let Ok(value) = serde_json::from_str::<Value>(&text) else {
                    continue;
                };
                if value.get("id").and_then(Value::as_u64) != Some(id) {
                    continue;
                }
                if let Some(error) = value.get("error") {
                    return Err(format!("o navegador recusou o input: {error}"));
                }
                break;
            }
        }
        Ok(())
    })
    .await
    .map_err(|_| "o input excedeu o tempo limite".to_string())?
}

async fn send_history(websocket_url: &str, direction: &str) -> Result<(), String> {
    let delta: i64 = match direction {
        "back" => -1,
        "forward" => 1,
        _ => return Err("direção do histórico inválida".into()),
    };
    timeout(CDP_TIMEOUT, async {
        let (mut socket, _) = tokio_tungstenite::connect_async(websocket_url)
            .await
            .map_err(|error| format!("não consegui pilotar a página: {error}"))?;
        socket.send(Message::Text(json!({"id": 1, "method": "Page.getNavigationHistory"}).to_string().into()))
            .await
            .map_err(|error| format!("histórico não foi consultado: {error}"))?;
        let response = loop {
            let message = socket.next().await.ok_or("a página encerrou o canal de histórico")?
                .map_err(|error| format!("histórico interrompido: {error}"))?;
            let Message::Text(text) = message else { continue; };
            let Ok(value) = serde_json::from_str::<Value>(&text) else { continue; };
            if value.get("id").and_then(Value::as_u64) == Some(1) { break value; }
        };
        let result = response.get("result").ok_or("o navegador não devolveu o histórico")?;
        let current = result.get("currentIndex").and_then(Value::as_i64).ok_or("posição do histórico ausente")?;
        let entries = result.get("entries").and_then(Value::as_array).ok_or("histórico ausente")?;
        let next = current + delta;
        if next < 0 || next >= entries.len() as i64 { return Ok(()); }
        let entry_id = entries[next as usize].get("id").and_then(Value::as_i64).ok_or("entrada do histórico inválida")?;
        socket.send(Message::Text(json!({
            "id": 2, "method": "Page.navigateToHistoryEntry", "params": {"entryId": entry_id}
        }).to_string().into())).await.map_err(|error| format!("navegação no histórico falhou: {error}"))?;
        Ok(())
    }).await.map_err(|_| "o histórico excedeu o tempo limite".to_string())?
}

/// Os comandos CDP de uma ação de input, sem o transporte. Compartilhado pela
/// barra humana e pelo `frota-browser` (ADR-224): um vocabulário de input só.
/// `Navigate` passa pela `politica_da_barra` com a raiz do projeto.
pub(crate) fn comandos_de_input(action: BrowserInputAction, raiz_do_projeto: &Path) -> Result<Vec<Value>, String> {
    Ok(match action {
        BrowserInputAction::Click { x, y } => {
            let (x, y) = (finite(x)?, finite(y)?);
            vec![
                json!({"id": 1, "method": "Input.dispatchMouseEvent", "params": {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1}}),
                json!({"id": 2, "method": "Input.dispatchMouseEvent", "params": {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1}}),
            ]
        }
        BrowserInputAction::Scroll {
            x,
            y,
            delta_x,
            delta_y,
        } => vec![json!({
            "id": 1, "method": "Input.dispatchMouseEvent", "params": {
                "type": "mouseWheel", "x": finite(x)?, "y": finite(y)?,
                "deltaX": finite(delta_x)?, "deltaY": finite(delta_y)?
            }
        })],
        BrowserInputAction::Text { text } => {
            if text.chars().count() > MAX_TEXT_CHARS {
                return Err("texto grande demais para um único input".into());
            }
            vec![json!({"id": 1, "method": "Input.insertText", "params": {"text": text}})]
        }
        BrowserInputAction::Key { key, code } => {
            if key.chars().count() > 40 || code.chars().count() > 40 {
                return Err("tecla inválida".into());
            }
            vec![
                json!({"id": 1, "method": "Input.dispatchKeyEvent", "params": {"type": "keyDown", "key": key, "code": code}}),
                json!({"id": 2, "method": "Input.dispatchKeyEvent", "params": {"type": "keyUp", "key": key, "code": code}}),
            ]
        }
        BrowserInputAction::History { .. } => unreachable!(),
        BrowserInputAction::Navigate { url } => vec![json!({
            "id": 1, "method": "Page.navigate", "params": {"url": politica_da_barra(&url, raiz_do_projeto)?}
        })],
    })
}

/// Manda comandos CDP à página. Nome de quem pilota, não do transporte.
pub(crate) async fn pilotar(websocket_url: &str, commands: Vec<Value>) -> Result<(), String> {
    send_cdp(websocket_url, commands).await
}

/// `Runtime.evaluate` com retorno por valor: o que o `frota-browser` usa para
/// ler a página (url, título, texto visível).
pub(crate) async fn avaliar(websocket_url: &str, expression: &str) -> Result<Value, String> {
    timeout(CDP_TIMEOUT, async {
        let (mut socket, _) = tokio_tungstenite::connect_async(websocket_url)
            .await
            .map_err(|error| format!("não consegui ler a página: {error}"))?;
        let pedido = json!({
            "id": 1, "method": "Runtime.evaluate",
            "params": { "expression": expression, "returnByValue": true }
        });
        socket
            .send(Message::Text(pedido.to_string().into()))
            .await
            .map_err(|error| format!("leitura não foi pedida: {error}"))?;
        loop {
            let message = socket
                .next()
                .await
                .ok_or("a página encerrou o canal de leitura")?
                .map_err(|error| format!("leitura interrompida: {error}"))?;
            let Message::Text(text) = message else { continue };
            let Ok(value) = serde_json::from_str::<Value>(&text) else { continue };
            if value.get("id").and_then(Value::as_u64) != Some(1) {
                continue;
            }
            if let Some(error) = value.get("error") {
                return Err(format!("o navegador recusou a leitura: {error}"));
            }
            return Ok(value.pointer("/result/result/value").cloned().unwrap_or(Value::Null));
        }
    })
    .await
    .map_err(|_| "a leitura da página excedeu o tempo limite".to_string())?
}

/// As abas do navegador do projeto (páginas com canal), na ordem do Chromium:
/// a aberta por último vem primeiro.
pub(crate) async fn abas_do_projeto(app: &tauri::AppHandle, project_path: &str) -> Result<Vec<RawPage>, String> {
    let (_, session) = project_session(app, project_path).await?;
    Ok(raw_pages(&session.endpoint)
        .await?
        .into_iter()
        .filter(|page| page.kind == "page" && page.websocket_url.is_some())
        .collect())
}

/// Endpoints HTTP do Chromium para abas. `/json/new` só aceita PUT e corta a
/// URL no primeiro `&` (testado no Chrome for Testing 151): a aba nasce em
/// branco e quem navega é o `Page.navigate`, com a política da barra.
async fn pedido_de_aba(url: String, put: bool) -> Result<String, String> {
    let cliente = reqwest::Client::new();
    let pedido = if put { cliente.put(url) } else { cliente.get(url) };
    let resposta = timeout(CDP_TIMEOUT, pedido.send())
        .await
        .map_err(|_| "o navegador não respondeu a tempo".to_string())?
        .map_err(|error| format!("não consegui falar com o navegador: {error}"))?;
    if !resposta.status().is_success() {
        return Err(format!("o navegador recusou: {}", resposta.status()));
    }
    resposta.text().await.map_err(|error| error.to_string())
}

pub(crate) async fn nova_aba(app: &tauri::AppHandle, project_path: &str) -> Result<RawPage, String> {
    let (_, session) = project_session(app, project_path).await?;
    let corpo = pedido_de_aba(format!("{}/json/new?about:blank", session.endpoint), true).await?;
    serde_json::from_str(&corpo).map_err(|error| format!("aba nova ilegível: {error}"))
}

pub(crate) async fn ativar_aba(app: &tauri::AppHandle, project_path: &str, id: &str) -> Result<(), String> {
    let (_, session) = project_session(app, project_path).await?;
    pedido_de_aba(format!("{}/json/activate/{id}", session.endpoint), false).await.map(|_| ())
}

pub(crate) async fn fechar_aba(app: &tauri::AppHandle, project_path: &str, id: &str) -> Result<(), String> {
    let (_, session) = project_session(app, project_path).await?;
    pedido_de_aba(format!("{}/json/close/{id}", session.endpoint), false).await.map(|_| ())
}

/// A página ativa do projeto (a primeira aba do tipo `page` com canal).
pub(crate) async fn pagina_ativa(app: &tauri::AppHandle, project_path: &str) -> Result<RawPage, String> {
    let (_, session) = project_session(app, project_path).await?;
    raw_pages(&session.endpoint)
        .await?
        .into_iter()
        .find(|page| page.kind == "page" && page.websocket_url.is_some())
        .ok_or_else(|| "o navegador está ligado mas não tem nenhuma página aberta".to_string())
}

#[tauri::command]
pub async fn browser_input(
    app: tauri::AppHandle,
    project_path: String,
    target_id: String,
    token: String,
    action: BrowserInputAction,
) -> Result<(), String> {
    let (project_id, page) = target_for(&app, &project_path, &target_id).await?;
    app.state::<Arc<crate::experience_broker::ExperienceBroker>>()
        .validate_human(&project_id, &token)?;
    let websocket_url = page
        .websocket_url
        .as_deref()
        .expect("target_for exige websocket");
    if let BrowserInputAction::History { direction } = &action {
        return send_history(websocket_url, direction).await;
    }
    let commands = comandos_de_input(action, Path::new(&project_path))?;
    send_cdp(websocket_url, commands).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn public_page_teste(page: RawPage) -> BrowserPage {
        public_page(page, Path::new("/tmp"))
    }

    #[test]
    fn url_de_exibicao_remove_credenciais_query_e_fragmento() {
        assert_eq!(
            sanitize_page_url("https://user:secret@example.com/path?token=abc#fim"),
            "https://example.com/path"
        );
        assert_eq!(
            sanitize_page_url("file:///Users/alguem/segredo"),
            "file://…"
        );
        assert_eq!(sanitize_page_url("data:text/html,segredo"), "data:…");
        assert_eq!(sanitize_page_url("não é url"), "Endereço indisponível");
    }

    #[test]
    fn pagina_publica_nunca_entrega_a_url_bruta() {
        let page = public_page_teste(RawPage {
            id: "page-1".into(),
            title: "Conta".into(),
            url: "https://user:secret@example.com/path?token=abc#fim".into(),
            kind: "page".into(),
            websocket_url: Some("ws://127.0.0.1/devtools/page/1".into()),
        });
        assert_eq!(page.url, "https://example.com/path");
        assert_eq!(page.display_url, page.url);
        assert!(!page.url.contains("secret"));
        assert!(!page.url.contains("token"));
    }

    #[test]
    fn eventos_de_preview_sao_limitados_sem_perder_o_frame_mais_novo() {
        assert!(should_notify_preview(0, 1_000));
        assert!(!should_notify_preview(1_000, 1_099));
        assert!(should_notify_preview(1_000, 1_100));
    }

    #[test]
    fn a_barra_humana_aceita_web_e_recusa_esquema_perigoso() {
        let raiz = std::env::temp_dir();
        let v = |raw: &str| politica_da_barra(raw, &raiz);
        // Endereço digitado sem esquema (o caso real da barra) vira https://.
        assert_eq!(v("www.google.com.br").as_deref(), Ok("https://www.google.com.br/"));
        assert_eq!(v(" exemplo.com/busca?q=1 ").as_deref(), Ok("https://exemplo.com/busca?q=1"));
        // Na própria máquina o servidor é http (https só daria erro de certificado).
        assert_eq!(v("localhost:3981/pedidos").as_deref(), Ok("http://localhost:3981/pedidos"));
        assert_eq!(v("127.0.0.1:5173").as_deref(), Ok("http://127.0.0.1:5173/"));
        assert_eq!(com_esquema("http://interno/app"), "http://interno/app");
        // Texto que não é endereço continua erro: a barra não vira busca.
        assert!(v("como fazer bolo").is_err());
        assert!(v("javascript:alert(1)").is_err());
        assert!(v("https://example.com").is_ok());
    }

    /// ADR-224: mock em `docs/mocks/` abre pelo caminho; arquivo fora do
    /// projeto não. O caso real: `docs/mocks/aba-conversa.html`.
    #[test]
    fn a_barra_humana_abre_arquivo_do_projeto_e_so_dele() {
        let raiz = std::env::temp_dir().join(format!("frota-barra-{}", std::process::id()));
        std::fs::create_dir_all(raiz.join("docs/mocks")).unwrap();
        let mock = raiz.join("docs/mocks/aba-conversa.html");
        std::fs::write(&mock, "<!doctype html>").unwrap();
        let esperado = url::Url::from_file_path(mock.canonicalize().unwrap()).unwrap().to_string();
        // Caminho relativo cru, como a pessoa digita.
        assert_eq!(politica_da_barra("docs/mocks/aba-conversa.html", &raiz).as_deref(), Ok(esperado.as_str()));
        // file:// absoluto do projeto.
        assert!(politica_da_barra(&esperado, &raiz).is_ok());
        // Fora do projeto: recusado, com o motivo.
        let fora = politica_da_barra("file:///etc/passwd", &raiz).unwrap_err();
        assert!(fora.contains("dentro deste projeto"), "{fora}");
        // Caminho que não existe não vira file:// por mágica.
        assert!(politica_da_barra("docs/mocks/nao-existe.html", &raiz).is_err());
        // No inventário público o arquivo do projeto aparece RELATIVO; o de fora, não.
        assert_eq!(sanitize_page_url_no_projeto(&esperado, Some(&raiz)), "docs/mocks/aba-conversa.html");
        assert_eq!(sanitize_page_url_no_projeto("file:///etc/passwd", Some(&raiz)), "file://…");
        let _ = std::fs::remove_dir_all(&raiz);
    }
}
