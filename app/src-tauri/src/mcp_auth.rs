//! Login OAuth 2.1 do PRÓPRIO app para MCPs remotos (fase A1 do
//! `mcp-auth-plan.md`).
//!
//! O control plane (`mcp_control.rs`) lê configuração de disco e nunca guarda
//! credencial. Isso deixava um MCP com OAuth preso ao CLI que autenticou
//! (`McpNativeReason::Oauth`). Aqui o app deixa de ser leitor e passa a ser
//! DONO da credencial: roda o fluxo inteiro (descoberta de metadata, PKCE,
//! callback em loopback, troca e refresh) e guarda o token no Keychain.
//!
//! Fronteiras que este módulo NÃO cruza:
//! - o token nunca entra em SQLite, em arquivo de config, nem em argv (por isso
//!   todo request HTTP sai por `curl --config -`, que lê headers e corpo do
//!   STDIN — ver `curl_form`);
//! - nada é escrito no `.mcp.json` do usuário;
//! - o registry continua sem credencial.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::process::Command;

/// Serviço do item no Keychain. A conta é o `server_id` do registry, então dois
/// MCPs distintos nunca compartilham credencial.
const KEYCHAIN_SERVICE: &str = "dev.vinicius.mycockpit.mcp-oauth";
/// Margem para considerar um token "expirado" antes da hora: evita mandar na
/// rede um access token que morre no meio do voo.
const EXPIRY_SKEW_SECS: i64 = 60;
const CALLBACK_TIMEOUT_SECS: u64 = 300;

// ---- configuração vinda do `.mcp.json` ------------------------------------

/// Bloco `oauth` de uma entrada `.mcp.json`, mais o endereço do próprio MCP.
///
/// Caso real que guiou o desenho (`prime-sales-hub/.mcp.json`):
/// ```json
/// "oauth": { "clientId": "…", "callbackPort": 8976, "authServerMetadataUrl": "…" }
/// ```
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OauthConfig {
    /// Cliente PRÉ-REGISTRADO, vindo do arquivo. `None` = o app registra um
    /// cliente dinamicamente no login (RFC 7591) e guarda o id junto do token.
    #[serde(default)]
    pub client_id: Option<String>,
    /// Porta fixa do callback, quando o arquivo a declara (o cliente
    /// pré-registrado costuma ter o `redirect_uri` amarrado a ela). `None` =
    /// porta livre escolhida na hora e registrada junto com o cliente.
    #[serde(default)]
    pub callback_port: Option<u16>,
    /// Atalho explícito do usuário para o metadata do AS. Quando ausente, a
    /// descoberta segue a cadeia normativa a partir do 401 do próprio MCP.
    pub auth_server_metadata_url: Option<String>,
    /// Canonical URI do MCP server — vira o `resource` (RFC 8707).
    pub resource: String,
}

/// Lê o bloco `oauth` de uma entrada bruta do `.mcp.json`.
///
/// Aceita as duas grafias (camelCase do arquivo real e snake_case) porque o
/// formato não é padronizado entre CLIs.
pub fn parse_oauth_config(raw: &Value, server_url: &str) -> Option<OauthConfig> {
    let oauth = raw.get("oauth")?;
    let pick = |camel: &str, snake: &str| -> Option<&Value> {
        oauth.get(camel).or_else(|| oauth.get(snake))
    };
    let client_id = pick("clientId", "client_id")?.as_str()?.to_string();
    if client_id.trim().is_empty() {
        return None;
    }
    let callback_port = pick("callbackPort", "callback_port")
        .and_then(Value::as_u64)
        .and_then(|port| u16::try_from(port).ok())
        .filter(|port| *port != 0)?;
    let auth_server_metadata_url = pick("authServerMetadataUrl", "auth_server_metadata_url")
        .and_then(Value::as_str)
        .map(str::to_string);
    Some(OauthConfig {
        client_id: Some(client_id),
        callback_port: Some(callback_port),
        auth_server_metadata_url,
        resource: canonical_resource(server_url),
    })
}

/// Configuração de login para um MCP HTTP que NÃO declara bloco `oauth`.
///
/// É o caso dos servidores adicionados pelo CLI do agent (`claude mcp add
/// --transport http`): o arquivo só tem a URL. A descoberta segue a cadeia
/// normativa a partir do 401 e o cliente é registrado dinamicamente; se o AS
/// não oferecer registro, o login recusa com motivo legível (ADR-201).
pub fn login_dinamico(server_url: &str) -> OauthConfig {
    OauthConfig {
        client_id: None,
        callback_port: None,
        auth_server_metadata_url: None,
        resource: canonical_resource(server_url),
    }
}

/// Canonical URI do RFC 8707: sem fragment, sem barra final.
///
/// A spec manda mandar o `resource` SEMPRE, mesmo que o AS não declare suporte,
/// então o valor precisa ser estável.
pub fn canonical_resource(url: &str) -> String {
    let sem_fragment = url.split('#').next().unwrap_or(url);
    let cortado = sem_fragment.trim_end_matches('/');
    if cortado.is_empty() {
        sem_fragment.to_string()
    } else {
        cortado.to_string()
    }
}

// ---- PKCE ------------------------------------------------------------------

/// base64url SEM padding (RFC 7636 §A). Implementado à mão: a única outra
/// dependência de base64 do grafo é transitiva e não queremos fixá-la aqui.
fn base64url(bytes: &[u8]) -> String {
    const ALFABETO: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for bloco in bytes.chunks(3) {
        let b0 = bloco[0] as u32;
        let b1 = *bloco.get(1).unwrap_or(&0) as u32;
        let b2 = *bloco.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALFABETO[(n >> 18) as usize & 63] as char);
        out.push(ALFABETO[(n >> 12) as usize & 63] as char);
        if bloco.len() > 1 {
            out.push(ALFABETO[(n >> 6) as usize & 63] as char);
        }
        if bloco.len() > 2 {
            out.push(ALFABETO[n as usize & 63] as char);
        }
    }
    out
}

/// Desafio PKCE S256 de um verifier. Função pura: é o que o teste fixa contra
/// o vetor do RFC 7636.
pub fn code_challenge_s256(verifier: &str) -> String {
    base64url(sha256(verifier.as_bytes()).as_slice())
}

/// SHA-256 mínimo (FIPS 180-4). O grafo não tem crate de sha2 direta e o blake3
/// existente não serve: PKCE S256 exige exatamente SHA-256.
fn sha256(entrada: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let bits = (entrada.len() as u64) * 8;
    let mut msg = entrada.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bits.to_be_bytes());
    for bloco in msg.chunks(64) {
        let mut w = [0u32; 64];
        for (i, palavra) in bloco.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes([palavra[0], palavra[1], palavra[2], palavra[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) =
            (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (slot, valor) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
            *slot = slot.wrapping_add(valor);
        }
    }
    let mut out = [0u8; 32];
    for (i, palavra) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&palavra.to_be_bytes());
    }
    out
}

/// Verifier aleatório de 64 chars do alfabeto unreserved (RFC 7636 §4.1).
fn novo_verifier() -> String {
    const ALFABETO: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut out = String::with_capacity(64);
    for _ in 0..64 {
        let n: usize = rand::random_range(0..ALFABETO.len());
        out.push(ALFABETO[n] as char);
    }
    out
}

fn novo_state() -> String {
    let bytes: [u8; 24] = rand::random();
    base64url(&bytes)
}

// ---- descoberta ------------------------------------------------------------

/// URL do Protected Resource Metadata anunciada no `WWW-Authenticate` do 401.
///
/// Caso real do `prime-mcp`:
/// `Bearer resource_metadata="https://…/functions/v1/mcp/.well-known/oauth-protected-resource"`
pub fn parse_resource_metadata_url(www_authenticate: &str) -> Option<String> {
    let chave = "resource_metadata=";
    let inicio = www_authenticate.find(chave)? + chave.len();
    let resto = &www_authenticate[inicio..];
    let valor = if let Some(sem_aspa) = resto.strip_prefix('"') {
        sem_aspa.split('"').next()?
    } else {
        resto.split(&[',', ' '][..]).next()?
    };
    let valor = valor.trim();
    (!valor.is_empty()).then(|| valor.to_string())
}

/// URLs de metadata do AS, na ORDEM normativa da spec MCP vigente (2026-07-28).
///
/// Para issuer COM path (`https://host/auth/v1`, o caso do prime) a ordem é
/// path-insertion primeiro, e só depois path-appending do OIDC. Sem path, as
/// duas formas na raiz.
pub fn as_metadata_urls(issuer: &str) -> Vec<String> {
    let base = issuer.trim_end_matches('/');
    let Some((origem, caminho)) = dividir_origem(base) else {
        return Vec::new();
    };
    if caminho.is_empty() {
        vec![
            format!("{origem}/.well-known/oauth-authorization-server"),
            format!("{origem}/.well-known/openid-configuration"),
        ]
    } else {
        vec![
            format!("{origem}/.well-known/oauth-authorization-server/{caminho}"),
            format!("{origem}/.well-known/openid-configuration/{caminho}"),
            format!("{origem}/{caminho}/.well-known/openid-configuration"),
        ]
    }
}

/// Separa `https://host:porta` do caminho, sem depender de crate de URL.
fn dividir_origem(url: &str) -> Option<(String, String)> {
    let (esquema, resto) = url.split_once("://")?;
    let (autoridade, caminho) = match resto.find('/') {
        Some(i) => (&resto[..i], resto[i + 1..].trim_matches('/')),
        None => (resto, ""),
    };
    if autoridade.is_empty() {
        return None;
    }
    Some((format!("{esquema}://{autoridade}"), caminho.to_string()))
}

/// Metadata do authorization server (RFC 8414 / OIDC Discovery).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AsMetadata {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub revocation_endpoint: Option<String>,
    /// RFC 7591. Presente no AS do Vercel (`vercel.com`), ausente no do prime.
    pub registration_endpoint: Option<String>,
    pub scopes_supported: Vec<String>,
    pub code_challenge_methods_supported: Vec<String>,
    pub authorization_response_iss_parameter_supported: bool,
}

/// Lê e VALIDA o metadata do AS.
///
/// Duas recusas obrigatórias da spec vigente, ambas fail-closed:
/// - `issuer` do documento diferente do issuer usado para montar a URL;
/// - ausência de `code_challenge_methods_supported` (= AS sem PKCE) ou de
///   `S256` nele. Sem PKCE não se prossegue, e o motivo vai legível pra tela.
pub fn parse_as_metadata(json: &Value, issuer_esperado: &str) -> Result<AsMetadata, String> {
    let texto = |chave: &str| json.get(chave).and_then(Value::as_str).map(str::to_string);
    let lista = |chave: &str| {
        json.get(chave)
            .and_then(Value::as_array)
            .map(|itens| {
                itens
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };
    let issuer = texto("issuer").ok_or("metadata do servidor de autorização sem `issuer`")?;
    // Comparação literal: a spec proíbe normalizar caixa, porta ou barra final
    // antes de comparar (é a defesa contra mix-up de AS).
    if issuer != issuer_esperado.trim_end_matches('/')
        && issuer.trim_end_matches('/') != issuer_esperado.trim_end_matches('/')
    {
        return Err(format!(
            "o servidor de autorização respondeu com issuer `{issuer}`, diferente de `{issuer_esperado}`; login cancelado"
        ));
    }
    let authorization_endpoint =
        texto("authorization_endpoint").ok_or("metadata sem `authorization_endpoint`")?;
    let token_endpoint = texto("token_endpoint").ok_or("metadata sem `token_endpoint`")?;
    let code_challenge_methods_supported = lista("code_challenge_methods_supported");
    if code_challenge_methods_supported.is_empty() {
        return Err(
            "o servidor de autorização não declara suporte a PKCE; a Frota não faz login sem PKCE"
                .into(),
        );
    }
    if !code_challenge_methods_supported
        .iter()
        .any(|metodo| metodo == "S256")
    {
        return Err(
            "o servidor de autorização não aceita PKCE S256; a Frota não usa `plain`".into(),
        );
    }
    Ok(AsMetadata {
        issuer,
        authorization_endpoint,
        token_endpoint,
        revocation_endpoint: texto("revocation_endpoint"),
        registration_endpoint: texto("registration_endpoint"),
        scopes_supported: lista("scopes_supported"),
        code_challenge_methods_supported,
        authorization_response_iss_parameter_supported: json
            .get("authorization_response_iss_parameter_supported")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

/// Escopos pedidos: os do PRM, mais `offline_access` SOMENTE quando o AS o
/// declara (a spec proíbe assumir refresh token).
pub fn escopos_do_login(prm_scopes: &[String], as_scopes: &[String]) -> Vec<String> {
    let mut escopos: Vec<String> = prm_scopes.to_vec();
    if escopos.is_empty() {
        escopos.push("openid".into());
    }
    if as_scopes.iter().any(|s| s == "offline_access")
        && !escopos.iter().any(|s| s == "offline_access")
    {
        escopos.push("offline_access".into());
    }
    escopos
}

fn percent_encode(valor: &str) -> String {
    let mut out = String::with_capacity(valor.len());
    for byte in valor.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(*byte as char)
            }
            outro => out.push_str(&format!("%{outro:02X}")),
        }
    }
    out
}

fn query_string(pares: &[(&str, &str)]) -> String {
    pares
        .iter()
        .map(|(chave, valor)| format!("{}={}", percent_encode(chave), percent_encode(valor)))
        .collect::<Vec<_>>()
        .join("&")
}

/// URL de autorização, com PKCE, `state` e `resource` (RFC 8707).
pub fn build_authorize_url(
    metadata: &AsMetadata,
    config: &OauthConfig,
    client_id: &str,
    redirect: &str,
    state: &str,
    challenge: &str,
    escopos: &[String],
) -> String {
    let escopo = escopos.join(" ");
    let query = query_string(&[
        ("response_type", "code"),
        ("client_id", client_id),
        ("redirect_uri", redirect),
        ("scope", &escopo),
        ("state", state),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        // MUST ser mandado sempre, mesmo que o AS não declare suporte.
        ("resource", &config.resource),
    ]);
    let separador = if metadata.authorization_endpoint.contains('?') {
        '&'
    } else {
        '?'
    };
    format!("{}{separador}{query}", metadata.authorization_endpoint)
}

/// Pedido de registro dinâmico (RFC 7591) de um cliente PÚBLICO.
///
/// `token_endpoint_auth_method: none` porque o app é um cliente nativo sem
/// segredo guardável; PKCE é a proteção. O `redirect_uri` registrado é o
/// mesmo que vai no authorize, então a porta precisa estar decidida antes.
pub fn build_registration_request(redirect: &str) -> Value {
    serde_json::json!({
        "client_name": "Frota",
        "redirect_uris": [redirect],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    })
}

/// Lê a resposta do registro. Só o `client_id` interessa: cliente público não
/// recebe segredo, e se o AS mandar um, ele é ignorado de propósito (não há
/// onde guardá-lo com honestidade fora do Keychain, e o fluxo não o usa).
pub fn parse_registration_response(status: u16, corpo: &str) -> Result<String, String> {
    let json: Value = serde_json::from_str(corpo)
        .map_err(|_| format!("registro de cliente falhou (HTTP {status})"))?;
    if !(200..300).contains(&status) {
        return Err(format!(
            "o servidor de autorização recusou o registro do cliente: {}",
            token_error_message(status, corpo)
        ));
    }
    json.get("client_id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .ok_or("resposta do registro de cliente sem `client_id`".into())
}

async fn registrar_cliente(metadata: &AsMetadata, redirect: &str) -> Result<String, String> {
    let endpoint = metadata.registration_endpoint.as_deref().ok_or(
        "este servidor exige login, mas a configuração não traz `clientId` e o servidor de autorização não oferece registro dinâmico de cliente; adicione o bloco `oauth` na configuração de origem",
    )?;
    let corpo = build_registration_request(redirect).to_string();
    let resposta = curl_json(endpoint, &corpo, &[]).await?;
    parse_registration_response(resposta.status, &resposta.corpo)
}

/// O `client_id` que vale para esta credencial: o registrado no login (viaja
/// no Keychain junto do token) ou o pré-registrado do arquivo.
fn client_id_efetivo(config: &OauthConfig, tokens: Option<&StoredTokens>) -> Result<String, String> {
    tokens
        .and_then(|t| t.client_id.clone())
        .or_else(|| config.client_id.clone())
        .ok_or_else(|| "a credencial guardada não tem client_id; faça login de novo".to_string())
}

pub fn redirect_uri(porta: u16) -> String {
    // IP literal em vez de `localhost` (RFC 8252 §7.3): evita escutar em outra
    // interface por resolução de nome.
    format!("http://127.0.0.1:{porta}/callback")
}

/// Valida a resposta de autorização ANTES de trocar o code.
///
/// Duas checagens fail-closed:
/// - `state` idêntico ao enviado (defesa de CSRF/confused deputy);
/// - `iss` conforme RFC 9207 quando presente ou quando o AS anuncia suporte —
///   é a única defesa contra mix-up, porque PKCE sozinho não protege (o cliente
///   entregaria o verifier ao token endpoint do atacante).
pub fn validate_callback(
    params: &BTreeMap<String, String>,
    state_esperado: &str,
    issuer_esperado: &str,
    iss_suportado: bool,
) -> Result<String, String> {
    let state = params.get("state").map(String::as_str).unwrap_or_default();
    if state != state_esperado {
        return Err("resposta de autorização com `state` divergente; login cancelado".into());
    }
    // O `iss` é validado antes de olhar erro ou código: numa resposta de erro
    // vinda do AS errado, nem a mensagem pode ser exibida.
    match params.get("iss") {
        Some(iss) => {
            if iss != issuer_esperado {
                return Err(format!(
                    "resposta de autorização veio do emissor `{iss}`, diferente de `{issuer_esperado}`; login cancelado"
                ));
            }
        }
        None if iss_suportado => {
            return Err(
                "o servidor de autorização declara enviar `iss` mas a resposta veio sem ele; login cancelado".into(),
            );
        }
        None => {}
    }
    if let Some(erro) = params.get("error") {
        let descricao = params
            .get("error_description")
            .map(String::as_str)
            .unwrap_or(erro.as_str());
        return Err(format!(
            "o servidor de autorização recusou o login: {descricao}"
        ));
    }
    params
        .get("code")
        .filter(|code| !code.is_empty())
        .cloned()
        .ok_or_else(|| "resposta de autorização sem código".into())
}

// ---- tokens ----------------------------------------------------------------

/// Credencial guardada no Keychain. `issuer` viaja junto porque a spec exige
/// amarrar a credencial ao AS que a emitiu e nunca reusá-la em outro.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredTokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    /// Epoch em segundos; `None` quando o AS não informa expiração.
    #[serde(default)]
    pub expires_at: Option<i64>,
    pub issuer: String,
    #[serde(default)]
    pub scope: Option<String>,
    /// `client_id` obtido por registro dinâmico no login. `None` quando o
    /// cliente veio pré-registrado do arquivo (credenciais antigas também).
    #[serde(default)]
    pub client_id: Option<String>,
}

impl StoredTokens {
    pub fn expirado(&self, agora: i64) -> bool {
        self.expires_at
            .is_some_and(|prazo| agora + EXPIRY_SKEW_SECS >= prazo)
    }
}

/// Lê a resposta do token endpoint.
///
/// `agora` é injetado para o teste fixar `expires_at` sem depender do relógio.
pub fn parse_token_response(
    json: &Value,
    issuer: &str,
    refresh_anterior: Option<&str>,
    agora: i64,
) -> Result<StoredTokens, String> {
    let access_token = json
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|token| !token.is_empty())
        .ok_or("resposta do token endpoint sem `access_token`")?
        .to_string();
    // Rotação de refresh token é MUST do AS para cliente público: o novo vence
    // o anterior sempre que vier.
    let refresh_token = json
        .get("refresh_token")
        .and_then(Value::as_str)
        .filter(|token| !token.is_empty())
        .map(str::to_string)
        .or_else(|| refresh_anterior.map(str::to_string));
    let expires_at = json
        .get("expires_in")
        .and_then(Value::as_i64)
        .map(|segundos| agora + segundos);
    Ok(StoredTokens {
        access_token,
        refresh_token,
        expires_at,
        issuer: issuer.to_string(),
        scope: json
            .get("scope")
            .and_then(Value::as_str)
            .map(str::to_string),
        client_id: None,
    })
}

/// Mensagem legível de uma falha do token endpoint.
///
/// Trata as DUAS formas observadas no endpoint real do `prime-mcp`: o formato
/// do RFC 6749 (`error`/`error_description`, devolvido na troca do code) e o
/// formato proprietário do GoTrue (`error_code`/`msg`, devolvido no refresh).
/// Um parser que só lesse a primeira forma devolveria mensagem vazia justo no
/// caminho de refresh, que é o que o usuário mais vê.
pub fn token_error_message(status: u16, corpo: &str) -> String {
    let json: Option<Value> = serde_json::from_str(corpo).ok();
    let campo = |chave: &str| -> Option<String> {
        json.as_ref()
            .and_then(|valor| valor.get(chave))
            .and_then(Value::as_str)
            .map(str::to_string)
            .filter(|texto| !texto.trim().is_empty())
    };
    if let Some(descricao) = campo("error_description").or_else(|| campo("msg")) {
        return descricao;
    }
    if let Some(codigo) = campo("error").or_else(|| campo("error_code")) {
        return codigo;
    }
    format!("o servidor de autorização respondeu HTTP {status}")
}

// ---- estado exposto à UI ---------------------------------------------------

/// Estado do login do app para um servidor MCP.
///
/// `Expirado` é um estado de verdade, não um erro escondido: o token existe mas
/// não serve mais, e a tela precisa pedir login de novo em vez de mentir
/// "conectado".
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum McpAuthState {
    SemLogin,
    Conectado,
    Expirado,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAuthStatus {
    pub server_id: String,
    pub state: McpAuthState,
    /// Só metadado: quando expira. NUNCA o token.
    pub expires_at: Option<i64>,
    pub scope: Option<String>,
    /// `false` quando o AS não expõe `revocation_endpoint`: "Sair" apaga a
    /// credencial deste Mac, mas não consegue revogar no servidor.
    pub revogavel: bool,
}

/// Estado derivado da credencial guardada. Função pura: é o que o teste fixa.
///
/// Um access token vencido é `Expirado` mesmo havendo refresh token. Reportar
/// "conectado" porque *talvez* dê para renovar seria estado inventado: quem
/// quiser prometer conexão renova primeiro e pergunta depois (é o que
/// `mcp_oauth_status` faz).
pub fn estado_de(tokens: Option<&StoredTokens>, agora: i64) -> McpAuthState {
    match tokens {
        None => McpAuthState::SemLogin,
        Some(t) if t.expirado(agora) => McpAuthState::Expirado,
        Some(_) => McpAuthState::Conectado,
    }
}

// ---- Keychain --------------------------------------------------------------
//
// LIMITE HONESTO, verificado nesta máquina: com o app assinado ad-hoc
// (linker-signed, sem Team ID), o item do Keychain NÃO fica isolado por
// aplicativo — qualquer processo do mesmo usuário consegue lê-lo. O Keychain
// entrega aqui: token fora do SQLite, fora de arquivo de config, fora de argv,
// cifrado em repouso e apagável num gesto. Ele NÃO entrega, sem Developer ID,
// isolamento entre apps. Registrado no plano; o conserto é o mesmo do ADR-013.

fn entry(server_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, server_id)
        .map_err(|e| format!("Keychain indisponível: {e}"))
}

/// Cópia em memória do que está no Keychain, por `server_id`.
///
/// Cada leitura do Keychain pode virar um prompt de senha (quando a ACL do item
/// não reconhece o build, ADR-201). Antes, uma abertura da tela de MCPs fazia
/// uma leitura por servidor × agent na descoberta, mais uma por servidor no
/// status, mais outras no plano do turno: prompts em fila. Agora o Keychain é
/// lido UMA vez por servidor por processo; gravar e apagar passam por aqui e
/// mantêm a cópia igual ao disco. O plano já admite "Keychain + memória do
/// processo" como os dois únicos lugares da credencial.
fn cache() -> &'static Mutex<HashMap<String, Option<StoredTokens>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<StoredTokens>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn ler_keychain(server_id: &str) -> Result<Option<StoredTokens>, String> {
    match entry(server_id)?.get_password() {
        Ok(blob) => serde_json::from_str(&blob)
            .map(Some)
            .map_err(|e| format!("credencial guardada ilegível (faça login de novo): {e}")),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("falha ao ler o Keychain: {e}")),
    }
}

pub fn load_tokens(server_id: &str) -> Result<Option<StoredTokens>, String> {
    if let Ok(guard) = cache().lock() {
        if let Some(tokens) = guard.get(server_id) {
            return Ok(tokens.clone());
        }
    }
    let lido = ler_keychain(server_id)?;
    // Só a leitura que DEU CERTO entra no cache: erro de Keychain (recusa,
    // item ilegível) precisa ser tentado de novo na próxima, não congelado.
    if let Ok(mut guard) = cache().lock() {
        guard.insert(server_id.to_string(), lido.clone());
    }
    Ok(lido)
}

fn lembrar(server_id: &str, tokens: Option<StoredTokens>) {
    if let Ok(mut guard) = cache().lock() {
        guard.insert(server_id.to_string(), tokens);
    }
}

/// Existe credencial do app para este servidor?
///
/// Só a EXISTÊNCIA, sem tocar no valor: é o que o roteamento (A2) precisa para
/// decidir se o servidor deixa de ser nativo-apenas. Falha de Keychain vira
/// `false` — fail-closed, o servidor segue barrado.
pub fn tem_credencial(server_id: &str) -> bool {
    matches!(load_tokens(server_id), Ok(Some(_)))
}

pub fn save_tokens(server_id: &str, tokens: &StoredTokens) -> Result<(), String> {
    let blob = serde_json::to_string(tokens)
        .map_err(|e| format!("falha ao serializar credencial: {e}"))?;
    entry(server_id)?
        .set_password(&blob)
        .map_err(|e| format!("falha ao gravar no Keychain: {e}"))?;
    lembrar(server_id, Some(tokens.clone()));
    Ok(())
}

pub fn delete_tokens(server_id: &str) -> Result<(), String> {
    match entry(server_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {
            lembrar(server_id, None);
            Ok(())
        }
        Err(e) => Err(format!("falha ao apagar do Keychain: {e}")),
    }
}

// ---- HTTP ------------------------------------------------------------------

pub struct HttpResposta {
    pub status: u16,
    pub corpo: String,
    pub headers: String,
}

/// POST de formulário via `curl --config -`.
///
/// O arquivo de configuração vai pelo STDIN, então NENHUM valor (code_verifier,
/// refresh_token, access_token) aparece em `ps`, em argv ou em arquivo — é o
/// que sustenta a garantia central do plano. Verificado: `ps` mostra apenas
/// `curl --config -`.
pub async fn curl_form(
    url: &str,
    campos: &[(&str, &str)],
    headers_extra: &[(&str, &str)],
) -> Result<HttpResposta, String> {
    let corpo = query_string(campos);
    let mut config = String::new();
    config.push_str(&format!("url = {}\n", aspas(url)));
    config.push_str(&format!(
        "header = {}\n",
        aspas("Content-Type: application/x-www-form-urlencoded")
    ));
    for (nome, valor) in headers_extra {
        config.push_str(&format!(
            "header = {}\n",
            aspas(&format!("{nome}: {valor}"))
        ));
    }
    config.push_str(&format!("data = {}\n", aspas(&corpo)));
    config.push_str("silent\nshow-error\ndump-header = \"/dev/stderr\"\n");
    config.push_str("write-out = \"\\n%{http_code}\"\nmax-time = 30\n");
    curl_config(&config).await
}

/// POST de corpo JSON com headers arbitrários, pelo MESMO caminho de STDIN.
///
/// É o que o proxy (A2) usa para repassar JSON-RPC com `Authorization: Bearer`:
/// o header vai no config lido do STDIN, então o token não aparece em `ps`.
pub async fn curl_json(
    url: &str,
    corpo: &str,
    headers_extra: &[(String, String)],
) -> Result<HttpResposta, String> {
    let mut config = String::new();
    config.push_str(&format!("url = {}\n", aspas(url)));
    config.push_str(&format!(
        "header = {}\n",
        aspas("Content-Type: application/json")
    ));
    for (nome, valor) in headers_extra {
        config.push_str(&format!(
            "header = {}\n",
            aspas(&format!("{nome}: {valor}"))
        ));
    }
    config.push_str(&format!("data = {}\n", aspas(corpo)));
    config.push_str("silent\nshow-error\ndump-header = \"/dev/stderr\"\n");
    config.push_str("write-out = \"\\n%{http_code}\"\nmax-time = 120\n");
    curl_config(&config).await
}

/// GET simples. Sem segredo envolvido, mas passa pelo mesmo caminho para não
/// existirem dois jeitos de falar HTTP neste módulo.
pub async fn curl_get(url: &str) -> Result<HttpResposta, String> {
    let config = format!(
        "url = {}\nsilent\nshow-error\ndump-header = \"/dev/stderr\"\nwrite-out = \"\\n%{{http_code}}\"\nmax-time = 30\n",
        aspas(url)
    );
    curl_config(&config).await
}

fn aspas(valor: &str) -> String {
    format!("\"{}\"", valor.replace('\\', "\\\\").replace('"', "\\\""))
}

async fn curl_config(config: &str) -> Result<HttpResposta, String> {
    let mut filho = Command::new("curl")
        .arg("--config")
        .arg("-")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("falha ao executar curl: {e}"))?;
    if let Some(mut stdin) = filho.stdin.take() {
        stdin
            .write_all(config.as_bytes())
            .await
            .map_err(|e| format!("falha ao enviar configuração ao curl: {e}"))?;
        stdin
            .shutdown()
            .await
            .map_err(|e| format!("falha ao fechar stdin do curl: {e}"))?;
    }
    let saida = filho
        .wait_with_output()
        .await
        .map_err(|e| format!("falha ao ler resposta do curl: {e}"))?;
    let bruto = String::from_utf8_lossy(&saida.stdout).to_string();
    let (corpo, status) = match bruto.rsplit_once('\n') {
        Some((corpo, status)) => (corpo.to_string(), status.trim().parse::<u16>().unwrap_or(0)),
        None => (bruto.clone(), 0),
    };
    if status == 0 {
        let erro = String::from_utf8_lossy(&saida.stderr);
        let motivo = erro
            .lines()
            .find(|linha| linha.starts_with("curl:"))
            .unwrap_or("resposta HTTP ilegível");
        return Err(motivo.to_string());
    }
    Ok(HttpResposta {
        status,
        corpo,
        headers: String::from_utf8_lossy(&saida.stderr).to_string(),
    })
}

// ---- callback em loopback --------------------------------------------------

/// Query string de uma request line HTTP (`GET /callback?a=1 HTTP/1.1`).
pub fn parse_callback_query(request_line: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    let Some(alvo) = request_line.split_whitespace().nth(1) else {
        return out;
    };
    let Some((_, query)) = alvo.split_once('?') else {
        return out;
    };
    for par in query.split('&') {
        if let Some((chave, valor)) = par.split_once('=') {
            out.insert(percent_decode(chave), percent_decode(valor));
        }
    }
    out
}

fn percent_decode(valor: &str) -> String {
    let bytes = valor.replace('+', " ").into_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&String::from_utf8_lossy(&bytes[i + 1..i + 3]), 16)
            {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Escuta UMA resposta de autorização em `127.0.0.1:<porta>` e devolve os
/// parâmetros. Fecha o listener em seguida — nada fica escutando depois.
/// Sobe o listener do callback. Porta fixa quando o arquivo a declara (o
/// cliente pré-registrado está amarrado a ela); senão uma porta livre, que
/// vai para o registro dinâmico junto do cliente.
async fn abrir_callback(porta: Option<u16>) -> Result<(TcpListener, u16), String> {
    let pedida = porta.unwrap_or(0);
    let listener = TcpListener::bind(("127.0.0.1", pedida)).await.map_err(|e| {
        format!("não consegui escutar em 127.0.0.1:{pedida} para receber o login ({e}); feche quem estiver usando a porta e tente de novo")
    })?;
    let porta = listener
        .local_addr()
        .map_err(|e| format!("não consegui descobrir a porta do callback: {e}"))?
        .port();
    Ok((listener, porta))
}

async fn esperar_callback(listener: TcpListener) -> Result<BTreeMap<String, String>, String> {
    let aceitar = async {
        loop {
            let (mut stream, _) = listener
                .accept()
                .await
                .map_err(|e| format!("falha ao aceitar o retorno do login: {e}"))?;
            let mut buf = vec![0u8; 8192];
            let lidos = stream
                .read(&mut buf)
                .await
                .map_err(|e| format!("falha ao ler o retorno do login: {e}"))?;
            let texto = String::from_utf8_lossy(&buf[..lidos]).to_string();
            let primeira = texto.lines().next().unwrap_or_default();
            // O navegador pede /favicon.ico junto; só o /callback interessa.
            if !primeira.contains("/callback") {
                let _ = stream.write_all(RESPOSTA_404.as_bytes()).await;
                continue;
            }
            let params = parse_callback_query(primeira);
            let corpo = if params.contains_key("code") {
                pagina("Login concluído", "Pode voltar à Frota.")
            } else {
                pagina("Login não concluído", "Volte à Frota para ver o motivo.")
            };
            let _ = stream.write_all(corpo.as_bytes()).await;
            let _ = stream.flush().await;
            return Ok(params);
        }
    };
    match tokio::time::timeout(
        std::time::Duration::from_secs(CALLBACK_TIMEOUT_SECS),
        aceitar,
    )
    .await
    {
        Ok(resultado) => resultado,
        Err(_) => Err("o login não foi concluído a tempo; tente de novo".into()),
    }
}

const RESPOSTA_404: &str =
    "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

fn pagina(titulo: &str, detalhe: &str) -> String {
    let html = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>{titulo}</title><body style=\"font-family:-apple-system,sans-serif;padding:3rem;text-align:center\"><h2>{titulo}</h2><p>{detalhe}</p></body>"
    );
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}",
        html.len()
    )
}

fn agora_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ---- fluxo -----------------------------------------------------------------

/// Descobre o AS a partir do endpoint MCP, honrando o atalho do config.
pub async fn descobrir_as(config: &OauthConfig) -> Result<AsMetadata, String> {
    // 1) O usuário apontou o metadata no `.mcp.json`: é uma escolha explícita
    //    dele e vence a cadeia genérica. Ainda assim o `issuer` é validado.
    if let Some(url) = &config.auth_server_metadata_url {
        let resposta = curl_get(url).await?;
        if resposta.status == 200 {
            let json: Value = serde_json::from_str(&resposta.corpo)
                .map_err(|e| format!("metadata do servidor de autorização ilegível: {e}"))?;
            let issuer = json
                .get("issuer")
                .and_then(Value::as_str)
                .ok_or("metadata do servidor de autorização sem `issuer`")?
                .to_string();
            return parse_as_metadata(&json, &issuer);
        }
    }
    // 2) Cadeia normativa: 401 do MCP → resource_metadata → authorization_servers.
    let issuers = descobrir_issuers(&config.resource).await?;
    let mut ultimo_erro = String::from("nenhum servidor de autorização encontrado");
    for issuer in issuers {
        for url in as_metadata_urls(&issuer) {
            let Ok(resposta) = curl_get(&url).await else {
                continue;
            };
            if resposta.status != 200 {
                continue;
            }
            let Ok(json) = serde_json::from_str::<Value>(&resposta.corpo) else {
                continue;
            };
            match parse_as_metadata(&json, &issuer) {
                Ok(metadata) => return Ok(metadata),
                Err(erro) => ultimo_erro = erro,
            }
        }
    }
    Err(ultimo_erro)
}

async fn descobrir_issuers(resource: &str) -> Result<Vec<String>, String> {
    let resposta = curl_form(resource, &[], &[]).await?;
    let prm_url = resposta
        .headers
        .lines()
        .find(|linha| linha.to_ascii_lowercase().starts_with("www-authenticate:"))
        .and_then(parse_resource_metadata_url)
        // Fallback normativo quando o 401 não anuncia: sub-path e depois raiz.
        .or_else(|| {
            dividir_origem(resource).map(|(origem, caminho)| {
                format!("{origem}/.well-known/oauth-protected-resource/{caminho}")
            })
        })
        .ok_or("o servidor MCP não informou onde fica o metadata de autorização")?;
    let prm = curl_get(&prm_url).await?;
    if prm.status != 200 {
        return Err(format!(
            "metadata do recurso indisponível (HTTP {})",
            prm.status
        ));
    }
    let json: Value = serde_json::from_str(&prm.corpo)
        .map_err(|e| format!("metadata do recurso ilegível: {e}"))?;
    let issuers: Vec<String> = json
        .get("authorization_servers")
        .and_then(Value::as_array)
        .map(|itens| {
            itens
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    if issuers.is_empty() {
        return Err("o metadata do recurso não lista `authorization_servers`".into());
    }
    Ok(issuers)
}

/// Roda o login inteiro e guarda a credencial no Keychain.
pub async fn login(
    app: &tauri::AppHandle,
    server_id: &str,
    config: &OauthConfig,
) -> Result<McpAuthStatus, String> {
    let metadata = descobrir_as(config).await?;
    // O listener sobe ANTES de tudo: a porta precisa existir para entrar no
    // registro do cliente e no authorize, e para o retorno do login não bater
    // numa porta fechada.
    let (listener, porta) = abrir_callback(config.callback_port).await?;
    let redirect = redirect_uri(porta);
    // Cliente pré-registrado no arquivo vence; sem ele, registro dinâmico.
    let (client_id, registrado) = match &config.client_id {
        Some(id) => (id.clone(), None),
        None => {
            let id = registrar_cliente(&metadata, &redirect).await?;
            (id.clone(), Some(id))
        }
    };
    let verifier = novo_verifier();
    let challenge = code_challenge_s256(&verifier);
    let state = novo_state();
    let escopos = escopos_do_login(&[], &metadata.scopes_supported);
    let url = build_authorize_url(
        &metadata, config, &client_id, &redirect, &state, &challenge, &escopos,
    );

    let espera = tokio::spawn(esperar_callback(listener));
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    if let Err(erro) = abrir_navegador(app, &url) {
        espera.abort();
        return Err(erro);
    }
    let params = espera
        .await
        .map_err(|_| "a espera do login foi interrompida".to_string())??;
    let code = validate_callback(
        &params,
        &state,
        &metadata.issuer,
        metadata.authorization_response_iss_parameter_supported,
    )?;

    let resposta = curl_form(
        &metadata.token_endpoint,
        &[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &redirect),
            ("client_id", &client_id),
            ("code_verifier", &verifier),
            ("resource", &config.resource),
        ],
        &[],
    )
    .await?;
    if resposta.status != 200 {
        return Err(token_error_message(resposta.status, &resposta.corpo));
    }
    let json: Value = serde_json::from_str(&resposta.corpo)
        .map_err(|e| format!("resposta do token endpoint ilegível: {e}"))?;
    let mut tokens = parse_token_response(&json, &metadata.issuer, None, agora_secs())?;
    // O cliente registrado viaja com a credencial: o refresh e o logout
    // precisam dele, e o arquivo de origem não o conhece.
    tokens.client_id = registrado;
    save_tokens(server_id, &tokens)?;
    Ok(status_de(server_id, Some(&tokens), &metadata))
}

fn abrir_navegador(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("não consegui abrir o navegador para o login: {e}"))
}

fn status_de(
    server_id: &str,
    tokens: Option<&StoredTokens>,
    metadata: &AsMetadata,
) -> McpAuthStatus {
    McpAuthStatus {
        server_id: server_id.to_string(),
        state: estado_de(tokens, agora_secs()),
        expires_at: tokens.and_then(|t| t.expires_at),
        scope: tokens.and_then(|t| t.scope.clone()),
        revogavel: metadata.revocation_endpoint.is_some(),
    }
}

/// Renova o access token. Devolve a credencial nova já persistida.
///
/// Falha de refresh NÃO é silenciosa e não deixa credencial zumbi: a credencial
/// é apagada e o estado vira "sem login", com motivo legível.
pub async fn refresh(
    server_id: &str,
    config: &OauthConfig,
    tokens: &StoredTokens,
) -> Result<StoredTokens, String> {
    let refresh_token = tokens
        .refresh_token
        .as_deref()
        .ok_or("a credencial não tem refresh token; faça login de novo")?;
    let metadata = descobrir_as(config).await?;
    if metadata.issuer != tokens.issuer {
        return Err(format!(
            "a credencial guardada é do emissor `{}`, mas o servidor agora usa `{}`; faça login de novo",
            tokens.issuer, metadata.issuer
        ));
    }
    let client_id = client_id_efetivo(config, Some(tokens))?;
    let resposta = curl_form(
        &metadata.token_endpoint,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", &client_id),
            ("resource", &config.resource),
        ],
        &[],
    )
    .await?;
    if resposta.status != 200 {
        // A credencial morta NÃO é apagada: o estado "expirado" é informação
        // (houve login, e ele caiu). Apagar aqui viraria "sem login" e faria o
        // usuário achar que nunca entrou.
        let motivo = token_error_message(resposta.status, &resposta.corpo);
        return Err(format!(
            "a sessão expirou e não pôde ser renovada: {motivo}"
        ));
    }
    let json: Value = serde_json::from_str(&resposta.corpo)
        .map_err(|e| format!("resposta do token endpoint ilegível: {e}"))?;
    let mut novos = parse_token_response(
        &json,
        &metadata.issuer,
        tokens.refresh_token.as_deref(),
        agora_secs(),
    )?;
    novos.client_id = tokens.client_id.clone();
    save_tokens(server_id, &novos)?;
    Ok(novos)
}

// ---- comandos --------------------------------------------------------------

async fn config_de(project_path: &str, server_id: &str) -> Result<OauthConfig, String> {
    crate::mcp_control::oauth_config_for_server(project_path, server_id)
        .await
        .ok_or_else(|| {
            "este servidor MCP não aceita login do app: não é HTTP, ou carrega credencial literal na configuração de origem".to_string()
        })
}

/// Inicia o login do app. Abre o navegador do usuário e espera o retorno.
#[tauri::command]
pub async fn mcp_oauth_login(
    app: tauri::AppHandle,
    project_path: String,
    server_id: String,
) -> Result<McpAuthStatus, String> {
    let config = config_de(&project_path, &server_id).await?;
    login(&app, &server_id, &config).await
}

/// Estado do login, sem NUNCA devolver token ao frontend.
#[tauri::command]
pub async fn mcp_oauth_status(
    project_path: String,
    server_id: String,
) -> Result<McpAuthStatus, String> {
    let tokens = load_tokens(&server_id)?;
    // Sem credencial não vale gastar rede descobrindo metadata só para saber
    // se o servidor tem revogação.
    let Some(tokens) = tokens else {
        return Ok(McpAuthStatus {
            server_id,
            state: McpAuthState::SemLogin,
            expires_at: None,
            scope: None,
            revogavel: false,
        });
    };
    let config = config_de(&project_path, &server_id).await.ok();
    let revogavel = match &config {
        Some(config) => descobrir_as(config)
            .await
            .map(|metadata| metadata.revocation_endpoint.is_some())
            .unwrap_or(false),
        None => false,
    };
    // Token vencido com refresh: RENOVA antes de responder. Sem isso o estado
    // seria um palpite ("deve dar pra renovar"); com isso é fato. Se a renovação
    // falhar, o estado continua `Expirado` — que é a verdade.
    let mut tokens = tokens;
    if tokens.expirado(agora_secs()) && tokens.refresh_token.is_some() {
        if let Some(config) = &config {
            if let Ok(novos) = refresh(&server_id, config, &tokens).await {
                tokens = novos;
            }
        }
    }
    Ok(McpAuthStatus {
        server_id,
        state: estado_de(Some(&tokens), agora_secs()),
        expires_at: tokens.expires_at,
        scope: tokens.scope.clone(),
        revogavel,
    })
}

/// Sai: revoga no servidor QUANDO ele expõe revogação e apaga do Keychain.
///
/// O apagar acontece mesmo se a revogação falhar — deixar credencial local
/// depois de o usuário pedir "Sair" seria mentira. O retorno diz o que de fato
/// aconteceu, sem prometer revogação que não houve (o AS real do `prime-mcp`
/// não expõe `revocation_endpoint`).
#[tauri::command]
pub async fn mcp_oauth_logout(project_path: String, server_id: String) -> Result<String, String> {
    let tokens = load_tokens(&server_id)?;
    let mut revogado = false;
    let mut aviso: Option<String> = None;
    if let Some(tokens) = &tokens {
        if let Ok(config) = config_de(&project_path, &server_id).await {
            match descobrir_as(&config).await {
                Ok(metadata) => match metadata.revocation_endpoint.as_deref() {
                    Some(endpoint) => {
                        let alvo = tokens
                            .refresh_token
                            .as_deref()
                            .unwrap_or(&tokens.access_token);
                        let tipo = if tokens.refresh_token.is_some() {
                            "refresh_token"
                        } else {
                            "access_token"
                        };
                        let client_id = client_id_efetivo(&config, Some(tokens)).unwrap_or_default();
                        match curl_form(
                            endpoint,
                            &[
                                ("token", alvo),
                                ("token_type_hint", tipo),
                                ("client_id", &client_id),
                            ],
                            &[],
                        )
                        .await
                        {
                            Ok(resposta) if (200..300).contains(&resposta.status) => {
                                revogado = true
                            }
                            Ok(resposta) => {
                                aviso = Some(token_error_message(resposta.status, &resposta.corpo))
                            }
                            Err(erro) => aviso = Some(erro),
                        }
                    }
                    None => {
                        aviso = Some(
                            "este servidor não oferece revogação, então a sessão pode seguir válida nele".into(),
                        )
                    }
                },
                Err(erro) => aviso = Some(erro),
            }
        }
    }
    delete_tokens(&server_id)?;
    Ok(match (revogado, aviso) {
        (true, _) => "Sessão revogada no servidor e removida deste Mac.".into(),
        (false, Some(motivo)) => {
            format!("Credencial removida deste Mac. Não foi revogada no servidor: {motivo}")
        }
        (false, None) => "Credencial removida deste Mac.".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Metadata REAL do servidor de autorização do `prime-mcp`, coletada do
    /// endpoint em 07/08/2026 (spikes/mcp-auth/as-metadata.prime.json).
    fn as_metadata_prime() -> Value {
        json!({
            "issuer": "https://tsxtyuyjmouuyzkzwdtz.supabase.co/auth/v1",
            "authorization_endpoint": "https://tsxtyuyjmouuyzkzwdtz.supabase.co/auth/v1/oauth/authorize",
            "token_endpoint": "https://tsxtyuyjmouuyzkzwdtz.supabase.co/auth/v1/oauth/token",
            "jwks_uri": "https://tsxtyuyjmouuyzkzwdtz.supabase.co/auth/v1/.well-known/jwks.json",
            "scopes_supported": ["openid", "profile", "email", "phone", "offline_access"],
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "none"],
            "code_challenge_methods_supported": ["S256", "plain"]
        })
    }

    fn config_prime() -> OauthConfig {
        OauthConfig {
            client_id: Some("c19d2b4a-1006-4564-8925-4bfe6156d147".into()),
            callback_port: Some(8976),
            auth_server_metadata_url: Some(
                "https://tsxtyuyjmouuyzkzwdtz.supabase.co/auth/v1/.well-known/oauth-authorization-server".into(),
            ),
            resource: "https://tsxtyuyjmouuyzkzwdtz.supabase.co/functions/v1/mcp".into(),
        }
    }

    #[test]
    fn le_o_bloco_oauth_do_mcp_json_real_do_prime() {
        let raw = json!({
            "type": "http",
            "url": "https://tsxtyuyjmouuyzkzwdtz.supabase.co/functions/v1/mcp",
            "oauth": {
                "clientId": "c19d2b4a-1006-4564-8925-4bfe6156d147",
                "callbackPort": 8976,
                "authServerMetadataUrl": "https://tsxtyuyjmouuyzkzwdtz.supabase.co/auth/v1/.well-known/oauth-authorization-server"
            }
        });
        let url = raw.get("url").unwrap().as_str().unwrap();
        assert_eq!(parse_oauth_config(&raw, url), Some(config_prime()));
    }

    #[test]
    fn entrada_sem_bloco_oauth_nao_vira_login_do_app() {
        let raw = json!({ "type": "http", "url": "https://exemplo/mcp" });
        assert!(parse_oauth_config(&raw, "https://exemplo/mcp").is_none());
    }

    /// Metadata REAL do servidor de autorização do Vercel
    /// (`https://mcp.vercel.com/.well-known/oauth-authorization-server`,
    /// colhida em 16/09/2026). Diferente do prime, expõe registro dinâmico.
    fn as_metadata_vercel() -> Value {
        json!({
            "issuer": "https://vercel.com",
            "authorization_endpoint": "https://vercel.com/oauth/authorize",
            "token_endpoint": "https://vercel.com/api/login/oauth/token",
            "registration_endpoint": "https://vercel.com/api/login/oauth/register",
            "code_challenge_methods_supported": ["S256"],
            "token_endpoint_auth_methods_supported": ["none", "client_secret_post"],
            "scopes_supported": ["openid"]
        })
    }

    #[test]
    fn metadata_do_vercel_declara_registro_dinamico_e_a_do_prime_nao() {
        let vercel = parse_as_metadata(&as_metadata_vercel(), "https://vercel.com").unwrap();
        assert_eq!(
            vercel.registration_endpoint.as_deref(),
            Some("https://vercel.com/api/login/oauth/register")
        );
        let prime = parse_as_metadata(
            &as_metadata_prime(),
            "https://tsxtyuyjmouuyzkzwdtz.supabase.co/auth/v1",
        )
        .unwrap();
        assert_eq!(prime.registration_endpoint, None);
    }

    #[test]
    fn registro_dinamico_pede_cliente_publico_com_o_redirect_da_porta_escolhida() {
        let pedido = build_registration_request("http://127.0.0.1:53211/callback");
        assert_eq!(pedido["client_name"], "Frota");
        assert_eq!(pedido["redirect_uris"][0], "http://127.0.0.1:53211/callback");
        assert_eq!(pedido["token_endpoint_auth_method"], "none");
        assert!(pedido["grant_types"]
            .as_array()
            .unwrap()
            .iter()
            .any(|g| g == "refresh_token"));
    }

    #[test]
    fn resposta_do_registro_devolve_so_o_client_id_e_recusa_erro() {
        let ok = parse_registration_response(
            201,
            r#"{"client_id":"cli_abc","client_name":"Frota","redirect_uris":["http://127.0.0.1:53211/callback"]}"#,
        );
        assert_eq!(ok.unwrap(), "cli_abc");
        let sem_id = parse_registration_response(201, r#"{"client_name":"Frota"}"#);
        assert!(sem_id.unwrap_err().contains("client_id"));
        let recusado = parse_registration_response(
            400,
            r#"{"error":"invalid_redirect_uri","error_description":"redirect_uri não permitido"}"#,
        );
        assert!(recusado.unwrap_err().contains("redirect_uri não permitido"));
    }

    #[test]
    fn login_dinamico_nasce_sem_cliente_e_sem_porta_mas_com_resource_canonico() {
        let cfg = login_dinamico("https://mcp.vercel.com/");
        assert_eq!(cfg.client_id, None);
        assert_eq!(cfg.callback_port, None);
        assert_eq!(cfg.resource, "https://mcp.vercel.com");
    }

    #[test]
    fn client_id_efetivo_prefere_o_registrado_no_login_e_recusa_quando_nao_ha_nenhum() {
        let config = login_dinamico("https://mcp.vercel.com");
        let mut tokens = StoredTokens {
            access_token: "a".into(),
            refresh_token: None,
            expires_at: None,
            issuer: "https://vercel.com".into(),
            scope: None,
            client_id: Some("cli_abc".into()),
        };
        assert_eq!(client_id_efetivo(&config, Some(&tokens)).unwrap(), "cli_abc");
        tokens.client_id = None;
        assert!(client_id_efetivo(&config, Some(&tokens)).is_err());
        assert_eq!(client_id_efetivo(&config_prime(), Some(&tokens)).unwrap(), "c19d2b4a-1006-4564-8925-4bfe6156d147");
    }

    #[test]
    fn credencial_antiga_sem_client_id_continua_legivel() {
        // Blob gravado antes da ADR-201 não tem o campo: não pode virar
        // "credencial ilegível, faça login de novo".
        let blob = r#"{"access_token":"a","refresh_token":"r","expires_at":1,"issuer":"https://x","scope":null}"#;
        let tokens: StoredTokens = serde_json::from_str(blob).unwrap();
        assert_eq!(tokens.client_id, None);
    }

    #[test]
    fn a_copia_em_memoria_segue_gravar_e_apagar() {
        // Não toca o Keychain real: só o cache. `lembrar` é o que save/delete
        // chamam depois de falar com o disco.
        let id = "teste-cache-adr-201";
        lembrar(id, None);
        assert_eq!(load_tokens(id).unwrap(), None);
        let tokens = StoredTokens {
            access_token: "a".into(),
            refresh_token: None,
            expires_at: None,
            issuer: "https://x".into(),
            scope: None,
            client_id: None,
        };
        lembrar(id, Some(tokens.clone()));
        assert_eq!(load_tokens(id).unwrap(), Some(tokens));
        assert!(tem_credencial(id));
        lembrar(id, None);
        assert!(!tem_credencial(id));
    }

    #[test]
    fn desafio_pkce_segue_o_vetor_do_rfc_7636() {
        // RFC 7636 Apêndice B: verifier e challenge de referência.
        assert_eq!(
            code_challenge_s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn resource_canonico_perde_fragment_e_barra_final() {
        assert_eq!(canonical_resource("https://a/mcp/"), "https://a/mcp");
        assert_eq!(canonical_resource("https://a/mcp#x"), "https://a/mcp");
        assert_eq!(canonical_resource("https://a/mcp"), "https://a/mcp");
    }

    #[test]
    fn le_o_resource_metadata_do_www_authenticate_real() {
        // Header REAL devolvido pelo prime-mcp no 401.
        let header = r#"www-authenticate: Bearer resource_metadata="https://tsxtyuyjmouuyzkzwdtz.supabase.co/functions/v1/mcp/.well-known/oauth-protected-resource""#;
        assert_eq!(
            parse_resource_metadata_url(header).as_deref(),
            Some("https://tsxtyuyjmouuyzkzwdtz.supabase.co/functions/v1/mcp/.well-known/oauth-protected-resource")
        );
        assert!(parse_resource_metadata_url("Bearer realm=\"x\"").is_none());
    }

    #[test]
    fn descoberta_de_metadata_usa_a_ordem_da_spec_para_issuer_com_path() {
        let urls = as_metadata_urls("https://tsxtyuyjmouuyzkzwdtz.supabase.co/auth/v1");
        assert_eq!(
            urls,
            vec![
                "https://tsxtyuyjmouuyzkzwdtz.supabase.co/.well-known/oauth-authorization-server/auth/v1",
                "https://tsxtyuyjmouuyzkzwdtz.supabase.co/.well-known/openid-configuration/auth/v1",
                "https://tsxtyuyjmouuyzkzwdtz.supabase.co/auth/v1/.well-known/openid-configuration",
            ]
        );
        let raiz = as_metadata_urls("https://exemplo.com");
        assert_eq!(
            raiz,
            vec![
                "https://exemplo.com/.well-known/oauth-authorization-server",
                "https://exemplo.com/.well-known/openid-configuration",
            ]
        );
    }

    #[test]
    fn metadata_real_do_prime_e_aceita_e_declara_s256() {
        let metadata = parse_as_metadata(
            &as_metadata_prime(),
            "https://tsxtyuyjmouuyzkzwdtz.supabase.co/auth/v1",
        )
        .expect("metadata real deve ser aceita");
        assert_eq!(
            metadata.token_endpoint,
            "https://tsxtyuyjmouuyzkzwdtz.supabase.co/auth/v1/oauth/token"
        );
        // O AS real do prime NÃO expõe revogação: "Sair" precisa dizer a verdade.
        assert_eq!(metadata.revocation_endpoint, None);
        assert!(metadata
            .scopes_supported
            .iter()
            .any(|s| s == "offline_access"));
    }

    #[test]
    fn issuer_divergente_no_metadata_cancela_o_login() {
        let erro = parse_as_metadata(&as_metadata_prime(), "https://outro.example/auth")
            .expect_err("issuer divergente deve recusar");
        assert!(erro.contains("issuer"), "motivo legível: {erro}");
    }

    #[test]
    fn servidor_sem_pkce_e_recusado_antes_de_abrir_o_navegador() {
        let mut sem_pkce = as_metadata_prime();
        sem_pkce
            .as_object_mut()
            .unwrap()
            .remove("code_challenge_methods_supported");
        let erro = parse_as_metadata(
            &sem_pkce,
            "https://tsxtyuyjmouuyzkzwdtz.supabase.co/auth/v1",
        )
        .expect_err("sem PKCE deve recusar");
        assert!(erro.contains("PKCE"), "motivo legível: {erro}");

        let mut so_plain = as_metadata_prime();
        so_plain["code_challenge_methods_supported"] = json!(["plain"]);
        let erro = parse_as_metadata(
            &so_plain,
            "https://tsxtyuyjmouuyzkzwdtz.supabase.co/auth/v1",
        )
        .expect_err("só plain deve recusar");
        assert!(erro.contains("S256"), "motivo legível: {erro}");
    }

    #[test]
    fn offline_access_so_entra_quando_o_servidor_declara() {
        let com = escopos_do_login(
            &["openid".into()],
            &["openid".into(), "offline_access".into()],
        );
        assert_eq!(com, vec!["openid", "offline_access"]);
        let sem = escopos_do_login(&["openid".into()], &["openid".into()]);
        assert_eq!(sem, vec!["openid"]);
    }

    #[test]
    fn url_de_autorizacao_leva_pkce_state_e_resource() {
        let metadata = parse_as_metadata(
            &as_metadata_prime(),
            "https://tsxtyuyjmouuyzkzwdtz.supabase.co/auth/v1",
        )
        .unwrap();
        let config = config_prime();
        let url = build_authorize_url(
            &metadata,
            &config,
            config.client_id.as_deref().unwrap(),
            &redirect_uri(config.callback_port.unwrap()),
            "estado-1",
            "desafio-1",
            &["openid".into()],
        );
        assert!(url.contains("code_challenge=desafio-1"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=estado-1"));
        // `resource` é MUST da spec, mesmo quando o AS não anuncia suporte.
        assert!(url.contains(
            "resource=https%3A%2F%2Ftsxtyuyjmouuyzkzwdtz.supabase.co%2Ffunctions%2Fv1%2Fmcp"
        ));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A8976%2Fcallback"));
        // O verifier NUNCA vai na URL de autorização.
        assert!(!url.contains("code_verifier"));
    }

    fn params(pares: &[(&str, &str)]) -> BTreeMap<String, String> {
        pares
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn callback_com_state_divergente_e_recusado() {
        let erro = validate_callback(
            &params(&[("state", "outro"), ("code", "abc")]),
            "esperado",
            "https://as",
            false,
        )
        .expect_err("state divergente deve recusar");
        assert!(erro.contains("state"), "motivo legível: {erro}");
    }

    #[test]
    fn callback_de_emissor_errado_e_recusado_antes_de_trocar_o_code() {
        let erro = validate_callback(
            &params(&[("state", "s"), ("code", "abc"), ("iss", "https://atacante")]),
            "s",
            "https://as",
            true,
        )
        .expect_err("iss divergente deve recusar");
        assert!(erro.contains("atacante"), "motivo legível: {erro}");
    }

    #[test]
    fn callback_sem_iss_quando_o_servidor_promete_enviar_e_recusado() {
        assert!(validate_callback(
            &params(&[("state", "s"), ("code", "abc")]),
            "s",
            "https://as",
            true
        )
        .is_err());
        // Sem promessa de `iss`, a ausência é aceitável.
        assert_eq!(
            validate_callback(
                &params(&[("state", "s"), ("code", "abc")]),
                "s",
                "https://as",
                false
            ),
            Ok("abc".to_string())
        );
    }

    #[test]
    fn erro_do_servidor_no_callback_vira_motivo_legivel() {
        let erro = validate_callback(
            &params(&[
                ("state", "s"),
                ("error", "access_denied"),
                ("error_description", "usuário recusou"),
            ]),
            "s",
            "https://as",
            false,
        )
        .expect_err("erro deve recusar");
        assert!(erro.contains("usuário recusou"), "motivo legível: {erro}");
    }

    #[test]
    fn query_do_callback_e_decodificada() {
        let p = parse_callback_query("GET /callback?code=a%2Fb&state=x+y HTTP/1.1");
        assert_eq!(p.get("code").map(String::as_str), Some("a/b"));
        assert_eq!(p.get("state").map(String::as_str), Some("x y"));
    }

    #[test]
    fn resposta_de_token_guarda_prazo_e_rotaciona_o_refresh() {
        let json = json!({
            "access_token": "at-novo",
            "refresh_token": "rt-novo",
            "expires_in": 3600,
            "scope": "openid"
        });
        let tokens = parse_token_response(&json, "https://as", Some("rt-antigo"), 1_000).unwrap();
        assert_eq!(tokens.access_token, "at-novo");
        assert_eq!(tokens.refresh_token.as_deref(), Some("rt-novo"));
        assert_eq!(tokens.expires_at, Some(4_600));
    }

    #[test]
    fn refresh_ausente_na_resposta_preserva_o_anterior() {
        let json = json!({ "access_token": "at", "expires_in": 60 });
        let tokens = parse_token_response(&json, "https://as", Some("rt-antigo"), 0).unwrap();
        assert_eq!(tokens.refresh_token.as_deref(), Some("rt-antigo"));
    }

    /// Fixtures REAIS do token endpoint do prime: as duas formas de erro que o
    /// MESMO endpoint devolve. Um parser que só lesse `error_description`
    /// devolveria mensagem vazia no caminho de refresh.
    #[test]
    fn as_duas_formas_de_erro_do_endpoint_real_viram_motivo_legivel() {
        // Troca do code (forma do RFC 6749).
        let rfc = r#"{"error":"invalid_grant","error_description":"Invalid authorization code"}"#;
        assert_eq!(token_error_message(400, rfc), "Invalid authorization code");
        // Refresh (forma proprietária do GoTrue: `msg`/`error_code`).
        let gotrue = r#"{"code":400,"error_code":"refresh_token_not_found","msg":"Invalid Refresh Token: Refresh Token Not Found"}"#;
        assert_eq!(
            token_error_message(400, gotrue),
            "Invalid Refresh Token: Refresh Token Not Found"
        );
        // Corpo ilegível ainda produz frase com o status, nunca string vazia.
        assert_eq!(
            token_error_message(503, "<html>oops</html>"),
            "o servidor de autorização respondeu HTTP 503"
        );
    }

    #[test]
    fn estado_sem_credencial_e_sem_login() {
        assert_eq!(estado_de(None, 0), McpAuthState::SemLogin);
    }

    #[test]
    fn token_vencido_e_expirado_mesmo_havendo_refresh_token() {
        let vencido = StoredTokens {
            access_token: "at".into(),
            refresh_token: None,
            expires_at: Some(1_000),
            issuer: "https://as".into(),
            scope: None,
            client_id: None,
        };
        assert_eq!(estado_de(Some(&vencido), 2_000), McpAuthState::Expirado);
        // Ter refresh token é PROMESSA de renovação, não renovação feita: o
        // estado só vira `Conectado` depois que a renovação acontece.
        let vencido_com_refresh = StoredTokens {
            refresh_token: Some("rt".into()),
            ..vencido.clone()
        };
        assert_eq!(
            estado_de(Some(&vencido_com_refresh), 2_000),
            McpAuthState::Expirado
        );
        let valido = StoredTokens {
            expires_at: Some(9_000),
            ..vencido
        };
        assert_eq!(estado_de(Some(&valido), 2_000), McpAuthState::Conectado);
    }

    #[test]
    fn margem_de_expiracao_evita_mandar_token_que_morre_no_voo() {
        let tokens = StoredTokens {
            access_token: "at".into(),
            refresh_token: None,
            expires_at: Some(1_000),
            issuer: "https://as".into(),
            scope: None,
            client_id: None,
        };
        // Ainda não venceu pelo relógio, mas vence dentro da margem.
        assert!(tokens.expirado(1_000 - EXPIRY_SKEW_SECS + 1));
        assert!(!tokens.expirado(1_000 - EXPIRY_SKEW_SECS - 1));
    }

    #[test]
    fn credencial_serializada_nao_perde_o_emissor() {
        let tokens = StoredTokens {
            access_token: "at".into(),
            refresh_token: Some("rt".into()),
            expires_at: Some(10),
            issuer: "https://as".into(),
            scope: Some("openid".into()),
            client_id: None,
        };
        let blob = serde_json::to_string(&tokens).unwrap();
        let volta: StoredTokens = serde_json::from_str(&blob).unwrap();
        assert_eq!(volta, tokens);
    }
}
