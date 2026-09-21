//! H0 — receptor LOCAL de hooks/statusline (hooks-plan §3, materializado pela
//! frente do medidor de janela de uso).
//!
//! Substrato REUSÁVEL: um endpoint HTTP em loopback (porta efêmera + token
//! bearer) com rota por motor (`POST /hook/<engine>`), que scripts instalados
//! nos CLIs usam pra empurrar payloads pro app. Hoje a ÚNICA rota consumidora
//! é a statusline do claude (rate_limits → usage_window::ingest_statusline);
//! os hooks de status/permissão (H1/H2 do hooks-plan) plugam AQUI depois, sem
//! mudar o contrato do script.
//!
//! Contrato com os scripts (fail-open por construção, padrão Orca/Xirp):
//!   • o script lê `hook-endpoint.json` (arquivo 0600 no app_data_dir) a cada
//!     invocação; app fechado ⇒ porta morta ⇒ curl falha em <1s e o script
//!     sai 0 — a statusline do usuário NUNCA quebra nem atrasa por nossa causa.
//!   • payload que o receptor não entende é 204 ACEITO-E-IGNORADO: erro HTTP
//!     nunca vira ruído no CLI do usuário (o único 4xx é token errado).
//!   • token rotaciona a CADA BOOT (reescreve o arquivo); o script referencia
//!     só o PATH estável — rotação não exige reinstalação.

use crate::usage_window;
use axum::{
    body::Bytes,
    extract::{Path as AxumPath, State},
    http::{header, HeaderMap, StatusCode},
    routing::post,
    Router,
};
use serde_json::Value;
use tauri::{AppHandle, Manager};

/// Nome do arquivo de estado que os scripts leem (porta + token).
pub const ENDPOINT_FILE: &str = "hook-endpoint.json";

#[derive(Clone)]
struct Ctx {
    app: AppHandle,
    token: String,
}

/// Caminho do arquivo de estado (também usado pelo instalador da statusline,
/// que embute o path no script gerado).
pub fn endpoint_file(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("sem app_data_dir: {e}"))?
        .join(ENDPOINT_FILE))
}

fn hex_random(n_bytes: usize) -> String {
    use rand::Rng;
    let mut b = vec![0u8; n_bytes];
    rand::rng().fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Comparação em tempo constante (mesma postura do companion: não vaza
/// prefixo do token por timing).
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

/// Grava o arquivo de estado com 0600 DESDE A CRIAÇÃO (token local: variante
/// privada do fsx — o tmp já nasce com o modo certo, sem janela de chmod).
fn write_endpoint_file(app: &AppHandle, port: u16, token: &str) -> Result<(), String> {
    let path = endpoint_file(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let body = serde_json::json!({
        "port": port,
        "token": token,
        "startedAt": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
    })
    .to_string();
    crate::fsx::write_atomic_private(&path, &body)
}

/// Header com o EVENTO do hook (setado pelo script gerado; necessário pro
/// dialeto do agy, cujo payload não carrega o nome do evento).
const EVENT_HEADER: &str = "x-frota-event";
/// Header com o run id do app (env `FROTA_RUN_ID` herdada pelo hook):
/// presente = run spawnado pelo PRÓPRIO app → não é sessão externa.
const RUN_HEADER: &str = "x-frota-run";

/// Os nomes LEGADOS dos dois headers. O snippet instalado em
/// `~/.claude/settings.json` de cada máquina manda `X-Mycockpit-*`, e ele não
/// se atualiza sozinho. Sem aceitar os dois, o hook antigo continuaria POSTando
/// e o app o descartaria SEM ERRO NA TELA: turno sem hook, ninguém sabe por
/// quê. Isso é "rodando falso", que a casa proíbe (ADR-222).
const EVENT_HEADER_LEGADO: &str = "x-mycockpit-event";
const RUN_HEADER_LEGADO: &str = "x-mycockpit-run";

fn header_str(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)?
        .to_str()
        .ok()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// POST /hook/{engine} — a única rota. Token errado = 401 (o único erro que o
/// script pode ver; ele engole). Pedido de PERMISSÃO (H2) é o único caminho
/// SÍNCRONO: a resposta HTTP fica presa até a decisão humana (ou o teto de
/// 30s ⇒ `ask`) e o corpo é o stdout que o script pipa pro CLI. Qualquer
/// outro payload autenticado = 204: os consumidores são a statusline
/// (rate_limits → snapshot de janela) e os hooks de status (H1 →
/// hook_sessions); o resto é aceito-e-ignorado de propósito.
///
/// Superfície LOCAL, mesmo modelo de ameaça do H0: loopback + token 0600 no
/// hook-endpoint.json. O caminho de permissão segura uma conexão por até 30s —
/// um processo do MESMO usuário que já leu o token poderia abrir várias e
/// prender tasks, mas nesse ponto ele já executa código como o usuário (a
/// fronteira real é o usuário do SO, não este socket, como no `approval.rs`).
/// Não bloqueia: DoS local por quem já é local não muda o modelo de ameaça.
async fn hook_post(
    State(ctx): State<Ctx>,
    AxumPath(engine): AxumPath<String>,
    headers: HeaderMap,
    body: Bytes,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    match bearer(&headers) {
        Some(t) if token_eq(&t, &ctx.token) => {}
        _ => return StatusCode::UNAUTHORIZED.into_response(),
    }
    let Ok(payload) = serde_json::from_slice::<Value>(&body) else {
        // corpo não-JSON: aceito-e-ignorado (fail-open do lado do script).
        return StatusCode::NO_CONTENT.into_response();
    };
    let run = header_str(&headers, RUN_HEADER)
        .or_else(|| header_str(&headers, RUN_HEADER_LEGADO));
    let event = header_str(&headers, EVENT_HEADER)
        .or_else(|| header_str(&headers, EVENT_HEADER_LEGADO));
    // H2 — permissão síncrona: se ESTE payload é o evento de permissão do
    // dialeto, o round-trip segura a resposta até a decisão humana.
    if let Some(decision) = crate::hook_sessions::permission_roundtrip(
        &ctx.app,
        &engine,
        run.as_deref(),
        event.as_deref(),
        &payload,
    )
    .await
    {
        return (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/json")],
            decision,
        )
            .into_response();
    }
    let ingested = usage_window::ingest_statusline(&ctx.app, &engine, &payload)
        || crate::hook_sessions::ingest(
            &ctx.app,
            &engine,
            run.as_deref(),
            event.as_deref(),
            &payload,
        );
    if !ingested {
        log::debug!("hook_gateway: payload de {engine} sem consumidor (ok)");
    }
    StatusCode::NO_CONTENT.into_response()
}

/// Sobe o receptor no boot: loopback + porta efêmera + token novo por boot.
/// Falha de bind/arquivo NÃO derruba o boot (o medidor degrada: sem push da
/// statusline, o codex ainda faz poll) — mas fica logada, nunca engolida.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::bind(("127.0.0.1", 0)).await {
            Ok(l) => l,
            Err(e) => {
                log::warn!("hook_gateway: bind em loopback falhou ({e}); receptor desligado");
                return;
            }
        };
        let port = match listener.local_addr() {
            Ok(a) => a.port(),
            Err(e) => {
                log::warn!("hook_gateway: sem local_addr ({e}); receptor desligado");
                return;
            }
        };
        let token = hex_random(32);
        if let Err(e) = write_endpoint_file(&app, port, &token) {
            log::warn!("hook_gateway: falha ao gravar {ENDPOINT_FILE} ({e}); receptor desligado");
            return;
        }
        // Porta no ar = app vivo, provado. O disjuntor dos scripts (hooks-plan
        // §6.1) mede justamente "app vivo e MUDO", então um listener novo é a
        // refutação dele: sem isto, reiniciar o app não destravava as
        // permissões antes da janela de 5 min vencer sozinha.
        crate::hooks_install::clear_breakers(&app);
        let router = Router::new()
            .route("/hook/{engine}", post(hook_post))
            // Limite de corpo EXPLÍCITO: o payload real da statusline tem
            // ~1,3 KB; 64 KB dá folga pros hooks do H1/H2 (transcript nunca
            // viaja por aqui) sem aceitar upload arbitrário nem depender do
            // default implícito do axum (2 MB hoje, sujeito a mudar).
            .layer(axum::extract::DefaultBodyLimit::max(64 * 1024))
            .with_state(Ctx {
                app: app.clone(),
                token,
            });
        log::info!("hook_gateway: receptor local em 127.0.0.1:{port}");
        if let Err(e) = axum::serve(listener, router).await {
            log::warn!("hook_gateway: servidor caiu: {e}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_eq_em_tempo_constante_compara_certo() {
        assert!(token_eq("abc123", "abc123"));
        assert!(!token_eq("abc123", "abc124"));
        assert!(!token_eq("abc123", "abc1234")); // tamanho diferente
        assert!(!token_eq("", "x"));
    }

    #[test]
    fn bearer_extrai_do_header() {
        let mut h = HeaderMap::new();
        h.insert(header::AUTHORIZATION, "Bearer tok-xyz ".parse().unwrap());
        assert_eq!(bearer(&h).as_deref(), Some("tok-xyz"));
        let vazio = HeaderMap::new();
        assert_eq!(bearer(&vazio), None);
    }
}
