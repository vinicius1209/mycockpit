//! Companion Web (onda 2): servidor HTTP+WS embutido p/ o celular na LAN.
//!
//! Escala o padrão da tray: o front publica um snapshot opaco
//! (`set_companion_snapshot`) e recebe ações de volta via evento
//! `companion://action` (whitelist FECHADA — nenhum comando arbitrário).
//! O Rust continua camada fina: não interpreta o snapshot, só o transporta.
//!
//! Segurança: só sobe com opt-in (`companion_start`); bind 0.0.0.0:14200;
//! token aleatório persistido (app_data_dir/companion-token) exigido em TODA
//! rota /api (Authorization: Bearer ou ?token= p/ o WS); rate-limit por IP;
//! respostas nunca carregam paths absolutos do disco; logs nunca têm o token.

use crate::attachments::{self, Attachment};
use axum::{
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, DefaultBodyLimit, Multipart, Path as AxPath, Request, State as AxState,
        WebSocketUpgrade,
    },
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{broadcast, oneshot};

const PORT: u16 = 14200;
const TOKEN_FILE: &str = "companion-token";
/// Rate-limit por IP: 30 requisições por janela de 10s (janela fixa, simples).
const RATE_MAX: u32 = 30;
const RATE_WINDOW: Duration = Duration::from_secs(10);
const WS_PING_EVERY: Duration = Duration::from_secs(15);
/// Corpo máximo: 10MB de anexo + folga de encoding multipart.
const BODY_CAP: usize = 11 * 1024 * 1024;
/// Sentinela interna no broadcast: manda cada loop de WS fechar (companion_stop).
/// Nunca chega ao cliente como texto (o loop intercepta antes).
const STOP_SENTINEL: &str = "__companion_stop__";
/// Pseudo-conversa p/ uploads sem convId (ex.: send_message a uma mesa cuja
/// conversa ainda nem existe). 32-hex → nome de pasta válido p/ o GC de anexos;
/// como não existe no DB, o orphan-sweep do boot recolhe naturalmente.
const COMPANION_CONV: &str = "cc0c0badcafe0000000000000000c0de";

// ---------------- estado (gerenciado pelo Tauri) ----------------

/// Estado do companion. Snapshot é `Value` OPACO: o front define o shape.
/// O broadcast::Sender é a "lista de sockets": cada conexão WS assina um
/// Receiver; mandar aqui alcança todos os celulares conectados.
pub struct CompanionState {
    running: AtomicBool,
    token: Mutex<Option<String>>,
    snapshot: Mutex<Value>,
    /// attachmentId → Attachment dos uploads do celular. O id viaja nas ações
    /// (send_message/answer_gate); o emit resolve id→Attachment pro front.
    uploads: Mutex<HashMap<String, Attachment>>,
    tx: broadcast::Sender<String>,
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
}

impl Default for CompanionState {
    fn default() -> Self {
        Self {
            running: AtomicBool::new(false),
            token: Mutex::new(None),
            snapshot: Mutex::new(Value::Null),
            uploads: Mutex::new(HashMap::new()),
            tx: broadcast::channel(64).0,
            shutdown: Mutex::new(None),
        }
    }
}

/// Estado dos handlers axum. O CompanionState mora no Tauri (via `app`), assim
/// comandos e rotas leem a MESMA verdade sem duplicação.
#[derive(Clone)]
struct Ctx {
    app: AppHandle,
}

/// Estado do guardião das rotas /api (token + rate-limit). Separado do Ctx de
/// propósito: não depende de AppHandle, então o middleware é testável isolado
/// (o token é imutável enquanto o servidor roda — baked no companion_start).
#[derive(Clone)]
struct Guard {
    token: String,
    rate: Arc<Mutex<HashMap<IpAddr, (Instant, u32)>>>,
}

impl Guard {
    fn new(token: String) -> Self {
        Self {
            token,
            rate: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Janela fixa por IP; falha de lock NUNCA bloqueia o usuário legítimo.
    fn allow(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let Ok(mut m) = self.rate.lock() else {
            return true;
        };
        if m.len() > 1024 {
            m.retain(|_, (t, _)| now.duration_since(*t) <= RATE_WINDOW);
        }
        let e = m.entry(ip).or_insert((now, 0u32));
        if now.duration_since(e.0) > RATE_WINDOW {
            *e = (now, 0);
        }
        e.1 += 1;
        e.1 <= RATE_MAX
    }
}

// ---------------- helpers puros ----------------

/// IP LAN local via truque do UDP connect (não envia pacote nenhum).
fn lan_ip() -> String {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("8.8.8.8:80")?;
            s.local_addr()
        })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".into())
}

fn url_lan() -> String {
    format!("http://{}:{PORT}", lan_ip())
}

fn hex_random(n_bytes: usize) -> String {
    use rand::Rng;
    let mut b = vec![0u8; n_bytes];
    rand::rng().fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Comparação em tempo constante (não vaza prefixo do token por timing).
fn token_eq(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

fn bearer(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(|s| s.trim().to_string())
}

/// `?token=` da query (o WebSocket do browser não manda header Authorization).
/// Token é hex puro → sem percent-decoding.
fn query_token(query: Option<&str>) -> Option<String> {
    query?
        .split('&')
        .find_map(|p| p.strip_prefix("token="))
        .map(str::to_string)
}

/// Carrega o token persistido ou cria um novo (64 hex, arquivo 0600).
fn load_or_create_token(app: &AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("sem app_data_dir: {e}"))?;
    let path = dir.join(TOKEN_FILE);
    if let Ok(t) = std::fs::read_to_string(&path) {
        let t = t.trim().to_string();
        if t.len() >= 32 && t.chars().all(|c| c.is_ascii_hexdigit()) {
            return Ok(t);
        }
    }
    let token = hex_random(32);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(&path, &token).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(token)
}

// ---------------- comandos Tauri ----------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionInfo {
    pub running: bool,
    pub url_lan: Option<String>,
    pub token: Option<String>,
    /// Nº de dispositivos (sockets WS) conectados agora — cada conexão viva
    /// segura um Receiver do broadcast, então receiver_count é a verdade.
    pub connected_count: usize,
}

/// Sobe o servidor (idempotente: já rodando → devolve a info atual).
#[tauri::command]
pub async fn companion_start(
    app: AppHandle,
    state: State<'_, CompanionState>,
) -> Result<CompanionInfo, String> {
    let token = load_or_create_token(&app)?;
    if let Ok(mut g) = state.token.lock() {
        *g = Some(token.clone());
    }
    // swap = check-and-set atômico: segunda chamada concorrente vê true e sai.
    if state.running.swap(true, Ordering::SeqCst) {
        return Ok(CompanionInfo {
            running: true,
            url_lan: Some(url_lan()),
            token: Some(token),
            connected_count: state.tx.receiver_count(),
        });
    }

    let listener = match tokio::net::TcpListener::bind(("0.0.0.0", PORT)).await {
        Ok(l) => l,
        Err(e) => {
            state.running.store(false, Ordering::SeqCst);
            return Err(format!("porta {PORT} indisponível: {e}"));
        }
    };
    let (stop_tx, stop_rx) = oneshot::channel::<()>();
    if let Ok(mut g) = state.shutdown.lock() {
        *g = Some(stop_tx);
    }

    let ctx = Ctx { app: app.clone() };
    let router = build_router(ctx, Guard::new(token.clone()));
    tauri::async_runtime::spawn(async move {
        let res = axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            let _ = stop_rx.await;
        })
        .await;
        if let Err(e) = res {
            log::warn!("companion: servidor caiu: {e}");
        }
        app.state::<CompanionState>()
            .running
            .store(false, Ordering::SeqCst);
        log::info!("companion: servidor parado");
    });
    log::info!("companion: servindo em 0.0.0.0:{PORT}");
    Ok(CompanionInfo {
        running: true,
        url_lan: Some(url_lan()),
        token: Some(token),
        connected_count: 0,
    })
}

/// Para o servidor: fecha os WS abertos (sentinela) + graceful shutdown do axum.
#[tauri::command]
pub async fn companion_stop(state: State<'_, CompanionState>) -> Result<(), String> {
    let _ = state.tx.send(STOP_SENTINEL.to_string());
    if let Ok(mut g) = state.shutdown.lock() {
        if let Some(tx) = g.take() {
            let _ = tx.send(());
        }
    }
    state.running.store(false, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn companion_status(state: State<'_, CompanionState>) -> Result<CompanionInfo, String> {
    let running = state.running.load(Ordering::SeqCst);
    let token = state.token.lock().ok().and_then(|g| g.clone());
    Ok(CompanionInfo {
        running,
        url_lan: running.then(url_lan),
        token: if running { token } else { None },
        connected_count: if running { state.tx.receiver_count() } else { 0 },
    })
}

/// Revoga o token persistido (apaga o arquivo + limpa o estado). O próximo
/// `companion_start` gera um novo. Exige o servidor PARADO — o guard de um
/// servidor vivo fica com o token antigo "baked" e continuaria aceitando-o.
#[tauri::command]
pub async fn companion_revoke_token(
    app: AppHandle,
    state: State<'_, CompanionState>,
) -> Result<(), String> {
    if state.running.load(Ordering::SeqCst) {
        return Err("pare o servidor antes de revogar o token".into());
    }
    if let Ok(mut g) = state.token.lock() {
        *g = None;
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("sem app_data_dir: {e}"))?;
    match std::fs::remove_file(dir.join(TOKEN_FILE)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Front → Rust: guarda o snapshot (opaco) e empurra a todos os WS conectados.
#[tauri::command]
pub async fn set_companion_snapshot(
    snapshot: Value,
    state: State<'_, CompanionState>,
) -> Result<(), String> {
    if let Ok(mut g) = state.snapshot.lock() {
        *g = snapshot.clone();
    }
    let _ = state
        .tx
        .send(json!({"type": "snapshot", "data": snapshot}).to_string());
    Ok(())
}

/// Front → Rust: ping "conversa mudou" (throttled no JS); o celular refetcha.
#[tauri::command]
pub async fn companion_conv_updated(
    conv_id: String,
    state: State<'_, CompanionState>,
) -> Result<(), String> {
    let _ = state
        .tx
        .send(json!({"type": "conv-updated", "convId": conv_id}).to_string());
    Ok(())
}

// ---------------- servidor axum ----------------

fn build_router(ctx: Ctx, guard_state: Guard) -> Router {
    let api = Router::new()
        .route("/state", get(get_state))
        .route("/conv/{id}", get(get_conv))
        .route("/ws", get(ws_upgrade))
        .route("/action", post(post_action))
        .route("/attachment", post(post_attachment))
        .layer(middleware::from_fn_with_state(guard_state, guard))
        .layer(DefaultBodyLimit::max(BODY_CAP));
    Router::new()
        .route("/", get(index_page))
        .nest("/api", api)
        .with_state(ctx)
}

/// Página do Companion embutida no binário (onda 3): única, auto-contida
/// (vanilla JS + CSS inline com os tokens do app) — zero build, zero CDN.
const COMPANION_PAGE: &str = include_str!("../companion/index.html");

/// Guardião de TODA rota /api: rate-limit por IP + token. Bearer vale em
/// qualquer rota; `?token=` SÓ no /api/ws (o WebSocket do browser não manda
/// header Authorization — nas demais rotas, token em URL iria parar em
/// histórico/logs de proxy sem necessidade). Sem token válido ⇒ 401 seco
/// (sem corpo, sem dica). Nunca loga o token.
async fn guard(
    AxState(g): AxState<Guard>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Response {
    if !g.allow(addr.ip()) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    // O guard roda DENTRO do nest("/api", …): o axum entrega o path DESPIDO do
    // prefixo ("/ws"). Aceita as duas formas — um refactor pra rota plana não
    // pode reabrir o 401 silencioso do WS (bug real: celular carregava HTTP
    // mas o WS nunca conectava).
    let p = req.uri().path();
    let is_ws = p == "/ws" || p == "/api/ws";
    let presented = bearer(req.headers()).or_else(|| {
        if is_ws {
            query_token(req.uri().query())
        } else {
            None
        }
    });
    match presented {
        Some(t) if token_eq(&t, &g.token) => next.run(req).await,
        _ => StatusCode::UNAUTHORIZED.into_response(),
    }
}

/// CSP da página (defesa-em-profundidade contra XSS de conteúdo de LLM):
/// nenhum host externo; script/style só inline (a página é auto-contida);
/// connect só same-origin + WS (o `ws:` explícito cobre browsers móveis que
/// ainda não casam WebSocket com 'self'); img blob:/data: p/ thumbs de anexo.
const PAGE_CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; \
    style-src 'unsafe-inline'; img-src 'self' blob: data:; \
    connect-src 'self' ws: wss:; base-uri 'none'; form-action 'none'; \
    frame-ancestors 'none'";

/// GET / — serve a página do Companion (embutida via `COMPANION_PAGE`) com
/// CSP + nosniff + no-referrer (o token do pareamento vive no fragment).
async fn index_page() -> Response {
    (
        [
            (header::CONTENT_SECURITY_POLICY, PAGE_CSP),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            (header::REFERRER_POLICY, "no-referrer"),
        ],
        Html(COMPANION_PAGE),
    )
        .into_response()
}

/// GET /api/state — snapshot corrente (o front define o shape).
async fn get_state(AxState(ctx): AxState<Ctx>) -> Response {
    let snap = ctx
        .app
        .state::<CompanionState>()
        .snapshot
        .lock()
        .map(|g| g.clone())
        .unwrap_or(Value::Null);
    Json(snap).into_response()
}

/// GET /api/conv/{id} — histórico da conversa direto do SQLite (READ-ONLY).
/// Devolve SÓ id/title/items/agent — nada de paths de disco.
async fn get_conv(AxState(ctx): AxState<Ctx>, AxPath(id): AxPath<String>) -> Response {
    // mesmo saneamento dos anexos: id de conversa só pode ser hex/uuid.
    let id: String = id
        .chars()
        .filter(|c| c.is_ascii_hexdigit() || *c == '-')
        .collect();
    let db = match ctx.app.path().app_data_dir() {
        Ok(d) => d.join("mycockpit.db"),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    // rusqlite é sync → spawn_blocking pra não segurar o executor do axum.
    match tokio::task::spawn_blocking(move || read_conv(&db, &id)).await {
        Ok(Ok(Some(v))) => Json(v).into_response(),
        Ok(Ok(None)) => StatusCode::NOT_FOUND.into_response(),
        Ok(Err(e)) => {
            log::warn!("companion: leitura de conversa falhou: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

fn read_conv(db: &Path, id: &str) -> Result<Option<Value>, String> {
    let conn = rusqlite::Connection::open_with_flags(
        db,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| e.to_string())?;
    let row = conn.query_row(
        "SELECT id, title, items, agent FROM conversations WHERE id = ?1",
        [id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        },
    );
    match row {
        Ok((id, title, items, agent)) => {
            // items é JSON serializado pelo front; corrompido → lista vazia.
            let items: Value = serde_json::from_str(&items).unwrap_or_else(|_| json!([]));
            Ok(Some(
                json!({"id": id, "title": title, "items": items, "agent": agent}),
            ))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// GET /api/ws — push de snapshot/conv-updated + heartbeat ping 15s.
/// Token já validado pelo guard (via ?token=).
async fn ws_upgrade(AxState(ctx): AxState<Ctx>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |sock| ws_loop(ctx, sock))
}

async fn ws_loop(ctx: Ctx, sock: WebSocket) {
    let (mut out, mut inp) = sock.split();
    let mut rx = {
        let st = ctx.app.state::<CompanionState>();
        // snapshot de boas-vindas: o celular pinta a tela sem esperar mudança.
        let hello = st
            .snapshot
            .lock()
            .map(|g| g.clone())
            .unwrap_or(Value::Null);
        if out
            .send(Message::Text(
                json!({"type": "snapshot", "data": hello}).to_string().into(),
            ))
            .await
            .is_err()
        {
            return;
        }
        st.tx.subscribe()
    };
    let mut ping = tokio::time::interval(WS_PING_EVERY);
    ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    ping.tick().await; // o primeiro tick resolve na hora; consome antes do loop
    loop {
        tokio::select! {
            m = rx.recv() => match m {
                Ok(txt) if txt == STOP_SENTINEL => {
                    let _ = out.send(Message::Close(None)).await;
                    break;
                }
                Ok(txt) => {
                    if out.send(Message::Text(txt.into())).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            },
            _ = ping.tick() => {
                if out.send(Message::Ping(Vec::new().into())).await.is_err() {
                    break;
                }
            }
            m = inp.next() => match m {
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                _ => {} // Pong/Text do cliente: ignorados (canal é push-only)
            },
        }
    }
}

/// POST /api/action — whitelist FECHADA; validou → emit companion://action → 202.
/// O payload emitido é RECONSTRUÍDO só com os campos conhecidos (campos extras
/// do celular nunca chegam ao front) e ganha `attachments` (id→Attachment
/// resolvido do cache de uploads) pro front não precisar de roundtrip.
async fn post_action(AxState(ctx): AxState<Ctx>, Json(body): Json<Value>) -> Response {
    let uploads = ctx
        .app
        .state::<CompanionState>()
        .uploads
        .lock()
        .map(|m| m.clone())
        .unwrap_or_default();
    match sanitize_action(&uploads, &body) {
        Ok(payload) => {
            // uploads consumidos pela ação saem do cache (metadados não crescem
            // sem limite em runtime; os blobs órfãos seguem no GC do boot)
            if let Some(ids) = payload["attachmentIds"].as_array() {
                if let Ok(mut m) = ctx.app.state::<CompanionState>().uploads.lock() {
                    for id in ids.iter().filter_map(Value::as_str) {
                        m.remove(id);
                    }
                }
            }
            let kind = payload["kind"].as_str().unwrap_or("?").to_string();
            let _ = ctx.app.emit("companion://action", payload);
            log::info!("companion: ação {kind} aceita");
            StatusCode::ACCEPTED.into_response()
        }
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

/// Whitelist FECHADA + reconstrução do payload. Puro sobre (uploads, corpo) —
/// sem AppHandle de propósito, p/ os unit tests baterem direto aqui.
fn sanitize_action(uploads: &HashMap<String, Attachment>, v: &Value) -> Result<Value, String> {
    let kind = v
        .get("kind")
        .and_then(Value::as_str)
        .ok_or("kind ausente")?;
    let req_str = |k: &str| -> Result<String, String> {
        v.get(k)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .ok_or(format!("{k} ausente"))
    };
    let attachment_ids = || -> Result<Vec<String>, String> {
        let ids: Vec<String> = v
            .get("attachmentIds")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        if ids.len() > 16 {
            return Err("attachmentIds demais (máx 16)".into());
        }
        Ok(ids)
    };
    let out = match kind {
        "answer_gate" => {
            let conv = req_str("convId")?;
            let answers = v.get("answers").cloned().ok_or("answers ausente")?;
            // gate real tem poucas perguntas — cap barra payload adversarial
            // (o body de 11MB sozinho não limita a CONTAGEM de itens)
            match answers.as_array() {
                Some(a) if a.len() <= 16 => {}
                Some(_) => return Err("answers demais (máx 16)".into()),
                None => return Err("answers deve ser lista".into()),
            }
            let ids = attachment_ids()?;
            let atts = resolve_uploads(uploads, &ids)?;
            json!({"kind": "answer_gate", "convId": conv, "answers": answers,
                   "attachmentIds": ids, "attachments": atts})
        }
        "answer_interaction" => {
            let id = req_str("id")?;
            let answer = v.get("answer").cloned().ok_or("answer ausente")?;
            json!({"kind": "answer_interaction", "id": id, "answer": answer})
        }
        "stop_mission" => json!({"kind": "stop_mission", "convId": req_str("convId")?}),
        "stop_turn" => json!({"kind": "stop_turn", "convId": req_str("convId")?}),
        "send_message" => {
            let project = req_str("projectId")?;
            let agent = req_str("agent")?;
            let text = req_str("text")?;
            if text.len() > 64 * 1024 {
                return Err("text longo demais".into());
            }
            let ids = attachment_ids()?;
            let atts = resolve_uploads(uploads, &ids)?;
            json!({"kind": "send_message", "projectId": project, "agent": agent,
                   "text": text, "attachmentIds": ids, "attachments": atts})
        }
        other => return Err(format!("ação desconhecida: {other}")),
    };
    Ok(out)
}

/// attachmentId → Attachment do cache de uploads. Id desconhecido = erro (a
/// ação não pode viajar apontando pra um anexo que não existe).
fn resolve_uploads(uploads: &HashMap<String, Attachment>, ids: &[String]) -> Result<Value, String> {
    let mut out = serde_json::Map::new();
    for id in ids {
        let a = uploads
            .get(id)
            .ok_or(format!("attachmentId desconhecido: {id}"))?;
        out.insert(id.clone(), serde_json::to_value(a).unwrap_or(Value::Null));
    }
    Ok(Value::Object(out))
}

/// POST /api/attachment — multipart (campo `file` + `convId` opcional), cap
/// 10MB, só imagem/PDF (allowlist do save_to_disk). Salva pelo MESMO núcleo
/// dos anexos do desktop e devolve só {attachmentId} (nunca o path).
async fn post_attachment(AxState(ctx): AxState<Ctx>, mut mp: Multipart) -> Response {
    let mut conv_id: Option<String> = None;
    let mut name = "anexo".to_string();
    let mut declared: Option<String> = None;
    let mut bytes: Option<Vec<u8>> = None;
    loop {
        match mp.next_field().await {
            Ok(Some(field)) => match field.name().unwrap_or("") {
                "convId" => conv_id = field.text().await.ok().filter(|s| !s.is_empty()),
                "file" => {
                    if let Some(f) = field.file_name() {
                        name = f.to_string();
                    }
                    declared = field.content_type().map(str::to_string);
                    bytes = field.bytes().await.ok().map(|b| b.to_vec());
                }
                _ => {} // campo desconhecido: dropar o field já o drena
            },
            Ok(None) => break,
            Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
        }
    }
    let Some(bytes) = bytes else {
        return (StatusCode::BAD_REQUEST, "campo file ausente").into_response();
    };
    let conv = conv_id.unwrap_or_else(|| COMPANION_CONV.to_string());
    let app = ctx.app.clone();
    let saved = tokio::task::spawn_blocking(move || {
        let active = app.state::<attachments::ActiveConvs>();
        let att = attachments::save_to_disk(&app, &conv, &name, declared, &bytes, active.inner())?;
        let id = hex_random(8);
        if let Ok(mut m) = app.state::<CompanionState>().uploads.lock() {
            m.insert(id.clone(), att);
        }
        Ok::<String, String>(id)
    })
    .await;
    match saved {
        Ok(Ok(id)) => Json(json!({"attachmentId": id})).into_response(),
        Ok(Err(e)) => (StatusCode::UNPROCESSABLE_ENTITY, e).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

// ---------------- testes (cargo test -p app_lib companion) ----------------
//
// Fumaça SEM AppHandle/GUI: guard (401/429) via router mínimo + MockConnectInfo,
// whitelist do sanitize_action e leitura SQLite de fixture. O que fica p/ a
// verificação MANUAL da onda 2 (precisa do app vivo): token persistido em disco
// (load_or_create_token), WS de ponta a ponta e upload multipart real.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::attachments::AttachmentKind;
    use axum::body::Body;
    use axum::extract::connect_info::MockConnectInfo;
    use axum::http;
    use tower::ServiceExt;

    const TOK: &str = "aabbccddeeff00112233445566778899";

    // ── helpers puros ──

    #[test]
    fn token_eq_compara_sem_vazar() {
        assert!(token_eq(TOK, TOK));
        assert!(!token_eq(TOK, "aabbccddeeff00112233445566778898"));
        assert!(!token_eq(TOK, "aabb")); // tamanho diferente
        assert!(!token_eq("", TOK));
    }

    #[test]
    fn pagina_embutida_e_autocontida() {
        // sanidade do include_str!: documento completo, com a marca, e SEM
        // dependência externa (a página promete ser auto-contida na LAN).
        assert!(COMPANION_PAGE.starts_with("<!doctype html>"));
        assert!(COMPANION_PAGE.contains("FROTA"));
        assert!(COMPANION_PAGE.contains("escapeHtml") || COMPANION_PAGE.contains("function esc("));
        assert!(!COMPANION_PAGE.contains("src=\"http"));
        assert!(!COMPANION_PAGE.contains("href=\"http"));
    }

    #[tokio::test]
    async fn index_serve_pagina_com_csp() {
        let resp = index_page().await;
        let csp = resp
            .headers()
            .get(header::CONTENT_SECURITY_POLICY)
            .expect("CSP ausente na página servida")
            .to_str()
            .unwrap();
        assert!(csp.contains("default-src 'none'"));
        assert!(!csp.contains("http://")); // nenhum host externo permitido
        assert_eq!(
            resp.headers().get(header::X_CONTENT_TYPE_OPTIONS).unwrap(),
            "nosniff"
        );
        assert_eq!(
            resp.headers().get(header::REFERRER_POLICY).unwrap(),
            "no-referrer"
        );
    }

    #[test]
    fn query_token_extrai_da_query() {
        assert_eq!(query_token(Some(&format!("token={TOK}"))), Some(TOK.into()));
        assert_eq!(query_token(Some(&format!("a=1&token={TOK}"))), Some(TOK.into()));
        assert_eq!(query_token(Some("a=1&b=2")), None);
        assert_eq!(query_token(None), None);
    }

    // ── guard: 401 sem token, 200 com token (Bearer OU ?token=), 429 no abuso ──

    fn guarded_router(g: Guard) -> Router {
        // MockConnectInfo por último = camada mais externa (roda antes do guard),
        // igual ao into_make_service_with_connect_info da produção.
        // ESPELHA a produção: rotas dentro de nest("/api") com o guard NO NEST
        // (o path chega despido do prefixo — foi exatamente o que quebrou o
        // ?token= do WS em produção com um teste plano passando).
        let api = Router::new()
            .route("/ping", get(|| async { "pong" }))
            .route("/ws", get(|| async { "ws" })) // rota-fantasma p/ testar ?token=
            .layer(middleware::from_fn_with_state(g, guard));
        Router::new()
            .nest("/api", api)
            .layer(MockConnectInfo(SocketAddr::from(([192, 168, 0, 42], 5555))))
    }

    async fn hit(r: &Router, uri: &str, auth: Option<&str>) -> StatusCode {
        let mut b = http::Request::builder().uri(uri);
        if let Some(a) = auth {
            b = b.header(header::AUTHORIZATION, a);
        }
        r.clone()
            .oneshot(b.body(Body::empty()).unwrap())
            .await
            .unwrap()
            .status()
    }

    #[tokio::test]
    async fn guard_exige_token_em_toda_rota_api() {
        let r = guarded_router(Guard::new(TOK.into()));
        assert_eq!(hit(&r, "/api/ping", None).await, StatusCode::UNAUTHORIZED);
        assert_eq!(
            hit(&r, "/api/ping", Some("Bearer nope")).await,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            hit(&r, "/api/ping?token=nope", None).await,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            hit(&r, "/api/ping", Some(&format!("Bearer {TOK}"))).await,
            StatusCode::OK
        );
        // ?token= vale SÓ no /api/ws (browser não manda header no WebSocket);
        // nas demais rotas, token em URL é 401 — não vaza pra histórico/proxy
        assert_eq!(
            hit(&r, &format!("/api/ping?token={TOK}"), None).await,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            hit(&r, &format!("/api/ws?token={TOK}"), None).await,
            StatusCode::OK
        );
        assert_eq!(
            hit(&r, "/api/ws?token=nope", None).await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn guard_rate_limit_por_ip() {
        let r = guarded_router(Guard::new(TOK.into()));
        let auth = format!("Bearer {TOK}");
        for _ in 0..RATE_MAX {
            assert_eq!(hit(&r, "/api/ping", Some(&auth)).await, StatusCode::OK);
        }
        assert_eq!(
            hit(&r, "/api/ping", Some(&auth)).await,
            StatusCode::TOO_MANY_REQUESTS
        );
    }

    // ── whitelist do POST /api/action ──

    fn uploads_with(id: &str) -> HashMap<String, Attachment> {
        HashMap::from([(
            id.to_string(),
            Attachment {
                path: format!("attachments/{COMPANION_CONV}/deadbeef.png"),
                name: "foto.png".into(),
                kind: AttachmentKind::Image,
                mime: "image/png".into(),
                bytes: 3,
            },
        )])
    }

    #[test]
    fn sanitize_rejeita_acao_desconhecida_e_campos_faltando() {
        let up = HashMap::new();
        assert!(sanitize_action(&up, &json!({"kind": "format_disk"})).is_err());
        assert!(sanitize_action(&up, &json!({"cmd": "stop_turn"})).is_err()); // sem kind
        assert!(sanitize_action(&up, &json!({"kind": "stop_mission"})).is_err()); // sem convId
        assert!(sanitize_action(&up, &json!({"kind": "answer_gate", "convId": "c1"})).is_err()); // sem answers
        assert!(
            sanitize_action(&up, &json!({"kind": "send_message", "projectId": "p1", "agent": "codex"}))
                .is_err() // sem text
        );
    }

    #[test]
    fn sanitize_reconstroi_payload_sem_campos_extras() {
        let up = HashMap::new();
        let out = sanitize_action(
            &up,
            &json!({"kind": "stop_turn", "convId": "c1", "hack": "sudo rm -rf /"}),
        )
        .unwrap();
        assert_eq!(out, json!({"kind": "stop_turn", "convId": "c1"}));
    }

    #[test]
    fn sanitize_resolve_attachment_ids_do_cache() {
        let up = uploads_with("u1");
        let out = sanitize_action(
            &up,
            &json!({"kind": "send_message", "projectId": "p1", "agent": "codex",
                    "text": "olha", "attachmentIds": ["u1"]}),
        )
        .unwrap();
        assert_eq!(out["attachments"]["u1"]["name"], "foto.png");
        assert_eq!(out["attachments"]["u1"]["kind"], "image");
        assert!(out["attachments"]["u1"]["path"]
            .as_str()
            .unwrap()
            .starts_with("attachments/"));
        // id desconhecido → erro (ação nunca viaja apontando pro nada)
        assert!(sanitize_action(
            &up,
            &json!({"kind": "send_message", "projectId": "p1", "agent": "codex",
                    "text": "olha", "attachmentIds": ["fantasma"]}),
        )
        .is_err());
    }

    #[test]
    fn sanitize_limita_texto_e_quantidade_de_anexos() {
        let up = HashMap::new();
        let longo = "x".repeat(64 * 1024 + 1);
        assert!(sanitize_action(
            &up,
            &json!({"kind": "send_message", "projectId": "p1", "agent": "codex", "text": longo}),
        )
        .is_err());
        let ids: Vec<String> = (0..17).map(|i| format!("a{i}")).collect();
        assert!(sanitize_action(
            &up,
            &json!({"kind": "answer_gate", "convId": "c1", "answers": [], "attachmentIds": ids}),
        )
        .is_err());
    }

    // ── leitura READ-ONLY do histórico (fixture SQLite) ──

    #[test]
    fn read_conv_le_fixture_sqlite() {
        let dir = std::env::temp_dir().join(format!(
            "companion-fixture-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("mycockpit-test.db");
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT, items TEXT NOT NULL, agent TEXT NOT NULL);
             INSERT INTO conversations VALUES ('abc123', 'Refatorar parser', '[{\"kind\":\"text\",\"text\":\"oi\"}]', 'claude-code');
             INSERT INTO conversations VALUES ('badbad', NULL, 'não-é-json', 'codex');",
        )
        .unwrap();
        drop(conn);

        let v = read_conv(&db, "abc123").unwrap().unwrap();
        assert_eq!(v["id"], "abc123");
        assert_eq!(v["title"], "Refatorar parser");
        assert_eq!(v["agent"], "claude-code");
        assert_eq!(v["items"][0]["text"], "oi");

        // items corrompido → lista vazia (lixo no DB nunca vira 500)
        let v = read_conv(&db, "badbad").unwrap().unwrap();
        assert_eq!(v["items"], json!([]));
        assert_eq!(v["title"], Value::Null);

        // inexistente → None (vira 404 na rota)
        assert!(read_conv(&db, "beef").unwrap().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
