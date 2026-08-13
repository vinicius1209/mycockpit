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
        ConnectInfo, DefaultBodyLimit, Extension, Multipart, Path as AxPath, Query, Request,
        State as AxState, WebSocketUpgrade,
    },
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{broadcast, oneshot};

const PORT: u16 = 14200;
/// Token ÚNICO legado (pré-C4). NUNCA mais é criado; se o arquivo existe, ele
/// segue valendo até o usuário revogar (migração honesta: o celular pareado
/// antes do v2 não quebra do nada). QR novo só emite pareamento v2.
const TOKEN_FILE: &str = "companion-token";
/// C4 — aparelhos pareados (v2): credencial PRÓPRIA por celular, arquivo 0600.
/// Decisão registrada (plano C4): fica em arquivo no app_data_dir, como o
/// token legado, e NÃO no Keychain — diferente do mcp_auth (credencial de
/// serviço EXTERNO), estes tokens são emitidos pelo próprio app pra
/// autenticar requisições de ENTRADA na LAN; o valor deles é limitado ao que
/// o companion já serve, e quem lê o app_data_dir já lê o SQLite com as
/// conversas que o token protege. O arquivo ainda é reescrito com frequência
/// (parear/revogar/visto por último) — Keychain via subprocess aqui só
/// adicionaria latência e risco de prompt sem elevar o modelo de ameaça.
const DEVICES_FILE: &str = "companion-devices.json";
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

// ---------------- pareamento v2 (C4) ----------------
//
// O QR não carrega mais credencial de longa vida: carrega um token de
// PAREAMENTO de uso único (consumido no 1º claim) e vida curta. O aparelho
// troca esse token por um `pairingId` de poll; o token DEFINITIVO só passa a
// existir DEPOIS do gesto humano no desktop ("Aceitar aparelho") — fail-closed
// de ponta a ponta: sem aceite dentro da janela, o pareamento morre.

/// Vida do token de pareamento exibido no QR (rotaciona sozinho ao expirar).
const PAIR_QR_TTL: Duration = Duration::from_secs(600);
/// Janela do ACEITE humano: claim sem decisão nesse prazo morre (fail-closed).
const PAIR_DECIDE_TTL: Duration = Duration::from_secs(120);
/// Depois de decidido, o resultado fica disponível pro poll por este prazo;
/// então o registro some (o token aprovado já vive no AuthSet/arquivo).
const PAIR_RESULT_TTL: Duration = Duration::from_secs(120);
/// Teto de claims aguardando aceite (o QR é uso único, então inundar exige
/// re-escanear um QR novo a cada claim — o teto é só cinto extra).
const PAIR_PENDING_CAP: usize = 4;
/// Persistência do "visto por último": no máx. 1 escrita de arquivo a cada 60s.
const LAST_SEEN_FLUSH_EVERY: Duration = Duration::from_secs(60);

/// Aparelho pareado (v2). `token` é a credencial — nunca sai pela lista de
/// aparelhos (o comando devolve `DevicePublic`); só vive no arquivo 0600 e no
/// AuthSet em memória.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Device {
    id: String,
    name: String,
    token: String,
    /// Epoch ms do aceite.
    paired_at: u64,
    /// Epoch ms da última requisição autenticada (None = nunca visto pós-boot).
    last_seen_at: Option<u64>,
}

/// Conjunto VIVO de credenciais aceitas pelo guard: o legado (se ainda existe)
/// + um token por aparelho. Compartilhado por Arc entre o estado e o guard —
/// revogar um aparelho vale NA HORA, sem reiniciar o servidor.
#[derive(Default)]
struct AuthSet {
    legacy: Option<String>,
    devices: Vec<Device>,
}

impl AuthSet {
    /// Token apresentado → id do principal ("legacy" ou o id do aparelho).
    /// Compara TODOS em tempo constante por candidato (não vaza por timing).
    fn match_token(&self, presented: &str) -> Option<String> {
        if let Some(t) = &self.legacy {
            if token_eq(t, presented) {
                return Some("legacy".into());
            }
        }
        self.devices
            .iter()
            .find(|d| token_eq(&d.token, presented))
            .map(|d| d.id.clone())
    }
}

/// Principal autenticado da requisição (inserido pelo guard nas extensions):
/// chave do dedupe POR APARELHO do actionId (revisão C2 §4 — um aparelho não
/// despeja os ids pendentes de outro inundando o teto).
#[derive(Clone)]
struct AuthPrincipal(String);

/// Claim aguardando o aceite humano (ou o poll do resultado).
struct PendingPair {
    /// Segredo de poll (só o aparelho que fez o claim conhece) e id do aceite.
    id: String,
    name: String,
    claimed_at: Instant,
    /// Epoch ms do claim (p/ a UI do desktop).
    requested_at_ms: u64,
    /// None = aguardando gesto humano; Some(Ok(token)) = aceito (token
    /// definitivo cunhado NO aceite); Some(Err(())) = recusado.
    decision: Option<Result<String, ()>>,
    decided_at: Option<Instant>,
}

#[derive(Default)]
struct PairingBoard {
    /// Token de pareamento corrente do QR + quando nasceu. `None` = consumido
    /// ou nunca emitido; o próximo status/start cunha outro.
    qr: Option<(String, Instant)>,
    pending: Vec<PendingPair>,
}

/// Token corrente do QR: reusa enquanto fresco, senão cunha via `fresh` —
/// o QR fica estável na tela e rotaciona sozinho ao expirar/ser consumido.
fn current_qr_token(
    board: &mut PairingBoard,
    now: Instant,
    fresh: impl FnOnce() -> String,
) -> String {
    match &board.qr {
        Some((t, at)) if now.duration_since(*at) <= PAIR_QR_TTL => t.clone(),
        _ => {
            let t = fresh();
            board.qr = Some((t.clone(), now));
            t
        }
    }
}

/// Nome do aparelho vindo do CLIENTE: entrada hostil — sem controle, cap de
/// tamanho, e vazio vira rótulo neutro (a UI nunca mostra string maliciosa
/// sem escape, mas o dado guardado também não carrega lixo).
fn sanitize_device_name(raw: &str) -> String {
    let s: String = raw
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .chars()
        .take(48)
        .collect();
    if s.is_empty() {
        "Aparelho".into()
    } else {
        s
    }
}

/// Poda pareamentos mortos: sem decisão além da janela de aceite (fail-closed,
/// "o pareamento morre") e decididos cujo resultado já foi exposto tempo
/// suficiente pro poll.
fn sweep_pairings(board: &mut PairingBoard, now: Instant) {
    board.pending.retain(|p| match p.decided_at {
        None => now.duration_since(p.claimed_at) <= PAIR_DECIDE_TTL,
        Some(at) => now.duration_since(at) <= PAIR_RESULT_TTL,
    });
}

/// Claim do pareamento: consome o token do QR (USO ÚNICO — o segundo claim com
/// o mesmo token falha) e registra o pedido aguardando o gesto humano.
fn claim_pairing(
    board: &mut PairingBoard,
    presented: &str,
    name: &str,
    now: Instant,
    now_ms: u64,
    id: String,
) -> Result<String, &'static str> {
    sweep_pairings(board, now);
    let ok = matches!(&board.qr, Some((t, at))
        if token_eq(t, presented) && now.duration_since(*at) <= PAIR_QR_TTL);
    if !ok {
        return Err("token de pareamento inválido ou expirado, escaneie o QR de novo");
    }
    board.qr = None; // uso único: consumido mesmo se o resto falhar
    if board.pending.len() >= PAIR_PENDING_CAP {
        return Err("pareamentos demais aguardando aceite, tente de novo em instantes");
    }
    board.pending.push(PendingPair {
        id: id.clone(),
        name: sanitize_device_name(name),
        claimed_at: now,
        requested_at_ms: now_ms,
        decision: None,
        decided_at: None,
    });
    Ok(id)
}

enum PairPoll {
    Pending,
    Approved(String),
    Denied,
    /// Desconhecido ou varrido (expirou sem aceite / resultado já entregue).
    Gone,
}

fn poll_pairing(board: &mut PairingBoard, id: &str, now: Instant) -> PairPoll {
    sweep_pairings(board, now);
    let Some(p) = board.pending.iter().find(|p| token_eq(&p.id, id)) else {
        return PairPoll::Gone;
    };
    match &p.decision {
        None => PairPoll::Pending,
        Some(Ok(t)) => PairPoll::Approved(t.clone()),
        Some(Err(())) => PairPoll::Denied,
    }
}

/// Gesto humano do desktop: aceita (cunha o token definitivo AGORA — antes do
/// aceite ele não existe em lugar nenhum) ou recusa. Devolve o nome do
/// aparelho + o token quando aceito; None = pedido não existe mais (expirou)
/// ou já foi decidido — o chamador reporta honesto, nunca re-decide.
fn decide_pairing(
    board: &mut PairingBoard,
    id: &str,
    accept: bool,
    token: String,
    now: Instant,
) -> Option<(String, Option<String>)> {
    sweep_pairings(board, now);
    let p = board
        .pending
        .iter_mut()
        .find(|p| p.id == id && p.decision.is_none())?;
    p.decided_at = Some(now);
    if accept {
        p.decision = Some(Ok(token.clone()));
        Some((p.name.clone(), Some(token)))
    } else {
        p.decision = Some(Err(()));
        Some((p.name.clone(), None))
    }
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------------- estado (gerenciado pelo Tauri) ----------------

/// Estado do companion. Snapshot é `Value` OPACO: o front define o shape.
/// O broadcast::Sender é a "lista de sockets": cada conexão WS assina um
/// Receiver; mandar aqui alcança todos os celulares conectados.
pub struct CompanionState {
    running: AtomicBool,
    /// C4 — credenciais VIVAS (legado + por aparelho), compartilhadas com o
    /// guard por Arc: revogar vale na hora, sem reiniciar o servidor.
    auth: Arc<Mutex<AuthSet>>,
    /// C4 — pareamento v2: token do QR corrente + claims aguardando aceite.
    pairing: Mutex<PairingBoard>,
    /// Throttle da escrita do "visto por último" no arquivo de aparelhos.
    last_seen_flush: Mutex<Option<Instant>>,
    snapshot: Mutex<Value>,
    /// attachmentId → Attachment dos uploads do celular. O id viaja nas ações
    /// (send_message/answer_gate); o emit resolve id→Attachment pro front.
    uploads: Mutex<HashMap<String, Attachment>>,
    /// C2 — idempotência de ação: actionIds já aceitos (janela curta). Duplo
    /// toque/retry do celular com o MESMO id vira 202 sem re-emitir (duas
    /// batidas nunca disparam duas tarefas). C4: POR APARELHO (principal →
    /// ids), fechando o registro §4 da revisão C2 — um aparelho autenticado
    /// não despeja os ids pendentes de outro inundando o teto.
    recent_actions: Mutex<HashMap<String, Vec<(String, Instant)>>>,
    tx: broadcast::Sender<String>,
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
}

impl Default for CompanionState {
    fn default() -> Self {
        Self {
            running: AtomicBool::new(false),
            auth: Arc::new(Mutex::new(AuthSet::default())),
            pairing: Mutex::new(PairingBoard::default()),
            last_seen_flush: Mutex::new(None),
            snapshot: Mutex::new(Value::Null),
            uploads: Mutex::new(HashMap::new()),
            recent_actions: Mutex::new(HashMap::new()),
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
/// propósito: não depende de AppHandle, então o middleware é testável isolado.
/// C4: o conjunto de tokens é VIVO (Arc compartilhado com o CompanionState) —
/// parear/revogar um aparelho muda o guard na hora, sem restart.
#[derive(Clone)]
struct Guard {
    auth: Arc<Mutex<AuthSet>>,
    rate: Arc<Mutex<HashMap<IpAddr, (Instant, u32)>>>,
}

impl Guard {
    /// Compat (testes pré-C4): token único vira o legado do AuthSet próprio.
    /// Produção usa `with_auth` (conjunto vivo do CompanionState).
    #[cfg_attr(not(test), allow(dead_code))]
    fn new(token: String) -> Self {
        Self::with_auth(Arc::new(Mutex::new(AuthSet {
            legacy: Some(token),
            devices: Vec::new(),
        })))
    }

    fn with_auth(auth: Arc<Mutex<AuthSet>>) -> Self {
        Self {
            auth,
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

/// C4 — token ÚNICO legado: só CARREGA se já existe (nunca mais cria um).
/// Ausente/inválido = None; o pareamento v2 é o único caminho novo.
fn load_legacy_token(app: &AppHandle) -> Option<String> {
    let dir = app.path().app_data_dir().ok()?;
    let t = std::fs::read_to_string(dir.join(TOKEN_FILE)).ok()?;
    let t = t.trim().to_string();
    (t.len() >= 32 && t.chars().all(|c| c.is_ascii_hexdigit())).then_some(t)
}

fn devices_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("sem app_data_dir: {e}"))?
        .join(DEVICES_FILE))
}

/// Aparelhos pareados do disco. Arquivo ausente/corrompido → lista vazia:
/// fail-open na LEITURA é seguro aqui (sem credencial ninguém entra; um
/// arquivo corrompido nunca derruba o boot do servidor).
fn load_devices(app: &AppHandle) -> Vec<Device> {
    let Ok(path) = devices_path(app) else {
        return Vec::new();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Escreve o arquivo de aparelhos com 0600 (mesma postura do token legado).
fn save_devices(app: &AppHandle, devices: &[Device]) -> Result<(), String> {
    let path = devices_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string(devices).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

// ---------------- comandos Tauri ----------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionInfo {
    pub running: bool,
    pub url_lan: Option<String>,
    /// C4 — token de PAREAMENTO do QR (uso único, vida curta). O QR só emite
    /// v2: a credencial definitiva nunca mais viaja na URL de pareamento.
    pub pairing_token: Option<String>,
    /// Nº de dispositivos (sockets WS) conectados agora — cada conexão viva
    /// segura um Receiver do broadcast, então receiver_count é a verdade.
    pub connected_count: usize,
}

/// Token de pareamento corrente (cunha um novo se expirou/foi consumido).
fn fresh_pairing_token(state: &CompanionState) -> Option<String> {
    state
        .pairing
        .lock()
        .ok()
        .map(|mut b| current_qr_token(&mut b, Instant::now(), || hex_random(16)))
}

/// Sobe o servidor (idempotente: já rodando → devolve a info atual).
#[tauri::command]
pub async fn companion_start(
    app: AppHandle,
    state: State<'_, CompanionState>,
) -> Result<CompanionInfo, String> {
    // swap = check-and-set atômico: segunda chamada concorrente vê true e sai.
    if state.running.swap(true, Ordering::SeqCst) {
        return Ok(CompanionInfo {
            running: true,
            url_lan: Some(url_lan()),
            pairing_token: fresh_pairing_token(&state),
            connected_count: state.tx.receiver_count(),
        });
    }
    // C4 — credenciais vivas: legado (se existir; nunca mais criamos um) +
    // aparelhos pareados do disco. O guard compartilha o MESMO Arc. Revisão
    // C4 (N1): a carga roda SÓ no start real (depois do check-and-set) — o
    // start idempotente não pode sobrescrever o last_seen vivo da memória
    // com o carimbo mais velho do disco.
    if let Ok(mut a) = state.auth.lock() {
        a.legacy = load_legacy_token(&app);
        a.devices = load_devices(&app);
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
    let router = build_router(ctx, Guard::with_auth(state.auth.clone()));
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
        pairing_token: fresh_pairing_token(&state),
        connected_count: 0,
    })
}

/// Para o servidor: fecha os WS abertos (sentinela) + graceful shutdown do axum.
#[tauri::command]
pub async fn companion_stop(
    app: AppHandle,
    state: State<'_, CompanionState>,
) -> Result<(), String> {
    // C4 — flush final do "visto por último" antes de dormir (throttle à parte).
    if let Ok(a) = state.auth.lock() {
        let _ = save_devices(&app, &a.devices);
    }
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
    Ok(CompanionInfo {
        running,
        url_lan: running.then(url_lan),
        pairing_token: if running {
            fresh_pairing_token(&state)
        } else {
            None
        },
        connected_count: if running { state.tx.receiver_count() } else { 0 },
    })
}

/// Fecha todos os WS abertos SEM parar o servidor: após uma revogação, o
/// aparelho revogado cai no 401 do reconnect (e limpa o storage local, C1);
/// os legítimos reconectam sozinhos em ~1s. O broadcast é global de propósito:
/// o socket não sabe qual token o abriu, e derrubar todos é barato e honesto.
fn drop_ws_clients(state: &CompanionState) {
    let _ = state.tx.send(STOP_SENTINEL.to_string());
}

/// C4 — revoga o token ÚNICO legado (apaga o arquivo + sai do AuthSet vivo).
/// Vale NA HORA mesmo com o servidor rodando: o guard compartilha o AuthSet.
#[tauri::command]
pub async fn companion_revoke_token(
    app: AppHandle,
    state: State<'_, CompanionState>,
) -> Result<(), String> {
    if let Ok(mut a) = state.auth.lock() {
        a.legacy = None;
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("sem app_data_dir: {e}"))?;
    let res = match std::fs::remove_file(dir.join(TOKEN_FILE)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    };
    drop_ws_clients(&state);
    res
}

// ---------------- comandos C4: aparelhos + aceite de pareamento ----------------

/// Aparelho pareado SEM a credencial (o token nunca sai pela lista).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePublic {
    pub id: String,
    pub name: String,
    pub paired_at: u64,
    pub last_seen_at: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPairPublic {
    pub id: String,
    pub name: String,
    pub requested_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionDevices {
    pub devices: Vec<DevicePublic>,
    pub pending: Vec<PendingPairPublic>,
    /// true = o token único pré-v2 ainda existe (aparelhos antigos com acesso).
    pub legacy_active: bool,
}

/// Lista aparelhos pareados + claims aguardando o aceite humano. De carona,
/// flusha o "visto por último" pro disco no máx. 1x/min (o guard só atualiza
/// em memória — sem isso, um restart esqueceria o carimbo).
#[tauri::command]
pub async fn companion_list_devices(
    app: AppHandle,
    state: State<'_, CompanionState>,
) -> Result<CompanionDevices, String> {
    let (devices, legacy_active) = state
        .auth
        .lock()
        .map(|a| {
            (
                a.devices
                    .iter()
                    .map(|d| DevicePublic {
                        id: d.id.clone(),
                        name: d.name.clone(),
                        paired_at: d.paired_at,
                        last_seen_at: d.last_seen_at,
                    })
                    .collect::<Vec<_>>(),
                a.legacy.is_some(),
            )
        })
        .map_err(|_| "estado de credenciais indisponível".to_string())?;
    let pending = state
        .pairing
        .lock()
        .map(|mut b| {
            sweep_pairings(&mut b, Instant::now());
            b.pending
                .iter()
                .filter(|p| p.decision.is_none())
                .map(|p| PendingPairPublic {
                    id: p.id.clone(),
                    name: p.name.clone(),
                    requested_at: p.requested_at_ms,
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let due = state
        .last_seen_flush
        .lock()
        .map(|mut g| match *g {
            Some(at) if at.elapsed() < LAST_SEEN_FLUSH_EVERY => false,
            _ => {
                *g = Some(Instant::now());
                true
            }
        })
        .unwrap_or(false);
    if due {
        if let Ok(a) = state.auth.lock() {
            if let Err(e) = save_devices(&app, &a.devices) {
                log::warn!("companion: flush de visto-por-último falhou: {e}");
            }
        }
    }
    Ok(CompanionDevices {
        devices,
        pending,
        legacy_active,
    })
}

/// GESTO HUMANO do pareamento v2: aceitar cunha o token definitivo (que não
/// existia até aqui), persiste o aparelho e o entrega ao poll do celular;
/// recusar mata o pedido. Pedido expirado/desconhecido é erro honesto.
#[tauri::command]
pub async fn companion_pair_decide(
    app: AppHandle,
    state: State<'_, CompanionState>,
    id: String,
    accept: bool,
) -> Result<(), String> {
    let minted = hex_random(32);
    let decided = state
        .pairing
        .lock()
        .map(|mut b| decide_pairing(&mut b, &id, accept, minted, Instant::now()))
        .map_err(|_| "estado de pareamento indisponível".to_string())?;
    let Some((name, token)) = decided else {
        return Err("este pedido de pareamento expirou ou já foi decidido".into());
    };
    let Some(token) = token else {
        log::info!("companion: pareamento recusado");
        return Ok(());
    };
    let device = Device {
        id: hex_random(8),
        name,
        token,
        paired_at: now_epoch_ms(),
        last_seen_at: None,
    };
    let devices = state
        .auth
        .lock()
        .map(|mut a| {
            a.devices.push(device);
            a.devices.clone()
        })
        .map_err(|_| "estado de credenciais indisponível".to_string())?;
    // Revisão C4 (N2) — degradação registrada: se a escrita do arquivo falhar
    // aqui, o aparelho já vive no AuthSet (funciona até o restart) e o poll do
    // celular ainda entrega o token, mas o Err abaixo mostra o problema na UI.
    // Pós-restart o token some do disco → o aparelho cai no 401 e a
    // autolimpeza do C1 recupera (re-parear resolve). Nunca é acesso fantasma.
    save_devices(&app, &devices)?;
    log::info!("companion: aparelho pareado (aceite humano)");
    Ok(())
}

/// Revisão C4 (F2) — flush do "visto por último" no QUIT do app (o throttle do
/// poll das Configurações não cobre sair do app sem abri-las). Só grava com o
/// servidor RODANDO: sem start nesta sessão o AuthSet está vazio e a escrita
/// apagaria o arquivo real. Chamado do RunEvent::ExitRequested no lib.rs.
pub fn flush_devices_on_exit(app: &AppHandle) {
    let state = app.state::<CompanionState>();
    if !state.running.load(Ordering::SeqCst) {
        return;
    }
    // snapshot clonado fora do lock (o guard como expressão de cauda tropeça
    // no E0597 com o borrow de `state`).
    let devices = match state.auth.lock() {
        Ok(a) => a.devices.clone(),
        Err(_) => return,
    };
    if let Err(e) = save_devices(app, &devices) {
        log::warn!("companion: flush de saída falhou: {e}");
    }
}

/// Revogação INDIVIDUAL (C4): tira o aparelho do AuthSet vivo + do arquivo e
/// derruba os WS abertos — o aparelho revogado cai no 401 e limpa o storage.
#[tauri::command]
pub async fn companion_revoke_device(
    app: AppHandle,
    state: State<'_, CompanionState>,
    id: String,
) -> Result<(), String> {
    let devices = state
        .auth
        .lock()
        .map(|mut a| {
            a.devices.retain(|d| d.id != id);
            a.devices.clone()
        })
        .map_err(|_| "estado de credenciais indisponível".to_string())?;
    save_devices(&app, &devices)?;
    drop_ws_clients(&state);
    Ok(())
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

/// C2 — Front → Rust: RESULTADO de uma ação do celular (fail-closed com motivo
/// legível: o 202 do POST /api/action é só "aceitei"; o veredito real — turno
/// lançado, "já estava finalizando", projeto sumiu — sai do executor JS e volta
/// pro aparelho por aqui. `result` é opaco (o front define o shape, como o
/// snapshot); o transporte não interpreta.
#[tauri::command]
pub async fn companion_action_result(
    result: Value,
    state: State<'_, CompanionState>,
) -> Result<(), String> {
    let _ = state
        .tx
        .send(json!({"type": "action-result", "data": result}).to_string());
    Ok(())
}

// ---------------- servidor axum ----------------

fn build_router(ctx: Ctx, guard_state: Guard) -> Router {
    let api = Router::new()
        .route("/state", get(get_state))
        .route("/conv/{id}", get(get_conv))
        .route("/blob/{root}/{conv}/{file}", get(get_blob))
        .route("/ws", get(ws_upgrade))
        .route("/action", post(post_action))
        .route("/attachment", post(post_attachment))
        .layer(middleware::from_fn_with_state(guard_state.clone(), guard))
        .layer(DefaultBodyLimit::max(BODY_CAP));
    // C4 — pareamento v2: rotas SEM Bearer (a credencial ainda não existe; o
    // token de pareamento de uso único é validado no handler), mas com o MESMO
    // rate-limit por IP e corpo curto.
    let pair = Router::new()
        .route("/claim", post(pair_claim))
        .route("/status/{id}", get(pair_status))
        .layer(middleware::from_fn_with_state(guard_state, rate_guard))
        .layer(DefaultBodyLimit::max(8 * 1024));
    Router::new()
        .route("/", get(index_page))
        // fundação C1: shell do PWA — tudo embutido no binário, nada de disco.
        // Fora do /api de propósito (o browser busca manifest/ícones/SW sem
        // header de auth); nenhum desses assets carrega dado do usuário.
        .route("/core.js", get(core_js))
        .route("/sw.js", get(sw_js))
        .route("/manifest.webmanifest", get(manifest_webmanifest))
        .route("/icon-192.png", get(icon_192))
        .route("/icon-512.png", get(icon_512))
        .route("/apple-touch-icon.png", get(icon_touch))
        .nest("/api", api)
        .nest("/pair", pair)
        .with_state(ctx)
}

/// Página do Companion embutida no binário (onda 3): única, auto-contida
/// (vanilla JS + CSS inline com os tokens do app) — zero build, zero CDN.
const COMPANION_PAGE: &str = include_str!("../companion/index.html");
/// Núcleo puro do cliente (C1): rotas/reconexão/"visto há" — o MESMO arquivo
/// roda no vitest (src/lib/companionWeb.test.ts), sem implementação gêmea.
const COMPANION_CORE: &str = include_str!("../companion/core.js");
/// Service worker mínimo (C1): cache do shell; /api NUNCA entra no cache.
const COMPANION_SW: &str = include_str!("../companion/sw.js");
/// Manifest do PWA (nome, ícones, standalone, tema).
const COMPANION_MANIFEST: &str = include_str!("../companion/manifest.webmanifest");
const COMPANION_ICON_192: &[u8] = include_bytes!("../companion/icon-192.png");
const COMPANION_ICON_512: &[u8] = include_bytes!("../companion/icon-512.png");
const COMPANION_ICON_TOUCH: &[u8] = include_bytes!("../companion/apple-touch-icon.png");

/// Guardião de TODA rota /api: rate-limit por IP + token. Bearer vale em
/// qualquer rota; `?token=` SÓ no /api/ws (o WebSocket do browser não manda
/// header Authorization — nas demais rotas, token em URL iria parar em
/// histórico/logs de proxy sem necessidade). Sem token válido ⇒ 401 seco
/// (sem corpo, sem dica). Nunca loga o token.
async fn guard(
    AxState(g): AxState<Guard>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    mut req: Request,
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
    // C4 — o token apresentado casa contra o conjunto VIVO (legado + por
    // aparelho); o principal viaja nas extensions (dedupe por-aparelho) e o
    // "visto por último" do aparelho é carimbado em memória de carona.
    let principal = presented.and_then(|t| {
        g.auth
            .lock()
            .ok()
            .and_then(|mut a| {
                let id = a.match_token(&t)?;
                if let Some(d) = a.devices.iter_mut().find(|d| d.id == id) {
                    d.last_seen_at = Some(now_epoch_ms());
                }
                Some(id)
            })
    });
    match principal {
        Some(id) => {
            req.extensions_mut().insert(AuthPrincipal(id));
            next.run(req).await
        }
        None => StatusCode::UNAUTHORIZED.into_response(),
    }
}

/// C4 — rate-limit puro (sem token) das rotas de pareamento: o /pair não tem
/// Bearer por definição, mas nunca fica sem freio por IP.
async fn rate_guard(
    AxState(g): AxState<Guard>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Response {
    if !g.allow(addr.ip()) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    next.run(req).await
}

/// POST /pair/claim — troca o token de pareamento do QR (uso único) por um
/// `pairingId` de poll. O token definitivo NÃO nasce aqui: só no aceite
/// humano (companion_pair_decide). Avisa o desktop pra UI de aceite acordar.
async fn pair_claim(AxState(ctx): AxState<Ctx>, Json(body): Json<Value>) -> Response {
    let Some(presented) = body.get("pairToken").and_then(Value::as_str) else {
        return (StatusCode::BAD_REQUEST, "pairToken ausente").into_response();
    };
    let name = body
        .get("deviceName")
        .and_then(Value::as_str)
        .unwrap_or("");
    let st = ctx.app.state::<CompanionState>();
    let res = st
        .pairing
        .lock()
        .map(|mut b| {
            claim_pairing(
                &mut b,
                presented,
                name,
                Instant::now(),
                now_epoch_ms(),
                hex_random(16),
            )
        })
        // lock envenenado: fail-closed (pareamento indisponível ≠ porta aberta)
        .unwrap_or(Err("pareamento indisponível, tente de novo"));
    match res {
        Ok(id) => {
            let _ = ctx.app.emit(
                "companion://pair-request",
                json!({"id": id, "name": sanitize_device_name(name)}),
            );
            log::info!("companion: claim de pareamento aguardando aceite humano");
            Json(json!({"pairingId": id})).into_response()
        }
        Err(e) => (StatusCode::FORBIDDEN, e).into_response(),
    }
}

/// GET /pair/status/{id} — poll do aparelho aguardando o aceite. Sempre 200
/// com `status`; `approved` traz o token definitivo (o registro morre sozinho
/// pouco depois — ver PAIR_RESULT_TTL).
async fn pair_status(AxState(ctx): AxState<Ctx>, AxPath(id): AxPath<String>) -> Response {
    let st = ctx.app.state::<CompanionState>();
    let poll = st
        .pairing
        .lock()
        .map(|mut b| poll_pairing(&mut b, &id, Instant::now()))
        .unwrap_or(PairPoll::Gone);
    let body = match poll {
        PairPoll::Pending => json!({"status": "pending"}),
        PairPoll::Approved(token) => json!({"status": "approved", "token": token}),
        PairPoll::Denied => json!({"status": "denied"}),
        PairPoll::Gone => json!({"status": "expired"}),
    };
    Json(body).into_response()
}

/// CSP da página (defesa-em-profundidade contra XSS de conteúdo de LLM):
/// nenhum host externo; script/style só inline (a página é auto-contida);
/// connect só same-origin + WS (o `ws:` explícito cobre browsers móveis que
/// ainda não casam WebSocket com 'self'); img blob:/data: p/ thumbs de anexo.
/// C1: `script-src` ganha 'self' (o core.js sai do próprio binário),
/// `manifest-src`/`worker-src` 'self' liberam manifest e service worker —
/// continua ZERO host externo.
const PAGE_CSP: &str = "default-src 'none'; script-src 'self' 'unsafe-inline'; \
    style-src 'unsafe-inline'; img-src 'self' blob: data:; \
    connect-src 'self' ws: wss:; manifest-src 'self'; worker-src 'self'; \
    base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

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

/// Asset textual do shell com content-type explícito + nosniff. `no-cache` de
/// propósito: o cache de LONGO prazo é papel do service worker (versionado);
/// o HTTP sempre revalida — atualização do app nunca fica presa num proxy.
fn text_asset(content_type: &'static str, body: &'static str) -> Response {
    (
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "no-cache"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        body,
    )
        .into_response()
}

fn png_asset(body: &'static [u8]) -> Response {
    (
        [
            (header::CONTENT_TYPE, "image/png"),
            (header::CACHE_CONTROL, "public, max-age=86400"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        body,
    )
        .into_response()
}

async fn core_js() -> Response {
    text_asset("application/javascript; charset=utf-8", COMPANION_CORE)
}
async fn sw_js() -> Response {
    text_asset("application/javascript; charset=utf-8", COMPANION_SW)
}
async fn manifest_webmanifest() -> Response {
    text_asset("application/manifest+json", COMPANION_MANIFEST)
}
async fn icon_192() -> Response {
    png_asset(COMPANION_ICON_192)
}
async fn icon_512() -> Response {
    png_asset(COMPANION_ICON_512)
}
async fn icon_touch() -> Response {
    png_asset(COMPANION_ICON_TOUCH)
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

/// C3 — janela do fio no SERVIDOR: a maior conversa real desta máquina tem
/// 1.9MB (1476 itens); a cauda de 60 itens pesa ~68KB — é isso que o celular
/// baixa por padrão, com "carregar anteriores" paginando via `?before=`.
const CONV_WINDOW_DEFAULT: usize = 60;
const CONV_WINDOW_MAX: usize = 200;

/// C3 — recorte puro da janela: devolve (itens, start, total) onde `start` é o
/// índice do PRIMEIRO item devolvido no fio completo. `before` = fim exclusivo
/// (paginação: a página anterior termina onde a atual começa).
fn window_items(items: &[Value], limit: usize, before: Option<usize>) -> (Vec<Value>, usize, usize) {
    let total = items.len();
    let end = before.unwrap_or(total).min(total);
    let start = end.saturating_sub(limit.clamp(1, CONV_WINDOW_MAX));
    (items[start..end].to_vec(), start, total)
}

/// GET /api/conv/{id} — histórico da conversa direto do SQLite (READ-ONLY).
/// Devolve SÓ id/title/items/agent (+ start/total da janela C3) — nada de
/// paths de disco. Fio grande NUNCA viaja inteiro: o servidor decide a janela
/// (últimos N itens; `?before=<índice>` pagina pra trás, `?limit=` até o cap).
async fn get_conv(
    AxState(ctx): AxState<Ctx>,
    AxPath(id): AxPath<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    // mesmo saneamento dos anexos: id de conversa só pode ser hex/uuid.
    let id: String = id
        .chars()
        .filter(|c| c.is_ascii_hexdigit() || *c == '-')
        .collect();
    // parâmetros de janela malformados são 400 com motivo, não silêncio.
    let limit = match q.get("limit").map(|s| s.parse::<usize>()) {
        None => CONV_WINDOW_DEFAULT,
        Some(Ok(n)) if n >= 1 => n,
        _ => return (StatusCode::BAD_REQUEST, "limit inválido").into_response(),
    };
    let before = match q.get("before").map(|s| s.parse::<usize>()) {
        None => None,
        Some(Ok(n)) => Some(n),
        Some(Err(_)) => return (StatusCode::BAD_REQUEST, "before inválido").into_response(),
    };
    let db = match ctx.app.path().app_data_dir() {
        Ok(d) => d.join("mycockpit.db"),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    // rusqlite é sync → spawn_blocking pra não segurar o executor do axum.
    match tokio::task::spawn_blocking(move || read_conv(&db, &id)).await {
        Ok(Ok(Some(mut v))) => {
            let full: Vec<Value> = v["items"].as_array().cloned().unwrap_or_default();
            let (win, start, total) = window_items(&full, limit, before);
            v["items"] = Value::Array(win);
            v["start"] = json!(start);
            v["total"] = json!(total);
            Json(v).into_response()
        }
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

/// C3 — validação PURA do path de blob do fio: só as duas raízes conhecidas
/// (`attachments/` dos anexos, `evidence/` das capturas de tool), pasta de
/// conversa hex/uuid, nome de arquivo no alfabeto seguro e extensão da MESMA
/// allowlist dos anexos. Qualquer coisa fora disso é None (vira 404) — path
/// traversal nunca chega ao filesystem. Devolve (root, conv, file, mime).
fn blob_path_parts(
    root: &str,
    conv: &str,
    file: &str,
) -> Option<(String, String, String, &'static str)> {
    if root != "attachments" && root != "evidence" {
        return None;
    }
    if conv.is_empty() || !conv.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return None;
    }
    let file_ok = !file.is_empty()
        && !file.contains("..")
        && file
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-');
    if !file_ok {
        return None;
    }
    let mime = match file.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "pdf" => "application/pdf",
        _ => return None,
    };
    Some((root.to_string(), conv.to_string(), file.to_string(), mime))
}

/// GET /api/blob/{root}/{conv}/{file} — serve um blob do fio (anexo do usuário
/// ou evidência visual de tool) pro celular. Token exigido pelo guard (Bearer);
/// a página busca com fetch autenticado e pinta via objectURL — o token nunca
/// vai parar em URL de <img>. READ-ONLY, allowlist fechada, nunca path do disco
/// na resposta.
async fn get_blob(
    AxState(ctx): AxState<Ctx>,
    AxPath((root, conv, file)): AxPath<(String, String, String)>,
) -> Response {
    let Some((root, conv, file, mime)) = blob_path_parts(&root, &conv, &file) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let base = match ctx.app.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let abs = base.join(&root).join(&conv).join(&file);
    match tokio::task::spawn_blocking(move || std::fs::read(&abs)).await {
        Ok(Ok(bytes)) => (
            [
                (header::CONTENT_TYPE, mime),
                (header::CACHE_CONTROL, "private, max-age=3600"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                // defesa em profundidade (revisão C3): a página consome via
                // fetch→objectURL (header irrelevante ali), mas navegar DIRETO
                // pra URL nunca renderiza o blob inline (PDF no contexto da
                // origem seria superfície à toa).
                (header::CONTENT_DISPOSITION, "attachment"),
            ],
            bytes,
        )
            .into_response(),
        Ok(Err(_)) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
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
async fn post_action(
    AxState(ctx): AxState<Ctx>,
    principal: Option<Extension<AuthPrincipal>>,
    Json(body): Json<Value>,
) -> Response {
    // C2 — idempotência por actionId ANTES da sanitização completa (revisão C2
    // §3): o 1º aceite CONSOME os uploads do cache, então um retry com anexos
    // repassado ao sanitize viraria 400 ("attachmentId desconhecido") em vez
    // do 202 idempotente. check-and-set atômico (duas batidas concorrentes
    // nunca emitem duas); se a sanitização REPROVAR, o id é esquecido — um
    // 400 não pode envenenar o retry legítimo seguinte. Falha de lock nunca
    // bloqueia ação legítima (fail-open só na PROTEÇÃO de duplicata).
    // C4 — o registro é POR APARELHO (principal do guard): inundar o teto de
    // 256 ids só despeja os SEUS próprios (revisão C2 §4 fechada).
    let who = principal
        .map(|Extension(AuthPrincipal(id))| id)
        .unwrap_or_else(|| "legacy".into());
    let action_id = match sanitize_action_id(&body) {
        Ok(a) => a,
        Err(e) => return (StatusCode::BAD_REQUEST, e).into_response(),
    };
    if let Some(id) = &action_id {
        let fresh = ctx
            .app
            .state::<CompanionState>()
            .recent_actions
            .lock()
            .map(|mut m| remember_action(m.entry(who.clone()).or_default(), id, Instant::now()))
            .unwrap_or(true);
        if !fresh {
            log::info!("companion: ação duplicada (actionId repetido) — 202 sem re-emitir");
            return StatusCode::ACCEPTED.into_response();
        }
    }
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
        Err(e) => {
            // 400 esquece o id registrado acima: a ação NÃO foi aceita, o
            // retry corrigido com o mesmo id precisa passar.
            if let Some(id) = &action_id {
                if let Ok(mut m) = ctx.app.state::<CompanionState>().recent_actions.lock() {
                    if let Some(seen) = m.get_mut(&who) {
                        forget_action(seen, id);
                    }
                }
            }
            (StatusCode::BAD_REQUEST, e).into_response()
        }
    }
}

/// C2 — janela de idempotência dos actionIds e teto de memória do registro.
const ACTION_DEDUPE_TTL: Duration = Duration::from_secs(300);
const ACTION_DEDUPE_CAP: usize = 256;

/// C2 — `actionId` opcional do corpo: id gerado pelo CELULAR por gesto (retry
/// reusa o mesmo). Presente ⇒ 8..=64 chars [A-Za-z0-9-]; malformado é 400
/// (payload adversarial nunca vira silêncio). Ausente ⇒ ação segue sem
/// idempotência (compat com a página antiga).
fn sanitize_action_id(v: &Value) -> Result<Option<String>, String> {
    match v.get("actionId") {
        None => Ok(None),
        Some(x) => {
            let s = x.as_str().ok_or("actionId inválido")?;
            let ok = (8..=64).contains(&s.len())
                && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
            if ok {
                Ok(Some(s.to_string()))
            } else {
                Err("actionId inválido".into())
            }
        }
    }
}

/// C2 — dedupe puro: true = primeira vez (registra); false = repetição dentro
/// da janela. Poda expirados a cada chamada; cheio ⇒ derruba o mais antigo.
/// Limitação ACEITA (revisão C2 §4, registrada junto do pareamento v2 no
/// plano): um aparelho AUTENTICADO pode inundar o teto de 256 e despejar um
/// id pendente (retry re-lançaria). No modelo token-único de LAN o atacante
/// já teria o token — proteção real vem com o pareamento v2 (C4).
fn remember_action(seen: &mut Vec<(String, Instant)>, id: &str, now: Instant) -> bool {
    seen.retain(|(_, t)| now.duration_since(*t) <= ACTION_DEDUPE_TTL);
    if seen.iter().any(|(s, _)| s == id) {
        return false;
    }
    if seen.len() >= ACTION_DEDUPE_CAP {
        seen.remove(0);
    }
    seen.push((id.to_string(), now));
    true
}

/// C2 — rollback do dedupe: uma ação 400 NÃO foi aceita, então o id dela sai
/// do registro (o retry corrigido com o mesmo id volta a passar).
fn forget_action(seen: &mut Vec<(String, Instant)>, id: &str) {
    seen.retain(|(s, _)| s != id);
}

/// Whitelist FECHADA + reconstrução do payload. Puro sobre (uploads, corpo) —
/// sem AppHandle de propósito, p/ os unit tests baterem direto aqui.
fn sanitize_action(uploads: &HashMap<String, Attachment>, v: &Value) -> Result<Value, String> {
    let kind = v
        .get("kind")
        .and_then(Value::as_str)
        .ok_or("kind ausente")?;
    let action_id = sanitize_action_id(v)?;
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
            let mut out = json!({"kind": "send_message", "projectId": project, "agent": agent,
                   "text": text, "attachmentIds": ids, "attachments": atts});
            // convId OPCIONAL (P5): chat aberto numa conversa não-mesa manda o
            // alvo explícito. Presente ⇒ precisa ser string não-vazia (payload
            // adversarial com tipo errado é 400, não silêncio); ausente ⇒ o
            // executor cai na conversa de mesa (fallback intacto). A validação
            // de PERTENCIMENTO (conversa é do projeto) fica no executor JS.
            if let Some(cv) = v.get("convId") {
                let conv = cv
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .ok_or("convId inválido")?;
                out["convId"] = json!(conv);
            }
            out
        }
        // C2 — lançar tarefa: projeto + prompt (+ Especialista opcional). O
        // executor JS cria a CONVERSA NOVA pelos stores (registerConversation
        // + sendFromDesk — mesmo caminho do composer, nunca atalho próprio).
        // actionId OBRIGATÓRIO: lançar tarefa é a ação mais cara de duplicar
        // (toque fantasma = dois turnos queimando dinheiro).
        "launch_task" => {
            if action_id.is_none() {
                return Err("actionId obrigatório em launch_task".into());
            }
            let project = req_str("projectId")?;
            let agent = req_str("agent")?;
            let text = req_str("text")?;
            if text.len() > 64 * 1024 {
                return Err("text longo demais".into());
            }
            let ids = attachment_ids()?;
            let atts = resolve_uploads(uploads, &ids)?;
            let mut out = json!({"kind": "launch_task", "projectId": project, "agent": agent,
                   "text": text, "attachmentIds": ids, "attachments": atts});
            // presetId OPCIONAL (Especialista): presente ⇒ string não-vazia;
            // a validação de EXISTÊNCIA (arquivo legível no projeto) fica no
            // executor JS, que devolve o motivo pelo action-result.
            if let Some(pv) = v.get("presetId") {
                let preset = pv
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .ok_or("presetId inválido")?;
                out["presetId"] = json!(preset);
            }
            out
        }
        // dispatch_card/close_card SAÍRAM da whitelist (ADR-041): o Board não
        // existe mais no celular, então card não é mais vocabulário do
        // Companion. Cliente velho pedindo uma delas cai no _ => 400 abaixo.
        "feedback_lesson" => {
            // P6: 👍/👎 de turno concluído → reforço de lições no front. Verdict
            // é enum fechado (up|down) — qualquer outro valor é 400.
            let conv = req_str("convId")?;
            let verdict = req_str("verdict")?;
            if verdict != "up" && verdict != "down" {
                return Err("verdict inválido (up|down)".into());
            }
            json!({"kind": "feedback_lesson", "convId": conv, "verdict": verdict})
        }
        other => return Err(format!("ação desconhecida: {other}")),
    };
    // C2 — actionId validado viaja no payload reconstruído (qualquer kind):
    // é a chave do dedupe no post_action e do action-result do executor JS.
    let mut out = out;
    if let Some(id) = action_id {
        out["actionId"] = json!(id);
    }
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
        // P6: a página fala o vocabulário whitelisted do 👍/👎
        assert!(COMPANION_PAGE.contains("feedback_lesson"));
        // ADR-041: a página NÃO pede mais ação de card (o Board saiu do
        // celular) — a whitelist e o cliente versionam juntos no binário.
        assert!(!COMPANION_PAGE.contains("data-cardgo"));
        assert!(!COMPANION_PAGE.contains("data-cardclose"));
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

    // ── fundação C1: PWA + router + offline honesto ──

    #[test]
    fn fundacao_c1_pagina_declara_pwa_router_e_offline() {
        // manifest + ícone + SW: instalável de verdade, não só uma página
        assert!(COMPANION_PAGE.contains("rel=\"manifest\""));
        assert!(COMPANION_PAGE.contains("apple-touch-icon"));
        assert!(COMPANION_PAGE.contains("serviceWorker"));
        // núcleo compartilhado carregado como script clássico (mock file:// vive)
        assert!(COMPANION_PAGE.contains("src=\"core.js\""));
        // history API real: navegar escreve hash, voltar aplica via hashchange
        assert!(COMPANION_PAGE.contains("hashchange"));
        // offline honesto: banner com carimbo, nunca dado velho fingindo vivo
        assert!(COMPANION_PAGE.contains("Sem conexão com o Mac"));
        assert!(COMPANION_PAGE.contains("offlineSeen"));
    }

    #[test]
    fn fundacao_c1_manifest_instalavel_e_autocontido() {
        let m: Value = serde_json::from_str(COMPANION_MANIFEST)
            .expect("manifest do PWA precisa ser JSON válido");
        assert_eq!(m["display"], "standalone");
        assert_eq!(m["start_url"], "/");
        assert!(m["name"].as_str().unwrap().contains("FROTA"));
        let icons = m["icons"].as_array().expect("icons ausentes");
        assert!(icons.len() >= 2);
        for icon in icons {
            let src = icon["src"].as_str().unwrap();
            // todo ícone declarado tem rota embutida de verdade no binário
            assert!(
                ["/icon-192.png", "/icon-512.png"].contains(&src),
                "ícone declarado sem rota embutida: {src}"
            );
        }
        assert!(!COMPANION_MANIFEST.contains("http")); // zero host externo
    }

    #[test]
    fn fundacao_c1_sw_cacheia_shell_por_allowlist_e_nunca_dados() {
        // extrai a allowlist REAL (var SHELL = [ … ];) e confere a SEMÂNTICA:
        // shell completo dentro, nenhum caminho de dado, e o fetch handler só
        // age quando o pathname ESTÁ na lista (allowlist, não denylist — rota
        // nova de dado fora de /api nunca vira snapshot velho silencioso).
        let start = COMPANION_SW
            .find("var SHELL = [")
            .expect("sw.js sem a allowlist SHELL");
        let block = &COMPANION_SW[start..];
        let block = &block[..block.find("];").expect("allowlist sem fechamento")];
        let items: Vec<&str> = block.split('"').skip(1).step_by(2).collect();
        for asset in [
            "/",
            "/core.js",
            "/manifest.webmanifest",
            "/icon-192.png",
            "/icon-512.png",
            "/apple-touch-icon.png",
        ] {
            assert!(items.contains(&asset), "shell sem {asset} na allowlist");
        }
        // nada dinâmico na lista: todo item é asset embutido conhecido
        for item in &items {
            assert!(
                !item.starts_with("/api"),
                "dado dinâmico na allowlist do cache: {item}"
            );
        }
        // o guard do fetch é allowlist de verdade: fora da lista → passa reto
        assert!(COMPANION_SW.contains("SHELL.indexOf(url.pathname) < 0"));
        assert!(!COMPANION_SW.contains("http://")); // auto-contido
    }

    #[test]
    fn fundacao_c1_revogacao_401_limpa_token_e_snapshot_cacheado() {
        // aparelho revogado não retém NADA: o handler de 401 da página apaga o
        // token E o snapshot cacheado (custos/attention/entregas) do localStorage.
        let start = COMPANION_PAGE
            .find("function onUnauthorized()")
            .expect("página sem handler de 401");
        // corpo do handler = até a próxima declaração de função
        let body = &COMPANION_PAGE[start..];
        let body = &body[..body.find("\nfunction ").expect("handler sem fim")];
        assert!(body.contains("removeItem(LS_TOKEN)"), "401 não apaga o token");
        assert!(
            body.contains("removeItem(LS_SNAP)"),
            "401 não apaga o snapshot cacheado"
        );
    }

    #[test]
    fn fundacao_c1_core_e_autocontido_e_expoe_o_global() {
        // UMD: o browser ganha o global; o vitest importa o MESMO arquivo
        assert!(COMPANION_CORE.contains("CompanionCore"));
        for f in ["parseRoute", "routeHash", "connReduce", "seenAgo"] {
            assert!(COMPANION_CORE.contains(f), "core.js sem {f}");
        }
        assert!(!COMPANION_CORE.contains("http://"));
        assert!(!COMPANION_CORE.contains("fetch(")); // puro: zero rede/DOM
    }

    #[tokio::test]
    async fn fundacao_c1_assets_servidos_com_content_type_certo() {
        async fn body_of(resp: Response) -> Vec<u8> {
            axum::body::to_bytes(resp.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec()
        }
        let r = core_js().await;
        assert!(r
            .headers()
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("application/javascript"));
        let r = sw_js().await;
        // SW revalida sempre (no-cache): atualização do shell não fica presa
        assert_eq!(r.headers().get(header::CACHE_CONTROL).unwrap(), "no-cache");
        let r = manifest_webmanifest().await;
        assert_eq!(
            r.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/manifest+json"
        );
        for resp in [icon_192().await, icon_512().await, icon_touch().await] {
            assert_eq!(resp.headers().get(header::CONTENT_TYPE).unwrap(), "image/png");
            let b = body_of(resp).await;
            assert_eq!(&b[..4], b"\x89PNG", "bytes embutidos não são PNG");
        }
    }

    #[test]
    fn fundacao_c1_csp_libera_sw_e_manifest_sem_host_externo() {
        assert!(PAGE_CSP.contains("script-src 'self' 'unsafe-inline'"));
        assert!(PAGE_CSP.contains("worker-src 'self'"));
        assert!(PAGE_CSP.contains("manifest-src 'self'"));
        assert!(PAGE_CSP.contains("default-src 'none'"));
        assert!(!PAGE_CSP.contains("http://"));
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
    fn sanitize_send_message_conv_id_opcional() {
        let up = HashMap::new();
        // sem convId → payload SEM o campo (executor cai na mesa)
        let out = sanitize_action(
            &up,
            &json!({"kind": "send_message", "projectId": "p1", "agent": "codex", "text": "oi"}),
        )
        .unwrap();
        assert!(out.get("convId").is_none());
        // convId válido → viaja no payload reconstruído
        let out = sanitize_action(
            &up,
            &json!({"kind": "send_message", "projectId": "p1", "agent": "codex",
                    "text": "oi", "convId": "abc123"}),
        )
        .unwrap();
        assert_eq!(out["convId"], "abc123");
        // convId presente mas inválido (vazio / tipo errado) → 400, não silêncio
        assert!(sanitize_action(
            &up,
            &json!({"kind": "send_message", "projectId": "p1", "agent": "codex",
                    "text": "oi", "convId": ""}),
        )
        .is_err());
        assert!(sanitize_action(
            &up,
            &json!({"kind": "send_message", "projectId": "p1", "agent": "codex",
                    "text": "oi", "convId": 42}),
        )
        .is_err());
    }

    #[test]
    fn sanitize_feedback_lesson_verdict_fechado() {
        let up = HashMap::new();
        let out = sanitize_action(
            &up,
            &json!({"kind": "feedback_lesson", "convId": "c1", "verdict": "up", "hack": "x"}),
        )
        .unwrap();
        // reconstrução: só os campos conhecidos, campos extras nunca passam
        assert_eq!(
            out,
            json!({"kind": "feedback_lesson", "convId": "c1", "verdict": "up"})
        );
        let out = sanitize_action(
            &up,
            &json!({"kind": "feedback_lesson", "convId": "c1", "verdict": "down"}),
        )
        .unwrap();
        assert_eq!(out["verdict"], "down");
        // verdict fora do enum / campos faltando → erro
        assert!(sanitize_action(
            &up,
            &json!({"kind": "feedback_lesson", "convId": "c1", "verdict": "meh"}),
        )
        .is_err());
        assert!(
            sanitize_action(&up, &json!({"kind": "feedback_lesson", "convId": "c1"})).is_err()
        );
        assert!(
            sanitize_action(&up, &json!({"kind": "feedback_lesson", "verdict": "up"})).is_err()
        );
    }

    #[test]
    fn acoes_de_card_saem_da_whitelist_e_viram_400() {
        // ADR-041: o Board saiu do Companion. Card deixou de ser vocabulário
        // do celular, então as duas ações caem no default da whitelist — nada
        // atravessa pro executor, nem de um cliente velho ainda aberto.
        let up = HashMap::new();
        assert!(
            sanitize_action(&up, &json!({"kind": "dispatch_card", "cardId": "k1"})).is_err()
        );
        assert!(sanitize_action(
            &up,
            &json!({"kind": "close_card", "cardId": "k1", "state": "done"}),
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

    // ── C2: launch_task + actionId (idempotência) + action-result ──

    #[test]
    fn c2_sanitize_launch_task_reconstroi_e_valida() {
        let up = HashMap::new();
        let aid = "f00dfeedf00dfeed";
        // completo (com Especialista): só os campos conhecidos viajam
        let out = sanitize_action(
            &up,
            &json!({"kind": "launch_task", "projectId": "p1", "agent": "codex",
                    "text": "cobrir o parser com testes", "presetId": "revisor",
                    "actionId": aid, "hack": "sudo rm -rf /"}),
        )
        .unwrap();
        assert_eq!(out["kind"], "launch_task");
        assert_eq!(out["projectId"], "p1");
        assert_eq!(out["agent"], "codex");
        assert_eq!(out["presetId"], "revisor");
        assert_eq!(out["actionId"], aid);
        assert!(out.get("hack").is_none());
        // sem preset: o campo NÃO viaja (executor lança sem persona)
        let out = sanitize_action(
            &up,
            &json!({"kind": "launch_task", "projectId": "p1", "agent": "codex",
                    "text": "oi", "actionId": aid}),
        )
        .unwrap();
        assert!(out.get("presetId").is_none());
        // campos faltando / inválidos → 400
        assert!(sanitize_action(
            &up,
            &json!({"kind": "launch_task", "agent": "codex", "text": "oi", "actionId": aid}),
        )
        .is_err()); // sem projectId
        assert!(sanitize_action(
            &up,
            &json!({"kind": "launch_task", "projectId": "p1", "agent": "codex", "actionId": aid}),
        )
        .is_err()); // sem text
        assert!(sanitize_action(
            &up,
            &json!({"kind": "launch_task", "projectId": "p1", "agent": "codex",
                    "text": "oi", "presetId": "", "actionId": aid}),
        )
        .is_err()); // presetId presente mas vazio
        let longo = "x".repeat(64 * 1024 + 1);
        assert!(sanitize_action(
            &up,
            &json!({"kind": "launch_task", "projectId": "p1", "agent": "codex",
                    "text": longo, "actionId": aid}),
        )
        .is_err());
    }

    #[test]
    fn c2_launch_task_exige_action_id() {
        // lançar tarefa SEM id de idempotência é 400: toque fantasma no sofá
        // não pode virar dois turnos pagos.
        let up = HashMap::new();
        assert!(sanitize_action(
            &up,
            &json!({"kind": "launch_task", "projectId": "p1", "agent": "codex", "text": "oi"}),
        )
        .is_err());
    }

    #[test]
    fn c2_action_id_valida_forma_e_e_opcional_nas_demais() {
        let up = HashMap::new();
        // ausente nas demais ações: payload sai SEM o campo (compat)
        let out = sanitize_action(&up, &json!({"kind": "stop_turn", "convId": "c1"})).unwrap();
        assert!(out.get("actionId").is_none());
        // presente e válido: viaja reconstruído (stop honesto usa no result)
        let out = sanitize_action(
            &up,
            &json!({"kind": "stop_turn", "convId": "c1", "actionId": "abc-123-def"}),
        )
        .unwrap();
        assert_eq!(out["actionId"], "abc-123-def");
        // malformado (curto, tipo errado, char fora do alfabeto) → 400
        for bad in [json!("curto"), json!(42), json!("a b c d e f g h"), json!("x".repeat(65))] {
            assert!(
                sanitize_action(&up, &json!({"kind": "stop_turn", "convId": "c1", "actionId": bad}))
                    .is_err(),
                "actionId inválido aceito: {bad:?}"
            );
        }
    }

    #[test]
    fn c2_remember_action_dedupe_com_janela_e_teto() {
        let mut seen = Vec::new();
        let t0 = Instant::now();
        assert!(remember_action(&mut seen, "a1", t0)); // primeira vez
        assert!(!remember_action(&mut seen, "a1", t0)); // repetição: dedupe
        assert!(remember_action(&mut seen, "a2", t0)); // id diferente passa
        // fora da janela: o mesmo id volta a valer (retry legítimo tardio)
        let depois = t0 + ACTION_DEDUPE_TTL + Duration::from_secs(1);
        assert!(remember_action(&mut seen, "a1", depois));
        // teto: nunca cresce sem limite (o mais antigo cai)
        let mut cheio = Vec::new();
        for i in 0..(ACTION_DEDUPE_CAP + 10) {
            assert!(remember_action(&mut cheio, &format!("id-{i}"), t0));
        }
        assert!(cheio.len() <= ACTION_DEDUPE_CAP);
    }

    #[test]
    fn c2_forget_action_devolve_o_retry_apos_400() {
        // revisão C2 §3: 400 não pode envenenar o id — esquecido, o retry
        // corrigido com o MESMO actionId volta a ser aceito.
        let mut seen = Vec::new();
        let t0 = Instant::now();
        assert!(remember_action(&mut seen, "a1", t0));
        assert!(!remember_action(&mut seen, "a1", t0));
        forget_action(&mut seen, "a1");
        assert!(remember_action(&mut seen, "a1", t0));
        // esquecer id desconhecido é inócuo
        forget_action(&mut seen, "fantasma");
        assert!(!remember_action(&mut seen, "a1", t0));
    }

    #[test]
    fn c2_pagina_fala_o_vocabulario_de_lancamento_e_resultado() {
        // a página lança tarefa pelo vocabulário whitelisted e escuta o
        // veredito honesto (action-result) — nada de sucesso fingido no 202.
        assert!(COMPANION_PAGE.contains("launch_task"));
        assert!(COMPANION_PAGE.contains("action-result"));
        // parar turno respeita o caso não-interrompível (copy honesta)
        assert!(COMPANION_PAGE.contains("stopDisposition") || COMPANION_PAGE.contains("finalizando"));
    }

    // ── C3: janela do fio no servidor + blob de imagem do fio ──

    #[test]
    fn c3_window_items_devolve_a_cauda_por_padrao() {
        // fio grande NUNCA viaja inteiro: default = últimos CONV_WINDOW_DEFAULT
        let items: Vec<Value> = (0..150).map(|i| json!({"i": i})).collect();
        let (win, start, total) = window_items(&items, CONV_WINDOW_DEFAULT, None);
        assert_eq!(total, 150);
        assert_eq!(win.len(), CONV_WINDOW_DEFAULT);
        assert_eq!(start, 150 - CONV_WINDOW_DEFAULT);
        assert_eq!(win[0]["i"], json!(start));
        assert_eq!(win.last().unwrap()["i"], json!(149));
        // fio menor que a janela: vem inteiro, start 0
        let poucos: Vec<Value> = (0..5).map(|i| json!({"i": i})).collect();
        let (win, start, total) = window_items(&poucos, CONV_WINDOW_DEFAULT, None);
        assert_eq!((win.len(), start, total), (5, 0, 5));
    }

    #[test]
    fn c3_window_items_pagina_pra_tras_com_before() {
        let items: Vec<Value> = (0..150).map(|i| json!({"i": i})).collect();
        // primeira página: cauda [90..150); anterior: before=90 → [30..90)
        let (win, start, _) = window_items(&items, 60, Some(90));
        assert_eq!(start, 30);
        assert_eq!(win[0]["i"], json!(30));
        assert_eq!(win.last().unwrap()["i"], json!(89));
        // chegando no começo: before=30 → [0..30), janela parcial
        let (win, start, _) = window_items(&items, 60, Some(30));
        assert_eq!((win.len(), start), (30, 0));
        // before=0 → vazio (não há nada antes do início)
        let (win, start, _) = window_items(&items, 60, Some(0));
        assert!(win.is_empty());
        assert_eq!(start, 0);
        // before além do fim: clampa no total (nunca panica)
        let (win, _, _) = window_items(&items, 60, Some(9999));
        assert_eq!(win.last().unwrap()["i"], json!(149));
    }

    #[test]
    fn c3_window_items_respeita_o_cap_de_limit() {
        let items: Vec<Value> = (0..500).map(|i| json!({"i": i})).collect();
        // limit acima do cap é clampado (celular nunca pede o fio inteiro)
        let (win, _, _) = window_items(&items, 10_000, None);
        assert_eq!(win.len(), CONV_WINDOW_MAX);
        // limit 0 não devolve janela vazia por acidente (clamp mínimo 1)
        let (win, _, _) = window_items(&items, 0, None);
        assert_eq!(win.len(), 1);
    }

    #[test]
    fn c3_blob_path_parts_allowlist_fechada() {
        // caminhos REAIS do fio desta máquina (anexo + evidência de tool)
        let ok = blob_path_parts(
            "attachments",
            "16b3735b-0552-4162-96d2-71bc034944eb",
            "d82ead1887fb803b.png",
        );
        assert_eq!(ok.unwrap().3, "image/png");
        let ok = blob_path_parts(
            "evidence",
            "d5fea167-493d-4c77-a93f-6e7df5a256fb",
            "toolu_01Wwmz5Hn1KbU1wrm35LrjvT-0.jpg",
        );
        assert_eq!(ok.unwrap().3, "image/jpeg");
        assert_eq!(blob_path_parts("attachments", "abc", "x.pdf").unwrap().3, "application/pdf");
        // raiz fora das duas conhecidas nunca passa
        assert!(blob_path_parts("secrets", "abc", "x.png").is_none());
        assert!(blob_path_parts("", "abc", "x.png").is_none());
        // conversa só hex/uuid; arquivo só alfabeto seguro, sem traversal
        assert!(blob_path_parts("attachments", "../etc", "x.png").is_none());
        assert!(blob_path_parts("attachments", "abc", "../../db.sqlite").is_none());
        assert!(blob_path_parts("attachments", "abc", "a..b.png").is_none());
        assert!(blob_path_parts("attachments", "abc", "a/b.png").is_none());
        assert!(blob_path_parts("attachments", "", "x.png").is_none());
        assert!(blob_path_parts("attachments", "abc", "").is_none());
        // extensão fora da allowlist (executável, svg com script) não serve
        assert!(blob_path_parts("attachments", "abc", "x.sh").is_none());
        assert!(blob_path_parts("attachments", "abc", "x.svg").is_none());
        assert!(blob_path_parts("attachments", "abc", "semext").is_none());
    }

    #[test]
    fn c3_pagina_e_core_falam_o_vocabulario_do_fio() {
        // a página pagina o fio ("carregar anteriores"), pinta markdown pelo
        // núcleo puro e busca blobs autenticados (data-blob → fetch → objectURL)
        assert!(COMPANION_PAGE.contains("Carregar anteriores"));
        assert!(COMPANION_PAGE.contains("renderMarkdown"));
        assert!(COMPANION_PAGE.contains("data-blob"));
        for f in [
            "renderMarkdown",
            "mergeThreadTail",
            "mergeThreadOlder",
            "elapsedLabel",
            "blobUrlPath",
        ] {
            assert!(COMPANION_CORE.contains(f), "core.js sem {f}");
        }
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

    // ── C4: pareamento v2 (máquina de estados pura) ──

    const PAIR_TOK: &str = "1122334455667788aabbccddeeff0011";

    fn board_with_qr(at: Instant) -> PairingBoard {
        PairingBoard {
            qr: Some((PAIR_TOK.into(), at)),
            pending: Vec::new(),
        }
    }

    #[test]
    fn c4_sanitize_device_name_limpa_entrada_hostil() {
        assert_eq!(sanitize_device_name("iPhone · Safari"), "iPhone · Safari");
        assert_eq!(sanitize_device_name("  "), "Aparelho");
        assert_eq!(sanitize_device_name(""), "Aparelho");
        // controle some, tamanho tem teto
        assert_eq!(sanitize_device_name("a\u{0}b\nc"), "abc");
        assert_eq!(sanitize_device_name(&"x".repeat(200)).chars().count(), 48);
    }

    #[test]
    fn c4_claim_consome_o_token_de_uso_unico() {
        let t0 = Instant::now();
        let mut b = board_with_qr(t0);
        // primeiro claim passa e CONSOME o QR
        let id = claim_pairing(&mut b, PAIR_TOK, "iPhone", t0, 1_000, "pid-1".into()).unwrap();
        assert_eq!(id, "pid-1");
        assert!(b.qr.is_none(), "token do QR precisa morrer no 1º uso");
        // segundo claim com o MESMO token do QR falha (uso único de verdade)
        assert!(claim_pairing(&mut b, PAIR_TOK, "outro", t0, 1_000, "pid-2".into()).is_err());
        // token errado nunca passa
        let mut b2 = board_with_qr(t0);
        assert!(claim_pairing(&mut b2, "deadbeef", "x", t0, 0, "pid-3".into()).is_err());
        assert!(b2.qr.is_some(), "claim inválido não consome o QR");
    }

    #[test]
    fn c4_qr_expirado_recusa_claim_e_rotaciona() {
        let t0 = Instant::now();
        let velho = t0 + PAIR_QR_TTL + Duration::from_secs(1);
        let mut b = board_with_qr(t0);
        assert!(claim_pairing(&mut b, PAIR_TOK, "x", velho, 0, "pid".into()).is_err());
        // current_qr_token cunha um novo quando o corrente expirou
        let novo = current_qr_token(&mut b, velho, || "novohex".into());
        assert_eq!(novo, "novohex");
        // e REUSA enquanto fresco (o QR fica estável na tela)
        assert_eq!(current_qr_token(&mut b, velho, || "outro".into()), "novohex");
    }

    #[test]
    fn c4_pareamento_sem_aceite_morre_na_janela() {
        let t0 = Instant::now();
        let mut b = board_with_qr(t0);
        claim_pairing(&mut b, PAIR_TOK, "iPhone", t0, 0, "pid-1".into()).unwrap();
        // dentro da janela: pending
        assert!(matches!(poll_pairing(&mut b, "pid-1", t0), PairPoll::Pending));
        // passou a janela SEM gesto humano: o pareamento morre (fail-closed)
        let tarde = t0 + PAIR_DECIDE_TTL + Duration::from_secs(1);
        assert!(matches!(poll_pairing(&mut b, "pid-1", tarde), PairPoll::Gone));
        // e o aceite tardio não ressuscita nada
        assert!(decide_pairing(&mut b, "pid-1", true, "tok".into(), tarde).is_none());
    }

    #[test]
    fn c4_aceite_cunha_token_e_o_poll_entrega() {
        let t0 = Instant::now();
        let mut b = board_with_qr(t0);
        claim_pairing(&mut b, PAIR_TOK, "iPhone · Safari", t0, 0, "pid-1".into()).unwrap();
        // antes do aceite, NENHUM poll vê token
        assert!(matches!(poll_pairing(&mut b, "pid-1", t0), PairPoll::Pending));
        let (name, tok) = decide_pairing(&mut b, "pid-1", true, "tok-definitivo".into(), t0).unwrap();
        assert_eq!(name, "iPhone · Safari");
        assert_eq!(tok.as_deref(), Some("tok-definitivo"));
        match poll_pairing(&mut b, "pid-1", t0) {
            PairPoll::Approved(t) => assert_eq!(t, "tok-definitivo"),
            _ => panic!("poll pós-aceite deveria entregar o token"),
        }
        // decidir de novo é None (gesto não se repete)
        assert!(decide_pairing(&mut b, "pid-1", false, "x".into(), t0).is_none());
        // o registro decidido some depois do TTL de resultado
        let depois = t0 + PAIR_RESULT_TTL + Duration::from_secs(1);
        assert!(matches!(poll_pairing(&mut b, "pid-1", depois), PairPoll::Gone));
    }

    #[test]
    fn c4_recusa_no_desktop_chega_ao_poll() {
        let t0 = Instant::now();
        let mut b = board_with_qr(t0);
        claim_pairing(&mut b, PAIR_TOK, "Android", t0, 0, "pid-1".into()).unwrap();
        let (_, tok) = decide_pairing(&mut b, "pid-1", false, "nunca-usado".into(), t0).unwrap();
        assert!(tok.is_none(), "recusa nunca entrega token");
        assert!(matches!(poll_pairing(&mut b, "pid-1", t0), PairPoll::Denied));
        // poll de id desconhecido nunca vaza estado alheio
        assert!(matches!(poll_pairing(&mut b, "fantasma", t0), PairPoll::Gone));
    }

    #[test]
    fn c4_auth_set_casa_legado_e_por_aparelho() {
        let a = AuthSet {
            legacy: Some(TOK.into()),
            devices: vec![Device {
                id: "dev-1".into(),
                name: "iPhone".into(),
                token: "feedfacefeedfacefeedfacefeedface".into(),
                paired_at: 1,
                last_seen_at: None,
            }],
        };
        assert_eq!(a.match_token(TOK).as_deref(), Some("legacy"));
        assert_eq!(
            a.match_token("feedfacefeedfacefeedfacefeedface").as_deref(),
            Some("dev-1")
        );
        assert!(a.match_token("0000000000000000").is_none());
        // sem legado, o token antigo morre de verdade
        let sem_legado = AuthSet {
            legacy: None,
            devices: a.devices.clone(),
        };
        assert!(sem_legado.match_token(TOK).is_none());
    }

    #[tokio::test]
    async fn c4_guard_aceita_token_de_aparelho_e_revogacao_vale_na_hora() {
        let dev_tok = "feedfacefeedfacefeedfacefeedface";
        let auth = Arc::new(Mutex::new(AuthSet {
            legacy: Some(TOK.into()),
            devices: vec![Device {
                id: "dev-1".into(),
                name: "iPhone".into(),
                token: dev_tok.into(),
                paired_at: 1,
                last_seen_at: None,
            }],
        }));
        let r = guarded_router(Guard::with_auth(auth.clone()));
        // legado e aparelho passam
        assert_eq!(
            hit(&r, "/api/ping", Some(&format!("Bearer {TOK}"))).await,
            StatusCode::OK
        );
        assert_eq!(
            hit(&r, "/api/ping", Some(&format!("Bearer {dev_tok}"))).await,
            StatusCode::OK
        );
        // guard carimba o visto-por-último do APARELHO (não do legado)
        assert!(auth.lock().unwrap().devices[0].last_seen_at.is_some());
        // revogação individual SEM restart: sai do set vivo → 401 na hora
        auth.lock().unwrap().devices.clear();
        assert_eq!(
            hit(&r, "/api/ping", Some(&format!("Bearer {dev_tok}"))).await,
            StatusCode::UNAUTHORIZED
        );
        // o legado segue até ser revogado, e a revogação dele também é viva
        assert_eq!(
            hit(&r, "/api/ping", Some(&format!("Bearer {TOK}"))).await,
            StatusCode::OK
        );
        auth.lock().unwrap().legacy = None;
        assert_eq!(
            hit(&r, "/api/ping", Some(&format!("Bearer {TOK}"))).await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[test]
    fn c4_dedupe_por_aparelho_nao_despeja_id_alheio() {
        // revisão C2 §4: o teto de 256 ids agora é POR aparelho — o aparelho A
        // inundando o próprio registro não derruba o id pendente do aparelho B.
        let mut m: HashMap<String, Vec<(String, Instant)>> = HashMap::new();
        let t0 = Instant::now();
        assert!(remember_action(m.entry("b".into()).or_default(), "id-do-b", t0));
        for i in 0..(ACTION_DEDUPE_CAP + 50) {
            remember_action(m.entry("a".into()).or_default(), &format!("flood-{i}"), t0);
        }
        // o registro do B está intacto: o mesmo id continua deduplicado
        assert!(!remember_action(m.entry("b".into()).or_default(), "id-do-b", t0));
        // e o teto do A vale só pro A
        assert!(m.get("a").unwrap().len() <= ACTION_DEDUPE_CAP);
    }

    #[test]
    fn c4_pagina_fala_o_vocabulario_do_pareamento_v2() {
        // a página troca o token de uso único pelo definitivo via /pair e NUNCA
        // instala credencial vinda de fragment #token= (downgrade fechado)
        assert!(COMPANION_PAGE.contains("/pair/claim"));
        assert!(COMPANION_PAGE.contains("/pair/status/"));
        assert!(COMPANION_PAGE.contains("#pair=") || COMPANION_PAGE.contains("pairTokenFromHash"));
        assert!(
            !COMPANION_PAGE.contains("token=([0-9a-fA-F]"),
            "fragment #token= (v1) não pode mais instalar credencial"
        );
        for f in ["pairTokenFromHash", "deviceLabel"] {
            assert!(COMPANION_CORE.contains(f), "core.js sem {f}");
        }
    }
}
