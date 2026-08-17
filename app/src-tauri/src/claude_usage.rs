//! Janela de uso do CLAUDE pela API de OAuth da conta (dialeto `ClaudeOauth`,
//! a fonte que faz o medidor funcionar de verdade).
//!
//! POR QUE ESTA FONTE EXISTE. A statusline (dialeto `ClaudeStatusline`) só
//! roda em sessão INTERATIVA: em `-p`/headless o comando de statusline NUNCA é
//! executado (provado empiricamente, 12/08/2026, com `--settings` inline e um
//! script-sonda). Como o app roda TODAS as conversas em headless, a statusline
//! só entregava dado quando o usuário abria `claude` num terminal COM o app
//! aberto — ou seja, o Claude simplesmente nunca aparecia no medidor. Ela
//! continua ligada como ingest OPORTUNISTA (carona grátis quando acontece); a
//! fonte principal é esta, que independe de sessão.
//!
//! VERIFICAÇÃO EMPÍRICA ANTES DE CODAR (12/08/2026, nesta máquina, credencial
//! real lida SÓ PARA LEITURA e request montado na mão):
//!   • `GET https://api.anthropic.com/api/oauth/usage` com
//!     `Authorization: Bearer <accessToken>` → **HTTP 200** (fixture real
//!     abaixo, é o corpo verbatim).
//!   • O contrato DIVERGE do Orca e a realidade manda: as janelas top-level
//!     vêm com `utilization` (não `used_percentage`) e `resets_at` é **ISO
//!     8601 com offset** (não epoch). Além disso existe hoje o array
//!     `limits[]` estruturado (`session` / `weekly_all` / `weekly_scoped` com
//!     `scope.model.display_name`), que é o que o `/usage` do CLI mostra e o
//!     único lugar onde aparece o teto POR MODELO (Fable em 58% no capture,
//!     invisível nas chaves top-level).
//!   • `anthropic-beta: oauth-2025-04-20` NÃO é obrigatório hoje (200 sem
//!     ele), mas vai junto: é o header que o CLI manda e é ele que fixa a
//!     versão do contrato.
//!   • NENHUMA QUOTA CONSUMIDA: a resposta não traz nenhum header
//!     `anthropic-ratelimit-*` nem contabilidade de tokens (não é request de
//!     modelo, é o mesmo endereço que o `/usage` do CLI consulta), e duas
//!     chamadas seguidas devolveram os MESMOS percentuais (4 / 37 / 58) —
//!     ler o medidor não move o medidor.
//!   • Token inválido → **401** com
//!     `{"type":"error","error":{"type":"authentication_error","message":
//!     "Invalid bearer token"}}` (corpo real usado no teste de classificação).
//!
//! O QUE NÃO FOI FEITO, DE PROPÓSITO:
//!   • **PTY oculto digitando `/usage`** (o último fallback do Orca): é
//!     exatamente o que a casa evita (terminal fantasma, parsing de TUI,
//!     "rodando" que ninguém pediu). Sem token ⇒ sem dado, e a UI esconde.
//!   • **Refresh do token OAuth**. O refresh do Claude ROTACIONA o refresh
//!     token; quem refresca é obrigado a gravar o par novo de volta no
//!     Keychain, senão a credencial do CLI do usuário fica órfã (ele é
//!     deslogado do próprio terminal). Um MEDIDOR não pode ter como efeito
//!     colateral quebrar o login do usuário, e a guarda da frente é não
//!     guardar/gravar credencial nenhuma. Em vez disso: (a) o token é sempre
//!     tentado, sem olhar o `expiresAt` local (quem decide validade é o
//!     servidor), e (b) 401/403 vira estado "reautentique" legível. Na
//!     prática o app spawna `claude` o tempo todo, e é o próprio CLI que
//!     mantém o token fresco no Keychain.
//!
//! GUARDAS DE SEGREDO: o access token nunca entra em log (o `Debug` da
//! credencial é redigido), nunca em argv (`curl --config -` lê os headers do
//! STDIN, mesmo padrão do mcp_auth.rs — em `ps` só aparece `curl --config -`)
//! e nunca é persistido por nós (lemos a credencial do CLI, não guardamos
//! cópia).

use crate::usage_window::{now_ms, parse_iso8601_secs, UsageFetchError, UsageSnapshot, UsageWindow};
use serde_json::Value;
use std::fmt;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

/// Endpoint da conta (o mesmo que o `/usage` do CLI consulta).
const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
/// Header beta que fixa a versão do contrato (o CLI manda; hoje não é exigido).
const BETA_HEADER: &str = "anthropic-beta: oauth-2025-04-20";
/// UA de CLI: o endpoint é do fluxo OAuth do Claude Code, não da API pública.
const UA_HEADER: &str = "User-Agent: claude-cli/2.1.220 (external, cli)";
/// Item do Keychain que o Claude Code escreve no login (macOS).
const KEYCHAIN_SERVICE: &str = "Claude Code-credentials";
/// Teto do request inteiro: um medidor não pode segurar a passada do vigia.
const HTTP_MAX_SECS: u64 = 20;

// ---------------------------------------------------------------------------
// Credencial (SÓ LEITURA da credencial do CLI).
// ---------------------------------------------------------------------------

/// O que precisamos da credencial do Claude Code: o bearer e o nome do plano.
pub struct ClaudeCredential {
    /// NUNCA sai deste módulo a não ser dentro do config do curl (via stdin).
    access_token: String,
    /// `subscriptionType` da credencial ("max", "pro"…): é o "plano" honesto
    /// do snapshot (o endpoint de usage não devolve o nome do plano).
    pub subscription_type: Option<String>,
    /// De onde veio (só para mensagem de erro/diagnóstico, nunca o valor).
    pub origin: &'static str,
}

/// `Debug` redigido: um `{:?}` distraído em log não pode vazar o bearer.
impl fmt::Debug for ClaudeCredential {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ClaudeCredential")
            .field("access_token", &"<redigido>")
            .field("subscription_type", &self.subscription_type)
            .field("origin", &self.origin)
            .finish()
    }
}

/// Blob de credencial do Claude Code → credencial utilizável. PURA.
///
/// Deliberadamente NÃO olha `expiresAt`: a validade quem decide é o servidor
/// (um token vencido no relógio local pode continuar autenticando aqui, e um
/// token "válido" pode ter sido revogado). Sem `accessToken` não-vazio, `None`
/// — nunca fabricamos um bearer de mentira só para ver o 401.
pub fn parse_credential_json(raw: &str, origin: &'static str) -> Option<ClaudeCredential> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let oauth = v.get("claudeAiOauth")?;
    let token = oauth.get("accessToken")?.as_str()?.trim();
    if token.is_empty() {
        return None;
    }
    Some(ClaudeCredential {
        access_token: token.to_string(),
        subscription_type: oauth
            .get("subscriptionType")
            .and_then(|x| x.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string),
        origin,
    })
}

/// Caminho do `.credentials.json` (respeita CLAUDE_CONFIG_DIR, mesmo contrato
/// do CLI e do statusline_install).
fn credentials_file_path() -> Option<std::path::PathBuf> {
    if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            return Some(std::path::PathBuf::from(dir).join(".credentials.json"));
        }
    }
    let home = std::env::var("HOME").ok()?;
    Some(
        std::path::PathBuf::from(home)
            .join(".claude")
            .join(".credentials.json"),
    )
}

/// Lê o Keychain do macOS (item que o próprio Claude Code escreve). Devolve
/// `Err(motivo)` quando o `security` falhou por acesso NEGADO — isso não é o
/// mesmo que "não existe credencial", e a mensagem final tem que dizer qual
/// dos dois é.
#[cfg(target_os = "macos")]
async fn read_keychain() -> Result<Option<ClaudeCredential>, String> {
    let out = Command::new("security")
        .args(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"])
        .output()
        .await
        .map_err(|e| format!("não consegui rodar o `security` do macOS: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).to_lowercase();
        // 44/128 = item ausente ou usuário cancelou o prompt do Keychain.
        if err.contains("could not be found") || err.contains("specified item could not") {
            return Ok(None);
        }
        return Err("o macOS negou o acesso ao item do Keychain do Claude Code".into());
    }
    let raw = String::from_utf8_lossy(&out.stdout);
    Ok(parse_credential_json(raw.trim(), "keychain"))
}

#[cfg(not(target_os = "macos"))]
async fn read_keychain() -> Result<Option<ClaudeCredential>, String> {
    Ok(None)
}

/// Credencial do CLI, na ordem em que o Claude Code a mantém: Keychain
/// (macOS) e depois o `.credentials.json` legado. Sem nenhuma das duas: erro
/// "auth" honesto, que a UI mostra como "faça login" (capability presente,
/// dado ausente) em vez de fingir medição.
async fn read_credential() -> Result<ClaudeCredential, UsageFetchError> {
    let mut negado: Option<String> = None;
    match read_keychain().await {
        Ok(Some(cred)) => return Ok(cred),
        Ok(None) => {}
        Err(motivo) => negado = Some(motivo),
    }
    if let Some(path) = credentials_file_path() {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Some(cred) = parse_credential_json(&raw, "arquivo") {
                return Ok(cred);
            }
        }
    }
    Err(UsageFetchError::new(
        "auth",
        negado.unwrap_or_else(|| {
            "não encontrei a credencial do Claude Code nesta máquina (faça login com `claude` no terminal)".into()
        }),
    ))
}

// ---------------------------------------------------------------------------
// Parsing (PURO, testado com o corpo REAL).
// ---------------------------------------------------------------------------

/// `kind` do `limits[]` → (id, rótulo, minutos). Kind novo que a Anthropic
/// inventar amanhã degrada pro próprio kind, sem minutos (fail-open no render:
/// dado real nunca é descartado por ser novo).
fn limit_meta(kind: &str) -> (String, String, Option<i64>) {
    match kind {
        "session" => ("5h".into(), "5 h".into(), Some(300)),
        "weekly_all" => ("7d".into(), "7 dias".into(), Some(10_080)),
        "weekly_scoped" => ("7d".into(), "7 dias".into(), Some(10_080)),
        outro => (outro.into(), outro.into(), None),
    }
}

/// Corpo do `/api/oauth/usage` → janelas.
///
/// PRIMÁRIO: o array `limits[]`, que é o contrato estruturado de hoje e o
/// único que carrega o teto POR MODELO (`weekly_scoped` + `scope.model
/// .display_name`, o "Fable 58%" do capture real). `is_active` é ignorado de
/// propósito: ele marca qual limite está VINCULANDO agora, não se o dado vale
/// (uma janela inativa em 58% continua sendo 58% queimados).
///
/// FALLBACK (resposta sem `limits`): as chaves top-level `five_hour`,
/// `seven_day` e os `seven_day_*` escopados. Chaves de codinome que aparecem
/// zeradas no payload (`nimbus_quill`, `tangelo`…) ficam de fora: são buckets
/// de experimento não lançado, entrariam no medidor como ruído de 0% e tudo
/// que é limite REAL do plano já aparece em `limits[]`.
pub fn parse_oauth_usage(v: &Value) -> Vec<UsageWindow> {
    if let Some(limits) = v.get("limits").and_then(|x| x.as_array()) {
        let mut out = Vec::new();
        for l in limits {
            let Some(pct) = l.get("percent").and_then(|x| x.as_f64()) else {
                continue; // limite sem percentual não vira medidor
            };
            let kind = l.get("kind").and_then(|x| x.as_str()).unwrap_or("desconhecido");
            let (mut id, mut label, minutes) = limit_meta(kind);
            // escopo por modelo entra no id E no rótulo: dois "7 dias" no
            // popover sem dizer de quem é seria pior que não mostrar.
            if let Some(modelo) = l
                .get("scope")
                .and_then(|s| s.get("model"))
                .and_then(|m| m.get("display_name"))
                .and_then(|x| x.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                id = format!("{id}:{}", modelo.to_lowercase());
                label = format!("{label} · {modelo}");
            }
            out.push(UsageWindow {
                id,
                label,
                used_percent: pct,
                resets_at: l
                    .get("resets_at")
                    .and_then(|x| x.as_str())
                    .and_then(parse_iso8601_secs),
                window_minutes: minutes,
            });
        }
        if !out.is_empty() {
            return out;
        }
    }
    let mut out = Vec::new();
    let Some(obj) = v.as_object() else {
        return out;
    };
    for (chave, w) in obj {
        if chave != "five_hour" && chave != "seven_day" && !chave.starts_with("seven_day_") {
            continue;
        }
        let Some(pct) = w.get("utilization").and_then(|x| x.as_f64()) else {
            continue;
        };
        let (id, label, minutes) = if chave == "five_hour" {
            ("5h".to_string(), "5 h".to_string(), Some(300))
        } else if chave == "seven_day" {
            ("7d".to_string(), "7 dias".to_string(), Some(10_080))
        } else {
            let sufixo = chave.trim_start_matches("seven_day_");
            (
                format!("7d:{sufixo}"),
                format!("7 dias · {sufixo}"),
                Some(10_080),
            )
        };
        out.push(UsageWindow {
            id,
            label,
            used_percent: pct,
            resets_at: w
                .get("resets_at")
                .and_then(|x| x.as_str())
                .and_then(parse_iso8601_secs),
            window_minutes: minutes,
        });
    }
    out
}

/// Status HTTP + corpo → falha com o TIPO na cara (a política de poll do lado
/// TS decide o backoff a partir do `kind`). 401/403 vira "auth", que a UI
/// mostra como "faça login de novo" em vez de erro cru: o CLI do usuário
/// renova a credencial sozinho no próximo `claude`.
pub fn classify_http(status: u16, body: &str) -> UsageFetchError {
    let detalhe = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            v.get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .map(str::to_string)
        })
        .map(|m| m.chars().take(160).collect::<String>());
    match status {
        401 | 403 => UsageFetchError::new(
            "auth",
            "a conta do Claude não aceitou a credencial local (rode `claude` no terminal para reautenticar)",
        ),
        429 => UsageFetchError::new(
            "rate-limited",
            "a Anthropic limitou as consultas de uso (HTTP 429)",
        ),
        s if s >= 500 => UsageFetchError::new(
            "protocol",
            format!(
                "a API de uso da conta respondeu {s}{}",
                detalhe.map(|d| format!(": {d}")).unwrap_or_default()
            ),
        ),
        s => UsageFetchError::new(
            "protocol",
            format!(
                "resposta inesperada da API de uso da conta (HTTP {s}){}",
                detalhe.map(|d| format!(": {d}")).unwrap_or_default()
            ),
        ),
    }
}

// ---------------------------------------------------------------------------
// HTTP (curl com config pelo STDIN: o bearer nunca aparece em argv).
// ---------------------------------------------------------------------------

fn aspas(valor: &str) -> String {
    format!("\"{}\"", valor.replace('\\', "\\\\").replace('"', "\\\""))
}

/// GET autenticado. Devolve (status, corpo). O config vai pelo stdin do curl
/// (mesma garantia do mcp_auth.rs: em `ps` só aparece `curl --config -`).
async fn http_get_usage(token: &str) -> Result<(u16, String), UsageFetchError> {
    let config = format!(
        "url = {}\nheader = {}\nheader = {}\nheader = {}\nsilent\nshow-error\nwrite-out = \"\\n%{{http_code}}\"\nmax-time = {}\n",
        aspas(USAGE_URL),
        aspas(&format!("Authorization: Bearer {token}")),
        aspas(BETA_HEADER),
        aspas(UA_HEADER),
        HTTP_MAX_SECS,
    );
    let mut filho = Command::new("curl")
        .arg("--config")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| UsageFetchError::new("spawn", format!("curl indisponível: {e}")))?;
    if let Some(mut stdin) = filho.stdin.take() {
        stdin
            .write_all(config.as_bytes())
            .await
            .map_err(|e| UsageFetchError::new("spawn", format!("stdin do curl fechou: {e}")))?;
        stdin
            .shutdown()
            .await
            .map_err(|e| UsageFetchError::new("spawn", format!("stdin do curl não fechou: {e}")))?;
    }
    let saida = filho
        .wait_with_output()
        .await
        .map_err(|e| UsageFetchError::new("spawn", format!("curl não respondeu: {e}")))?;
    if !saida.status.success() {
        // 28 = estourou o max-time; o resto é rede/DNS/TLS. A stderr do curl
        // não carrega header nenhum (eles foram pelo stdin), então pode ir na
        // mensagem sem risco de vazar o bearer.
        let motivo = String::from_utf8_lossy(&saida.stderr).trim().to_string();
        let kind = if saida.status.code() == Some(28) {
            "timeout"
        } else {
            "spawn"
        };
        return Err(UsageFetchError::new(
            kind,
            if motivo.is_empty() {
                "não consegui falar com a API de uso da conta".to_string()
            } else {
                motivo
            },
        ));
    }
    let bruto = String::from_utf8_lossy(&saida.stdout).to_string();
    let (corpo, status) = match bruto.rsplit_once('\n') {
        Some((corpo, status)) => (corpo.to_string(), status.trim().parse::<u16>().unwrap_or(0)),
        None => (bruto.clone(), 0),
    };
    Ok((status, corpo))
}

/// Busca a janela de uso do `agent` pela conta (dialeto `ClaudeOauth`).
/// Chamada SÓ pelo `usage_fetch`, que já gateou pela capability.
pub async fn fetch(agent: &str) -> Result<UsageSnapshot, UsageFetchError> {
    let cred = read_credential().await?;
    let (status, corpo) = http_get_usage(&cred.access_token).await?;
    if status != 200 {
        return Err(classify_http(status, &corpo));
    }
    let v: Value = serde_json::from_str(&corpo)
        .map_err(|e| UsageFetchError::new("protocol", format!("resposta não é JSON: {e}")))?;
    let windows = parse_oauth_usage(&v);
    if windows.is_empty() {
        return Err(UsageFetchError::new(
            "protocol",
            "a API de uso da conta respondeu sem nenhuma janela",
        ));
    }
    Ok(UsageSnapshot {
        agent: agent.to_string(),
        source: "oauth".into(),
        windows,
        plan_type: cred.subscription_type,
        fetched_at: now_ms(),
    })
}

// ---------------------------------------------------------------------------
// Testes — fixture é o corpo REAL do endpoint (ADR-016), capturado nesta
// máquina em 12/08/2026 com a credencial do Claude Code desta conta.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Corpo REAL de `GET /api/oauth/usage` (HTTP 200, 12/08/2026), verbatim.
    const FIXTURE_OAUTH: &str = r#"{
      "five_hour": { "utilization": 4.0, "resets_at": "2026-08-12T22:50:00.380826+00:00", "limit_dollars": null, "used_dollars": null, "remaining_dollars": null },
      "seven_day": { "utilization": 37.0, "resets_at": "2026-08-17T20:00:00.380849+00:00", "limit_dollars": null, "used_dollars": null, "remaining_dollars": null },
      "seven_day_oauth_apps": null,
      "seven_day_opus": null,
      "seven_day_sonnet": null,
      "seven_day_cowork": null,
      "seven_day_omelette": null,
      "tangelo": null,
      "iguana_necktie": null,
      "omelette_promotional": null,
      "nimbus_quill": { "utilization": 0.0, "resets_at": null, "limit_dollars": null, "used_dollars": null, "remaining_dollars": null },
      "cinder_cove": null,
      "amber_ladder": null,
      "extra_usage": { "is_enabled": false, "monthly_limit": 5000, "used_credits": 0.0, "utilization": 0.0, "currency": "BRL", "decimal_places": 2, "disabled_reason": "out_of_credits", "user_disabled": false, "spend_limit_reached": false, "credits_ever_enabled": true, "daily": null, "weekly": null },
      "limits": [
        { "kind": "session", "group": "session", "percent": 4, "severity": "normal", "resets_at": "2026-08-12T22:50:00.380826+00:00", "scope": null, "is_active": false },
        { "kind": "weekly_all", "group": "weekly", "percent": 37, "severity": "normal", "resets_at": "2026-08-17T20:00:00.380849+00:00", "scope": null, "is_active": false },
        { "kind": "weekly_scoped", "group": "weekly", "percent": 58, "severity": "normal", "resets_at": "2026-08-17T20:00:00.381028+00:00", "scope": { "model": { "id": null, "display_name": "Fable" }, "surface": null }, "is_active": true }
      ],
      "spend": { "used": { "amount_minor": 0, "currency": "BRL", "exponent": 2 }, "limit": { "amount_minor": 5000, "currency": "BRL", "exponent": 2 }, "percent": 0, "severity": "normal", "enabled": false, "disabled_reason": "out_of_credits", "cap": { "money": { "amount_minor": 5000, "currency": "BRL", "exponent": 2 }, "credits": null }, "balance": null, "auto_reload": null, "disclaimer": "Usage credits cover you when you hit your plan limits.", "can_purchase_credits": false, "can_toggle": false },
      "member_dashboard_available": false
    }"#;

    /// Corpo REAL do 401 (token inválido, mesma captura).
    const FIXTURE_401: &str = r#"{"type":"error","error":{"type":"authentication_error","message":"Invalid bearer token","details":{"error_visibility":"user_facing"}},"request_id":"req_011CdyKVafKhfnvUQ53KNP3m"}"#;

    #[test]
    fn resposta_real_vira_tres_janelas_incluindo_o_teto_por_modelo() {
        let v: Value = serde_json::from_str(FIXTURE_OAUTH).unwrap();
        let ws = parse_oauth_usage(&v);
        assert_eq!(ws.len(), 3);
        let cinco = ws.iter().find(|w| w.id == "5h").unwrap();
        assert_eq!(cinco.used_percent, 4.0);
        assert_eq!(cinco.window_minutes, Some(300));
        assert_eq!(cinco.resets_at, Some(1_786_575_000));
        let semana = ws.iter().find(|w| w.id == "7d").unwrap();
        assert_eq!(semana.used_percent, 37.0);
        assert_eq!(semana.resets_at, Some(1_786_996_800));
        // o teto POR MODELO só existe no limits[] e é o mais queimado: some
        // ele e o medidor mentiria por 21 pontos.
        let fable = ws.iter().find(|w| w.id == "7d:fable").unwrap();
        assert_eq!(fable.used_percent, 58.0);
        assert_eq!(fable.label, "7 dias · Fable");
        assert_eq!(fable.window_minutes, Some(10_080));
    }

    #[test]
    fn codinome_zerado_do_payload_nao_entra_como_janela() {
        // `nimbus_quill` (0%) está no corpo real e NÃO pode virar linha do
        // popover; e o fallback só olha as chaves de janela de verdade.
        let v: Value = serde_json::from_str(FIXTURE_OAUTH).unwrap();
        assert!(parse_oauth_usage(&v).iter().all(|w| w.id != "nimbus_quill"));
        let mut sem_limits = serde_json::from_str::<Value>(FIXTURE_OAUTH).unwrap();
        sem_limits.as_object_mut().unwrap().remove("limits");
        let ws = parse_oauth_usage(&sem_limits);
        assert_eq!(ws.len(), 2, "fallback = five_hour + seven_day");
        assert!(ws.iter().all(|w| w.id != "nimbus_quill"));
    }

    #[test]
    fn fallback_sem_limits_le_as_chaves_top_level() {
        let v = json!({
            "five_hour": { "utilization": 12.5, "resets_at": "2026-08-12T22:50:00.380826+00:00" },
            "seven_day": { "utilization": 40.0, "resets_at": null },
            "seven_day_opus": { "utilization": 61.0, "resets_at": "2026-08-17T20:00:00+00:00" }
        });
        let ws = parse_oauth_usage(&v);
        assert_eq!(ws.len(), 3);
        let cinco = ws.iter().find(|w| w.id == "5h").unwrap();
        assert_eq!(cinco.used_percent, 12.5);
        let semana = ws.iter().find(|w| w.id == "7d").unwrap();
        assert_eq!(semana.resets_at, None); // sem reset é honesto
        let opus = ws.iter().find(|w| w.id == "7d:opus").unwrap();
        assert_eq!(opus.used_percent, 61.0);
        assert_eq!(opus.resets_at, Some(1_786_996_800));
    }

    #[test]
    fn kind_novo_de_limite_degrada_sem_descartar() {
        let v = json!({ "limits": [
            { "kind": "monthly_all", "percent": 3, "resets_at": "2026-09-01T00:00:00Z" }
        ]});
        let ws = parse_oauth_usage(&v);
        assert_eq!(ws.len(), 1);
        assert_eq!(ws[0].id, "monthly_all"); // fail-open: o kind vira id
        assert_eq!(ws[0].window_minutes, None); // sem inventar duração
        assert_eq!(ws[0].resets_at, Some(1_788_220_800));
    }

    #[test]
    fn limite_sem_percentual_nao_vira_medidor() {
        let v = json!({ "limits": [ { "kind": "session", "resets_at": "2026-09-01T00:00:00Z" } ] });
        assert!(parse_oauth_usage(&v).is_empty());
        assert!(parse_oauth_usage(&json!({})).is_empty());
    }

    #[test]
    fn iso8601_do_endpoint_vira_epoch_em_segundos() {
        // valores REAIS do capture (conferidos contra o relógio do sistema)
        assert_eq!(
            parse_iso8601_secs("2026-08-12T22:50:00.380826+00:00"),
            Some(1_786_575_000)
        );
        assert_eq!(
            parse_iso8601_secs("2026-08-17T20:00:00.380849+00:00"),
            Some(1_786_996_800)
        );
        // "Z" e offset não-UTC também
        assert_eq!(parse_iso8601_secs("2026-08-17T20:00:00Z"), Some(1_786_996_800));
        assert_eq!(
            parse_iso8601_secs("2026-08-17T17:00:00-03:00"),
            Some(1_786_996_800)
        );
        // lixo não vira data
        assert_eq!(parse_iso8601_secs("amanhã de manhã"), None);
        assert_eq!(parse_iso8601_secs(""), None);
        assert_eq!(parse_iso8601_secs("2026-13-40T99:99:99Z"), None);
    }

    #[test]
    fn credencial_real_e_lida_sem_olhar_expiracao_local() {
        // mesmo SHAPE da credencial desta máquina (valores trocados: nenhum
        // token real mora no repo). expiresAt no passado NÃO invalida: quem
        // decide validade é o servidor.
        let raw = r#"{"claudeAiOauth":{
          "accessToken":"sk-ant-oat01-token-de-teste",
          "refreshToken":"sk-ant-ort01-token-de-teste",
          "expiresAt": 1000,
          "refreshTokenExpiresAt": 2000,
          "scopes":["user:inference","user:profile"],
          "subscriptionType":"max",
          "rateLimitTier":"default_claude_max_20x"
        }}"#;
        let cred = parse_credential_json(raw, "keychain").unwrap();
        assert_eq!(cred.subscription_type.as_deref(), Some("max"));
        assert_eq!(cred.origin, "keychain");
        // o Debug é redigido: nenhum log distraído vaza o bearer.
        let debug = format!("{cred:?}");
        assert!(debug.contains("<redigido>"));
        assert!(!debug.contains("sk-ant-oat01"));
    }

    #[test]
    fn credencial_sem_token_nao_vira_bearer_de_mentira() {
        assert!(parse_credential_json("{}", "arquivo").is_none());
        assert!(parse_credential_json(r#"{"claudeAiOauth":{}}"#, "arquivo").is_none());
        assert!(
            parse_credential_json(r#"{"claudeAiOauth":{"accessToken":"  "}}"#, "arquivo").is_none()
        );
        assert!(parse_credential_json("não é json", "arquivo").is_none());
    }

    /// Prova de ponta a ponta (NÃO roda no CI: precisa da credencial real
    /// desta máquina e de rede). É o que fecha o buraco entre a fixture e o
    /// mundo: lê o Keychain, monta o curl e imprime as janelas de verdade.
    /// `cargo test fetch_real_da_conta -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn fetch_real_da_conta() {
        match fetch("claude-code").await {
            Ok(snap) => {
                assert_eq!(snap.source, "oauth");
                assert!(!snap.windows.is_empty());
                for w in &snap.windows {
                    eprintln!(
                        "{} ({}) = {}% · reset {:?}",
                        w.label, w.id, w.used_percent, w.resets_at
                    );
                }
                eprintln!("plano: {:?}", snap.plan_type);
            }
            Err(e) => panic!("fetch real falhou: {} ({})", e.message, e.kind),
        }
    }

    #[test]
    fn status_http_vira_falha_com_tipo_util() {
        let auth = classify_http(401, FIXTURE_401);
        assert_eq!(auth.kind, "auth");
        assert!(auth.message.contains("reautenticar"));
        // a mensagem crua da API ("Invalid bearer token") não é o que o
        // usuário lê: o estado é "reautentique".
        assert!(!auth.message.contains("Invalid bearer token"));
        assert_eq!(classify_http(403, "{}").kind, "auth");
        assert_eq!(classify_http(429, "{}").kind, "rate-limited");
        let servidor = classify_http(503, r#"{"error":{"message":"upstream indisponível"}}"#);
        assert_eq!(servidor.kind, "protocol");
        assert!(servidor.message.contains("upstream indisponível"));
        assert_eq!(classify_http(418, "{}").kind, "protocol");
    }
}
