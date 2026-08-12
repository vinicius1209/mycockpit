//! Medidor de JANELA DE USO do plano (rate limits por provider) — a feature
//! "9% used · 4h 22m" do estudo do Orca (docs/competitors-orca.md, achado 1).
//!
//! PIPELINE SEPARADO do custo em $: turn_costs/ledger não se toca aqui. Custo
//! é quanto o turno gastou; janela é quanto do PLANO já queimou e quando
//! reseta. As duas fontes auditadas (12/08/2026, nesta máquina):
//!
//!   • claude 2.1.220 — a statusline recebe `rate_limits` no stdin A CADA
//!     TURNO (payload real na fixture abaixo). PUSH de carona: o script
//!     instalado (statusline_install.rs) POSTa pro receptor local
//!     (hook_gateway.rs), que chama `ingest_statusline` daqui. Nenhuma quota
//!     consumida.
//!   • codex 0.146 — `codex -s read-only -a untrusted app-server` responde
//!     `account/rateLimits/read` (fixture real abaixo; diferente do estudo do
//!     Orca, hoje só vem `primary` com a janela de 7d — `secondary: null`;
//!     a realidade manda). POLL read-only local, sem quota.
//!
//! Quem decide QUAL motor tem fonte é o registry (`Capabilities.usage_window`
//! em adapters.rs) — nada aqui compara nome de agent fora do match no ENUM de
//! dialeto (o enum confina o "como", padrão CommandSource/HookDialect).
//!
//! Metadados honestos: todo snapshot carrega `source` e `fetched_at`; falha de
//! fetch carrega `kind` (spawn/timeout/protocol/rate-limited) — a UI diz "de
//! 2 min atrás" ou "falhando desde X", nunca pisca erro nem inventa.

use crate::adapters::{capabilities_of, UsageWindowSource};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// Evento emitido pro webview a cada snapshot novo (ingest OU poll).
pub const SNAPSHOT_EVENT: &str = "usage://snapshot";

/// Dedupe de ingest da statusline: ela tica ~3×/s durante streaming e o dado
/// (janela do PLANO) não muda nessa granularidade — 1 snapshot a cada 30s
/// basta e poupa evento/render (regra copiada da política do Orca).
pub const INGEST_DEDUPE_MS: i64 = 30_000;

/// Uma janela de uso ("5h", "7d"): % usado + quando reseta.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    /// Id estável ("5h", "7d"; janela desconhecida degrada pra chave/duração
    /// crua — fail-open no render, nunca descarta dado real).
    pub id: String,
    /// Rótulo curto pt-BR pro popover ("5 h", "7 dias").
    pub label: String,
    pub used_percent: f64,
    /// Epoch em SEGUNDOS do reset, como os CLIs reportam. None = não veio.
    pub resets_at: Option<i64>,
    /// Duração da janela em minutos, quando o motor informa (codex informa;
    /// a statusline do claude não).
    pub window_minutes: Option<i64>,
}

/// Snapshot por agent — o que a UI mostra, com procedência e idade na cara.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub agent: String,
    /// "statusline" (push de carona) | "rpc" (poll read-only local).
    pub source: String,
    pub windows: Vec<UsageWindow>,
    /// Plano reportado pelo motor ("plus"…), quando existe.
    pub plan_type: Option<String>,
    /// Epoch ms de quando ESTE dado chegou/foi buscado (não de quando a UI
    /// olhou) — é o que alimenta o "de 2 min atrás".
    pub fetched_at: i64,
}

/// Falha de fetch com o TIPO na cara (a política de poll do lado TS decide o
/// backoff — e o stale-drop de 24h quando `kind == "rate-limited"`).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageFetchError {
    /// "unsupported" | "spawn" | "timeout" | "protocol" | "rate-limited"
    pub kind: String,
    pub message: String,
}

impl UsageFetchError {
    fn new(kind: &str, message: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            message: message.into(),
        }
    }
}

/// Estado vivo dos snapshots (fonte única que `usage_snapshots` hidrata no
/// boot do front) + carimbo do último ingest por agent (dedupe).
#[derive(Default)]
pub struct UsageState {
    snapshots: Mutex<HashMap<String, UsageSnapshot>>,
    last_ingest: Mutex<HashMap<String, i64>>,
}

// ---------------------------------------------------------------------------
// Peças PURAS (parse + política de dedupe), testadas com as fixtures REAIS.
// ---------------------------------------------------------------------------

/// Ingest ainda dentro da janela de dedupe? (`true` = pode ingerir)
pub fn should_ingest(last: Option<i64>, now_ms: i64) -> bool {
    match last {
        Some(t) => now_ms - t >= INGEST_DEDUPE_MS,
        None => true,
    }
}

/// Chave da statusline do claude → (id, rótulo, minutos). Chave nova que a
/// Anthropic inventar amanhã degrada pra própria chave como id/rótulo, sem
/// minutos — fail-open no render: dado real nunca é descartado por ser novo.
fn claude_window_meta(key: &str) -> (String, String, Option<i64>) {
    match key {
        "five_hour" => ("5h".into(), "5 h".into(), Some(300)),
        "seven_day" => ("7d".into(), "7 dias".into(), Some(10_080)),
        outra => (outra.into(), outra.into(), None),
    }
}

/// Duração em minutos → (id, rótulo) humanos ("5h"/"7 dias"); duração
/// quebrada degrada pra "Xmin" (fail-open, nunca inventa nem descarta).
fn window_meta_from_minutes(mins: i64) -> (String, String) {
    if mins > 0 && mins % 1440 == 0 {
        let d = mins / 1440;
        (
            format!("{d}d"),
            if d == 1 { "1 dia".into() } else { format!("{d} dias") },
        )
    } else if mins > 0 && mins % 60 == 0 {
        let h = mins / 60;
        (format!("{h}h"), format!("{h} h"))
    } else {
        (format!("{mins}min"), format!("{mins} min"))
    }
}

/// `rate_limits` do payload da statusline do claude → janelas. Payload REAL
/// (12/08/2026): `{"five_hour":{"used_percentage":23,"resets_at":1786557000},
/// "seven_day":{…}}`. Sem `rate_limits` (o 1º tick da sessão vem sem) ou sem
/// nenhuma janela válida → vazio, e o ingest não fabrica snapshot.
pub fn parse_statusline_rate_limits(payload: &Value) -> Vec<UsageWindow> {
    let Some(limits) = payload.get("rate_limits").and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (key, v) in limits {
        let Some(pct) = v.get("used_percentage").and_then(|x| x.as_f64()) else {
            continue; // janela sem percentual não vira medidor (não inventa 0%)
        };
        let (id, label, window_minutes) = claude_window_meta(key);
        out.push(UsageWindow {
            id,
            label,
            used_percent: pct,
            resets_at: v.get("resets_at").and_then(|x| x.as_i64()),
            window_minutes,
        });
    }
    out
}

/// `result` do `account/rateLimits/read` do codex → (janelas, plano).
/// Resposta REAL (12/08/2026): `rateLimits.primary = {"usedPercent":30,
/// "windowDurationMins":10080,"resetsAt":1787056559}`, `secondary: null`,
/// `planType: "plus"`. Lê primary E secondary genericamente — se o secondary
/// (janela 5h da era do estudo do Orca) voltar, entra sem mudar código.
pub fn parse_codex_rate_limits(result: &Value) -> (Vec<UsageWindow>, Option<String>) {
    let Some(limits) = result.get("rateLimits") else {
        return (Vec::new(), None);
    };
    let plan = limits
        .get("planType")
        .and_then(|x| x.as_str())
        .map(str::to_string);
    let mut out = Vec::new();
    for slot in ["primary", "secondary"] {
        let Some(w) = limits.get(slot).filter(|v| !v.is_null()) else {
            continue;
        };
        let Some(pct) = w.get("usedPercent").and_then(|x| x.as_f64()) else {
            continue;
        };
        let mins = w.get("windowDurationMins").and_then(|x| x.as_i64());
        let (id, label) = match mins {
            Some(m) => window_meta_from_minutes(m),
            None => (slot.into(), slot.into()),
        };
        out.push(UsageWindow {
            id,
            label,
            used_percent: pct,
            resets_at: w.get("resetsAt").and_then(|x| x.as_i64()),
            window_minutes: mins,
        });
    }
    (out, plan)
}

/// Payload de statusline → snapshot, gateado pela CAPABILITY: só motor que
/// declara `ClaudeStatusline` no registry aceita ingest por este dialeto
/// (motor desconhecido/sem fonte → None, degradação honesta). PURA.
pub fn statusline_snapshot(engine: &str, payload: &Value, now_ms: i64) -> Option<UsageSnapshot> {
    let caps = capabilities_of(engine)?;
    if caps.usage_window != Some(UsageWindowSource::ClaudeStatusline) {
        return None;
    }
    let windows = parse_statusline_rate_limits(payload);
    if windows.is_empty() {
        return None;
    }
    Some(UsageSnapshot {
        agent: engine.to_string(),
        source: "statusline".into(),
        windows,
        plan_type: None,
        fetched_at: now_ms,
    })
}

/// Mensagem de erro → tipo de falha ("429" vira "rate-limited": a política de
/// poll segura 24h o snapshot velho em vez de mostrar "Limited" — quota é
/// informativa, snapshot velho > erro piscando).
pub fn classify_failure(message: &str) -> &'static str {
    let m = message.to_lowercase();
    if m.contains("429") || m.contains("rate limit") || m.contains("rate_limit") {
        "rate-limited"
    } else {
        "protocol"
    }
}

// ---------------------------------------------------------------------------
// Ingest (chamado pelo hook_gateway) e comandos.
// ---------------------------------------------------------------------------

fn store_and_emit(app: &AppHandle, snapshot: UsageSnapshot) {
    let state = app.state::<UsageState>();
    if let Ok(mut map) = state.snapshots.lock() {
        map.insert(snapshot.agent.clone(), snapshot.clone());
    }
    // Falha de emit = webview fechando; o estado já está guardado pro próximo
    // `usage_snapshots` — nada silencioso onde alguém espera resultado.
    if let Err(e) = app.emit(SNAPSHOT_EVENT, &snapshot) {
        log::warn!("usage_window: falha ao emitir snapshot: {e}");
    }
}

/// Entrada do receptor local (H0): payload da statusline de `engine`.
/// `true` = virou snapshot novo; `false` = ignorado (sem rate_limits, motor
/// sem o dialeto, ou dentro do dedupe de 30s) — pro receptor, os dois são
/// 204: o script instalado é fail-open e nunca deve ver erro.
pub fn ingest_statusline(app: &AppHandle, engine: &str, payload: &Value) -> bool {
    let now = now_ms();
    let state = app.state::<UsageState>();
    {
        let last = state
            .last_ingest
            .lock()
            .ok()
            .and_then(|m| m.get(engine).copied());
        if !should_ingest(last, now) {
            return false;
        }
    }
    let Some(snapshot) = statusline_snapshot(engine, payload, now) else {
        return false;
    };
    if let Ok(mut m) = state.last_ingest.lock() {
        m.insert(engine.to_string(), now);
    }
    store_and_emit(app, snapshot);
    true
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Snapshots vivos (hidratação do store TS no boot).
#[tauri::command]
pub fn usage_snapshots(state: State<'_, UsageState>) -> Vec<UsageSnapshot> {
    state
        .snapshots
        .lock()
        .map(|m| m.values().cloned().collect())
        .unwrap_or_default()
}

/// Busca a janela de uso de `agent` AGORA (a política de QUANDO chamar mora
/// no lado TS — lib/usageWindow, passada do watchdog). Só motor que declara
/// fonte de POLL no registry; os demais respondem "unsupported" honesto.
#[tauri::command]
pub async fn usage_fetch(app: AppHandle, agent: String) -> Result<UsageSnapshot, UsageFetchError> {
    let source = capabilities_of(&agent).and_then(|c| c.usage_window);
    let snapshot = match source {
        Some(UsageWindowSource::CodexAppServer) => fetch_codex_app_server(&agent).await?,
        Some(UsageWindowSource::ClaudeStatusline) => {
            return Err(UsageFetchError::new(
                "unsupported",
                "este motor reporta por statusline (push), não por poll",
            ));
        }
        None => {
            return Err(UsageFetchError::new(
                "unsupported",
                "motor sem fonte de janela de uso",
            ));
        }
    };
    store_and_emit(&app, snapshot.clone());
    Ok(snapshot)
}

/// Probe do dialeto CodexAppServer: spawna o app-server em read-only,
/// initialize → initialized → account/rateLimits/read, mata o processo e
/// devolve o snapshot. Read-only local: NENHUMA quota consumida. O binário é
/// o do dialeto (o enum confina o fornecedor; ver adapters.rs).
async fn fetch_codex_app_server(agent: &str) -> Result<UsageSnapshot, UsageFetchError> {
    let mut cmd = tokio::process::Command::new("codex");
    cmd.args(["-s", "read-only", "-a", "untrusted", "app-server"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = cmd
        .spawn()
        .map_err(|e| UsageFetchError::new("spawn", format!("não consegui subir o codex app-server: {e}")))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| UsageFetchError::new("spawn", "app-server sem stdin"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| UsageFetchError::new("spawn", "app-server sem stdout"))?;

    // Mesmo handshake provado na mão (12/08/2026): a resposta do servidor nem
    // repete "jsonrpc" — classifica por forma (id=2 + result/error).
    let run = async {
        for msg in [
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
                "clientInfo":{"name":"mycockpit","title":"MyCockpit","version":env!("CARGO_PKG_VERSION")}
            }}),
            json!({"jsonrpc":"2.0","method":"initialized"}),
            json!({"jsonrpc":"2.0","id":2,"method":"account/rateLimits/read","params":{}}),
        ] {
            let mut line = msg.to_string();
            line.push('\n');
            stdin
                .write_all(line.as_bytes())
                .await
                .map_err(|e| UsageFetchError::new("protocol", format!("stdin fechou: {e}")))?;
        }
        let _ = stdin.flush().await;
        let mut lines = BufReader::new(stdout).lines();
        loop {
            let line = lines
                .next_line()
                .await
                .map_err(|e| UsageFetchError::new("protocol", format!("stdout falhou: {e}")))?
                .ok_or_else(|| {
                    UsageFetchError::new("protocol", "app-server encerrou antes de responder")
                })?;
            let Ok(v) = serde_json::from_str::<Value>(line.trim()) else {
                continue; // log no stdout: ignora (mesma postura do transporte)
            };
            if v.get("id").and_then(|x| x.as_i64()) != Some(2) {
                continue;
            }
            if let Some(err) = v.get("error") {
                let msg = err
                    .get("message")
                    .and_then(|x| x.as_str())
                    .unwrap_or("erro sem mensagem")
                    .to_string();
                return Err(UsageFetchError::new(classify_failure(&msg), msg));
            }
            let result = v.get("result").cloned().unwrap_or(Value::Null);
            let (windows, plan_type) = parse_codex_rate_limits(&result);
            if windows.is_empty() {
                return Err(UsageFetchError::new(
                    "protocol",
                    "resposta sem janelas de uso",
                ));
            }
            return Ok(UsageSnapshot {
                agent: agent.to_string(),
                source: "rpc".into(),
                windows,
                plan_type,
                fetched_at: now_ms(),
            });
        }
    };
    // Teto de 20s no probe inteiro: um app-server pendurado não pode segurar
    // a passada do vigia (o kill_on_drop derruba o processo junto).
    let out = tokio::time::timeout(std::time::Duration::from_secs(20), run)
        .await
        .unwrap_or_else(|_| {
            Err(UsageFetchError::new(
                "timeout",
                "o app-server não respondeu em 20s",
            ))
        });
    let _ = child.kill().await;
    out
}

// ---------------------------------------------------------------------------
// Testes — fixtures são os payloads REAIS capturados nesta máquina (ADR-016:
// fixture inventada esconde bug; estas vieram de um turno de teste do claude
// 2.1.220 e de um probe manual do codex 0.146, ambos em 12/08/2026).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Payload REAL da statusline (claude 2.1.220, turno de teste 12/08/2026;
    /// paths/ids do capture preservados — é o formato exato do stdin).
    const FIXTURE_STATUSLINE: &str = r#"{
      "session_id": "538081db-986d-4410-aeb9-05efcd75eb42",
      "transcript_path": "/Users/viniciusmachado/.claude/projects/x/538081db.jsonl",
      "cwd": "/tmp/statusline-capture",
      "model": { "id": "claude-haiku-4-5-20251001", "display_name": "Haiku 4.5" },
      "workspace": { "current_dir": "/tmp/statusline-capture", "project_dir": "/tmp/statusline-capture", "added_dirs": [] },
      "version": "2.1.220",
      "output_style": { "name": "default" },
      "cost": { "total_cost_usd": 0, "total_duration_ms": 77410, "total_api_duration_ms": 0, "total_lines_added": 0, "total_lines_removed": 0 },
      "context_window": { "total_input_tokens": 0, "total_output_tokens": 0, "context_window_size": 200000, "current_usage": null, "used_percentage": null, "remaining_percentage": null },
      "exceeds_200k_tokens": false,
      "fast_mode": false,
      "thinking": { "enabled": true },
      "rate_limits": {
        "five_hour": { "used_percentage": 23, "resets_at": 1786557000 },
        "seven_day": { "used_percentage": 28.999999999999996, "resets_at": 1786996800 }
      }
    }"#;

    /// 1º tick REAL da sessão (mesma captura): ainda SEM rate_limits.
    const FIXTURE_STATUSLINE_SEM_LIMITES: &str = r#"{
      "session_id": "e84b7745-c409-4664-a1f8-250d2a75a9c6",
      "version": "2.1.220",
      "cost": { "total_cost_usd": 0 },
      "context_window": { "context_window_size": 200000 }
    }"#;

    /// Resposta REAL do `account/rateLimits/read` (codex 0.146, 12/08/2026):
    /// só primary (7d); secondary null — diverge do estudo do Orca, e é a
    /// realidade que manda.
    const FIXTURE_CODEX: &str = r#"{
      "rateLimits": {
        "limitId": "codex", "limitName": null,
        "primary": { "usedPercent": 30, "windowDurationMins": 10080, "resetsAt": 1787056559 },
        "secondary": null,
        "credits": { "hasCredits": false, "unlimited": false, "balance": "0" },
        "individualLimit": null, "spendControlReached": false,
        "planType": "plus", "rateLimitReachedType": null
      },
      "rateLimitsByLimitId": {
        "codex": {
          "limitId": "codex", "limitName": null,
          "primary": { "usedPercent": 30, "windowDurationMins": 10080, "resetsAt": 1787056559 },
          "secondary": null,
          "credits": { "hasCredits": false, "unlimited": false, "balance": "0" },
          "individualLimit": null, "spendControlReached": false,
          "planType": "plus", "rateLimitReachedType": null
        }
      },
      "rateLimitResetCredits": {
        "availableCount": 1,
        "credits": [{ "id": "RateLimitResetCredit_x", "resetType": "codexRateLimits", "status": "available", "grantedAt": 1783965510, "expiresAt": 1786557510, "title": "Full reset", "description": "…" }]
      }
    }"#;

    #[test]
    fn statusline_real_vira_duas_janelas() {
        let payload: Value = serde_json::from_str(FIXTURE_STATUSLINE).unwrap();
        let ws = parse_statusline_rate_limits(&payload);
        assert_eq!(ws.len(), 2);
        let cinco = ws.iter().find(|w| w.id == "5h").unwrap();
        assert_eq!(cinco.used_percent, 23.0);
        assert_eq!(cinco.resets_at, Some(1_786_557_000));
        assert_eq!(cinco.window_minutes, Some(300));
        assert_eq!(cinco.label, "5 h");
        let sete = ws.iter().find(|w| w.id == "7d").unwrap();
        // o CLI manda float sujo (28.999999999999996) — preserva, formatação
        // é papel da UI.
        assert!((sete.used_percent - 29.0).abs() < 1e-9);
        assert_eq!(sete.window_minutes, Some(10_080));
    }

    #[test]
    fn primeiro_tick_sem_rate_limits_nao_fabrica_snapshot() {
        let payload: Value = serde_json::from_str(FIXTURE_STATUSLINE_SEM_LIMITES).unwrap();
        assert!(parse_statusline_rate_limits(&payload).is_empty());
        assert!(statusline_snapshot("claude-code", &payload, 1_000).is_none());
    }

    #[test]
    fn janela_futura_desconhecida_degrada_sem_descartar() {
        let payload = json!({ "rate_limits": {
            "opus_weekly": { "used_percentage": 12.5, "resets_at": 1786996800 }
        }});
        let ws = parse_statusline_rate_limits(&payload);
        assert_eq!(ws.len(), 1);
        assert_eq!(ws[0].id, "opus_weekly"); // fail-open: a chave vira id
        assert_eq!(ws[0].window_minutes, None); // sem inventar duração
    }

    #[test]
    fn codex_real_vira_janela_7d_com_plano() {
        let result: Value = serde_json::from_str(FIXTURE_CODEX).unwrap();
        let (ws, plan) = parse_codex_rate_limits(&result);
        assert_eq!(plan.as_deref(), Some("plus"));
        assert_eq!(ws.len(), 1); // secondary null NÃO vira janela fantasma
        assert_eq!(ws[0].id, "7d");
        assert_eq!(ws[0].label, "7 dias");
        assert_eq!(ws[0].used_percent, 30.0);
        assert_eq!(ws[0].resets_at, Some(1_787_056_559));
        assert_eq!(ws[0].window_minutes, Some(10_080));
    }

    #[test]
    fn codex_com_secondary_de_volta_entra_sem_mudar_codigo() {
        // a era do estudo do Orca tinha 5h no secondary: se voltar, entra.
        let result = json!({ "rateLimits": {
            "primary": { "usedPercent": 30, "windowDurationMins": 10080, "resetsAt": 1787056559 },
            "secondary": { "usedPercent": 9, "windowDurationMins": 300, "resetsAt": 1786557000 },
            "planType": "plus"
        }});
        let (ws, _) = parse_codex_rate_limits(&result);
        assert_eq!(ws.len(), 2);
        assert_eq!(ws[1].id, "5h");
        assert_eq!(ws[1].used_percent, 9.0);
    }

    #[test]
    fn ingest_gateado_pela_capability_nunca_pelo_nome() {
        let payload: Value = serde_json::from_str(FIXTURE_STATUSLINE).unwrap();
        // claude declara ClaudeStatusline → snapshot com source honesta.
        let snap = statusline_snapshot("claude-code", &payload, 42).unwrap();
        assert_eq!(snap.source, "statusline");
        assert_eq!(snap.fetched_at, 42);
        // codex tem fonte, mas o dialeto é RPC — statusline dele não existe.
        assert!(statusline_snapshot("codex", &payload, 42).is_none());
        // agy sem fonte e motor desconhecido: nada (degradação honesta).
        assert!(statusline_snapshot("agy", &payload, 42).is_none());
        assert!(statusline_snapshot("motor-inventado", &payload, 42).is_none());
    }

    #[test]
    fn dedupe_de_ingest_30s() {
        assert!(should_ingest(None, 0)); // 1º ingest sempre passa
        assert!(!should_ingest(Some(1_000), 1_000 + INGEST_DEDUPE_MS - 1));
        assert!(should_ingest(Some(1_000), 1_000 + INGEST_DEDUPE_MS));
    }

    #[test]
    fn classificacao_de_falha_429() {
        assert_eq!(classify_failure("HTTP 429 Too Many Requests"), "rate-limited");
        assert_eq!(classify_failure("Rate limit exceeded"), "rate-limited");
        assert_eq!(classify_failure("connection refused"), "protocol");
    }

    #[test]
    fn duracao_em_minutos_vira_rotulo_humano() {
        assert_eq!(window_meta_from_minutes(300), ("5h".into(), "5 h".into()));
        assert_eq!(
            window_meta_from_minutes(10_080),
            ("7d".into(), "7 dias".into())
        );
        assert_eq!(
            window_meta_from_minutes(1_440),
            ("1d".into(), "1 dia".into())
        );
        // duração quebrada não inventa unidade maior
        assert_eq!(
            window_meta_from_minutes(90),
            ("90min".into(), "90 min".into())
        );
    }
}
