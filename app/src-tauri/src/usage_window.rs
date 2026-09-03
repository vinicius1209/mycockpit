//! Medidor de JANELA DE USO do plano (rate limits por provider) — a feature
//! "9% used · 4h 22m" do estudo do Orca (docs/competitors-orca.md, achado 1).
//!
//! PIPELINE SEPARADO do custo em $: turn_costs/ledger não se toca aqui. Custo
//! é quanto o turno gastou; janela é quanto do PLANO já queimou e quando
//! reseta. As fontes auditadas (12/08/2026, nesta máquina):
//!
//!   • claude (conta OAuth) — `GET /api/oauth/usage` com o bearer que o
//!     próprio CLI guarda: é a fonte PRINCIPAL do claude e mora em
//!     claude_usage.rs (com a fixture real do corpo e o registro do que NÃO
//!     se faz: PTY oculto e refresh de token). POLL, independente de sessão,
//!     nenhuma quota consumida.
//!   • claude 2.1.220 — a statusline recebe `rate_limits` no stdin A CADA
//!     TURNO (payload real na fixture abaixo). PUSH de carona: o script
//!     instalado (statusline_install.rs) POSTa pro receptor local
//!     (hook_gateway.rs), que chama `ingest_statusline` daqui. Nenhuma quota
//!     consumida — mas só dispara em sessão INTERATIVA: em `-p`/headless o
//!     comando de statusline nunca roda (provado empiricamente), e o app roda
//!     todas as conversas em headless. Por isso ela é ingest OPORTUNISTA
//!     (carona quando o usuário usa o terminal), nunca a fonte principal.
//!   • codex 0.146→0.149 — `codex -s read-only -a never app-server` responde
//!     (a 0.149 REMOVEU o valor `untrusted` da flag e a sonda parou de subir;
//!      o `approvalPolicy` do turno segue aceitando `untrusted` no PROTOCOLO)
//!     `account/rateLimits/read` (fixture real abaixo; diferente do estudo do
//!     Orca, hoje só vem `primary` com a janela de 7d — `secondary: null`;
//!     a realidade manda). POLL read-only local, sem quota.
//!   • agy 1.1.13 — `agy -p "/usage" --output-format json` (16/08/2026). O CLI
//!     expande o comando de cliente em modo print e devolve `command.data`
//!     ESTRUTURADO: grupos × buckets, cada bucket com `id` estável, `window`
//!     e `remaining_fraction`. POLL headless e SEM QUOTA — o mesmo payload
//!     traz `num_turns: 0`, `duration_seconds: 0`, `usage` inteiro zerado e
//!     `conversation_id` VAZIO (nenhum turno, nenhuma conversa criada). O
//!     ADR-038 tinha cravado `agy: None` porque a única fonte auditada era o
//!     `/credits` (saldo absoluto); o motivo caiu, a capability mudou.
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
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// Evento emitido pro webview a cada snapshot novo (ingest OU poll).
pub const SNAPSHOT_EVENT: &str = "usage://snapshot";

/// Teto do probe do app-server (o mesmo de sempre): um servidor pendurado não
/// pode segurar a passada do vigia.
const APP_SERVER_TIMEOUT_SECS: u64 = 20;

/// Dedupe de ingest da statusline: ela tica ~3×/s durante streaming e o dado
/// (janela do PLANO) não muda nessa granularidade — 1 snapshot a cada 30s
/// basta e poupa evento/render (regra copiada da política do Orca).
pub const INGEST_DEDUPE_MS: i64 = 30_000;

/// Teto que a sonda do agy dá AO PRÓPRIO CLI (`--print-timeout`, a flag cujo
/// default de 5m0s matou dois turnos no incidente 2026-08-16). Aqui é uma
/// CONSULTA, não um turno: a chamada medida em 16/08/2026 levou ~4,5s de
/// parede, e desses o `--print-timeout` só cobre a espera DEPOIS do init (o
/// payload reporta `duration_seconds: 0`, porque o comando é resolvido no
/// cliente). 15s é ~3× a viagem inteira e — o que importa — fica ABAIXO do
/// nosso teto de processo, pra que quem desista primeiro seja o `agy`, com o
/// `status: ERROR` + `error` dele, em vez de um kill cego nosso.
const AGY_PRINT_TIMEOUT: &str = "15s";

/// Teto do PROCESSO da sonda do agy (o mesmo número das outras sondas da casa:
/// app-server, `agy models`). Rede anti-zumbi, não o gate normal — o
/// `--print-timeout` acima é quem deve disparar antes e explicar.
const AGY_PROBE_TIMEOUT_SECS: u64 = 20;

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
    /// "oauth" (leitura da conta) | "statusline" (push de carona) | "rpc"
    /// (poll read-only local). A UI mostra ISTO como procedência.
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
    /// "unsupported" | "spawn" | "timeout" | "protocol" | "rate-limited" |
    /// "auth" (sem credencial ou credencial recusada: a UI diz "reautentique",
    /// nunca erro cru, e a política de poll não martela).
    pub kind: String,
    pub message: String,
}

impl UsageFetchError {
    pub(crate) fn new(kind: &str, message: impl Into<String>) -> Self {
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
            if d == 1 {
                "1 dia".into()
            } else {
                format!("{d} dias")
            },
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

/// `window` do bucket do agy → (rótulo pt-BR, minutos). Os dois valores vivos
/// hoje são `weekly` (7 dias = 10.080 min) e `5h` (300 min), e os rótulos são
/// os MESMOS que o claude/codex já usam no popover ("7 dias", "5 h") — janela
/// igual não pode ter dois nomes na mesma tela. `window` novo degrada pro
/// próprio valor como rótulo, SEM minutos (fail-open: dado real nunca é
/// descartado por ser novo, duração nunca é inventada).
fn agy_window_meta(window: &str) -> (String, Option<i64>) {
    match window {
        "weekly" => ("7 dias".into(), Some(10_080)),
        "5h" => ("5 h".into(), Some(300)),
        outra => (outra.into(), None),
    }
}

/// Nome do GRUPO como o agy o entrega, sem o "Models"/"models" do fim.
///
/// O grupo entra no rótulo porque os pools são SEPARADOS (Gemini × Claude/GPT
/// têm limites próprios) e dois "7 dias" no popover sem dizer de quem são
/// seriam pior que não mostrar — a mesma regra que o `weekly_scoped` do claude
/// já segue (`"7 dias · Fable"`, claude_usage.rs). O nome é DADO do provider,
/// não copy nossa (mesmo tratamento do `planType: "plus"` e dos rótulos de
/// `agy models`): a única mexida é tirar o sufixo redundante, e mesmo essa
/// recua se sobrar vazio.
fn agy_group_tag(name: &str) -> Option<String> {
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    let curto = name
        .strip_suffix(" Models")
        .or_else(|| name.strip_suffix(" models"))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(name);
    Some(curto.to_string())
}

/// `command.data` do `agy -p "/usage"` → janelas.
///
/// Lê o bloco ESTRUTURADO, nunca o `response`. O `response` traz o mesmo dado
/// em TSV, e é tentador — mas ali o percentual já vem arredondado a inteiro
/// ("97%") e não há id de bucket, ou seja, é um contrato pior. Sem
/// `command.data` (versão do CLI que não expande `/usage`, ou comando que
/// mudou de forma), o retorno é VAZIO e o fetch falha honesto: nada é
/// reconstruído a partir do texto.
///
/// CONVERSÃO: o contrato deles é `remaining_fraction` (quanto SOBRA), o nosso
/// é `used_percent` (quanto QUEIMOU) — `used = (1 - remaining) * 100`, sem
/// arredondar. O CLI manda float sujo (0.9691848158836365), o pipeline
/// preserva e quem arredonda é a UI (`fmtPct`), igual ao que o claude já faz
/// com 28.999999999999996.
pub fn parse_agy_usage(payload: &Value) -> Vec<UsageWindow> {
    let Some(groups) = payload
        .pointer("/command/data/groups")
        .and_then(|v| v.as_array())
    else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for g in groups {
        let tag = g
            .get("name")
            .and_then(|x| x.as_str())
            .and_then(agy_group_tag);
        let Some(buckets) = g.get("buckets").and_then(|v| v.as_array()) else {
            continue;
        };
        for b in buckets {
            let Some(id) = b
                .get("id")
                .and_then(|x| x.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
            else {
                // sem id estável não há chave de render nem continuidade entre
                // leituras; não some calado.
                log::warn!("usage_window: bucket de `/usage` do agy sem id: {b}");
                continue;
            };
            let Some(rem) = b.get("remaining_fraction").and_then(|x| x.as_f64()) else {
                // bucket sem fração não vira medidor (não inventa 0% nem 100%).
                log::warn!("usage_window: bucket `{id}` sem remaining_fraction");
                continue;
            };
            let window = b.get("window").and_then(|x| x.as_str()).unwrap_or("");
            let (janela, window_minutes) = agy_window_meta(window);
            out.push(UsageWindow {
                id: id.to_string(),
                label: match &tag {
                    Some(t) => format!("{janela} · {t}"),
                    None => janela,
                },
                used_percent: (1.0 - rem) * 100.0,
                // `reset_time` é RFC 3339 ("2026-08-19T17:02:16Z"); o contrato
                // de `resets_at` é epoch em SEGUNDOS. Formato irreconhecível
                // vira None — janela sem reset é honesta, reset inventado não.
                resets_at: b
                    .get("reset_time")
                    .and_then(|x| x.as_str())
                    .and_then(parse_iso8601_secs),
                window_minutes,
            });
        }
    }
    out
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

/// ISO 8601 → epoch em SEGUNDOS (a unidade que `UsageWindow::resets_at` usa).
/// Aceita "2026-08-12T22:50:00.380826+00:00" (claude) e "2026-08-19T17:02:16Z"
/// (agy). Formato que não reconhecemos vira `None`: janela sem reset é
/// honesta, reset inventado não.
///
/// Mora aqui, e não no dialeto que precisou dela primeiro (claude_usage.rs),
/// porque é helper do CAMPO — dois dialetos de fornecedores diferentes já a
/// usam e nenhum deles é dono dela.
pub fn parse_iso8601_secs(s: &str) -> Option<i64> {
    let s = s.trim();
    let bytes = s.as_bytes();
    if bytes.len() < 19 {
        return None;
    }
    let num = |ini: usize, fim: usize| -> Option<i64> { s.get(ini..fim)?.parse::<i64>().ok() };
    if bytes[4] != b'-' || bytes[7] != b'-' || (bytes[10] != b'T' && bytes[10] != b' ') {
        return None;
    }
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (h, mi, sec) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || sec > 60 {
        return None;
    }
    // Fuso: "Z" (ou ausente) = UTC; "+HH:MM"/"-HH:MM" desloca. Fração de
    // segundo é descartada de propósito (a granularidade do medidor é minuto).
    let resto = &s[19..];
    let offset_secs = match resto.rfind(['+', '-']) {
        Some(pos) => {
            let sinal = if resto.as_bytes()[pos] == b'+' { 1 } else { -1 };
            let fuso = &resto[pos + 1..];
            let (hh, mm) = match fuso.split_once(':') {
                Some((hh, mm)) => (hh.parse::<i64>().ok()?, mm.parse::<i64>().ok()?),
                None if fuso.len() == 4 => (
                    fuso[..2].parse::<i64>().ok()?,
                    fuso[2..].parse::<i64>().ok()?,
                ),
                None => return None,
            };
            sinal * (hh * 3600 + mm * 60)
        }
        None => 0,
    };
    Some(days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + sec - offset_secs)
}

/// Dias desde 1970-01-01 (algoritmo civil-from-days do Howard Hinnant, o mesmo
/// que as libs de data usam; evita puxar dependência de calendário só por um
/// campo de reset).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
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

pub(crate) fn now_ms() -> i64 {
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
/// dialeto de POLL no registry (`usage_window_poll`); os demais respondem
/// "unsupported" honesto.
#[tauri::command]
pub async fn usage_fetch(app: AppHandle, agent: String) -> Result<UsageSnapshot, UsageFetchError> {
    let source = capabilities_of(&agent).and_then(|c| c.usage_window_poll);
    let snapshot = match source {
        Some(UsageWindowSource::ClaudeOauth) => crate::claude_usage::fetch(&agent).await?,
        Some(UsageWindowSource::CodexAppServer) => fetch_codex_app_server(&agent).await?,
        Some(UsageWindowSource::AgyPrintCommand) => fetch_agy_print(&agent).await?,
        Some(UsageWindowSource::ClaudeStatusline) => {
            // o contrato do registry proíbe (statusline é push), mas o match
            // fica exaustivo e honesto em vez de entrar num `_ =>` mudo.
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

/// Probe do dialeto CodexAppServer: uma sonda one-shot no MESMO canal
/// app-server que o transporte de turno já conhece (codex_appserver::probe_once
/// — handshake único no app, nada de segundo canal), pedindo
/// `account/rateLimits/read`. Read-only local: NENHUMA quota consumida. O
/// método é do dialeto (o enum confina o fornecedor; ver adapters.rs).
async fn fetch_codex_app_server(agent: &str) -> Result<UsageSnapshot, UsageFetchError> {
    let result = crate::codex_appserver::probe_once(
        "account/rateLimits/read",
        json!({}),
        APP_SERVER_TIMEOUT_SECS,
    )
    .await
    .map_err(|e| match e.kind {
        // erro DO SERVIDOR: a frase dele é que diz se foi limite ou protocolo.
        "rpc" => UsageFetchError::new(classify_failure(&e.message), e.message),
        kind => UsageFetchError::new(kind, e.message),
    })?;
    let (windows, plan_type) = parse_codex_rate_limits(&result);
    if windows.is_empty() {
        return Err(UsageFetchError::new(
            "protocol",
            "resposta sem janelas de uso",
        ));
    }
    Ok(UsageSnapshot {
        agent: agent.to_string(),
        source: "rpc".into(),
        windows,
        plan_type,
        fetched_at: now_ms(),
    })
}

/// Probe do dialeto AgyPrintCommand: `agy -p "/usage" --output-format json`.
///
/// SEM QUOTA e SEM CONVERSA. Medido nesta máquina em 16/08/2026: exit 0,
/// `num_turns: 0`, `duration_seconds: 0`, `usage` inteiro zerado e
/// `conversation_id` VAZIO — o comando é resolvido no cliente, que consulta o
/// backend de quota e volta. (Um turno de verdade, no mesmo CLI, devolve um
/// UUID em `conversation_id`; este devolve string vazia.)
///
/// O que NÃO se passa aqui, de propósito: `--disable-slash-commands` (é
/// justamente a expansão do `/usage` que faz a sonda existir), `--add-dir`,
/// `--dangerously-skip-permissions` e `--sandbox` — nada disso tem efeito numa
/// consulta que não abre turno, e pedir permissão que não se usa é ruído.
async fn fetch_agy_print(agent: &str) -> Result<UsageSnapshot, UsageFetchError> {
    let mut cmd = tokio::process::Command::new("agy");
    cmd.arg("-p")
        .arg("/usage")
        .arg("--output-format")
        .arg("json")
        .arg("--print-timeout")
        .arg(AGY_PRINT_TIMEOUT)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let out = tokio::time::timeout(Duration::from_secs(AGY_PROBE_TIMEOUT_SECS), cmd.output())
        .await
        .map_err(|_| {
            UsageFetchError::new(
                "timeout",
                format!("`agy -p \"/usage\"` não respondeu em {AGY_PROBE_TIMEOUT_SECS}s"),
            )
        })?
        .map_err(|e| {
            UsageFetchError::new(
                "spawn",
                format!("não consegui rodar `agy -p \"/usage\"`: {e}"),
            )
        })?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    // Exit != 0 do print mode: o `agy` costuma calar no stderr (incidente
    // 2026-08-16) e dizer o motivo no `result.error` do JSON — então tenta o
    // corpo ANTES de cair na frase genérica do código de saída.
    if !out.status.success() {
        let corpo = serde_json::from_str::<Value>(&stdout).ok();
        let motivo = corpo
            .as_ref()
            .and_then(crate::adapters::agy_result_error)
            .or_else(|| {
                let e = String::from_utf8_lossy(&out.stderr).trim().to_string();
                (!e.is_empty()).then_some(e)
            })
            .unwrap_or_else(|| {
                format!(
                    "`agy -p \"/usage\"` saiu com código {:?}",
                    out.status.code()
                )
            });
        return Err(UsageFetchError::new(classify_failure(&motivo), motivo));
    }
    let payload: Value = serde_json::from_str(&stdout)
        .map_err(|e| UsageFetchError::new("protocol", format!("resposta não era JSON: {e}")))?;
    if let Some(motivo) = crate::adapters::agy_result_error(&payload) {
        return Err(UsageFetchError::new(classify_failure(&motivo), motivo));
    }
    let windows = parse_agy_usage(&payload);
    if windows.is_empty() {
        // Degradação honesta: sem o bloco estruturado NÃO se reconstrói nada a
        // partir do `response` em TSV. Sem snapshot é melhor que snapshot com
        // percentual arredondado e sem id.
        return Err(UsageFetchError::new(
            "protocol",
            "`/usage` respondeu sem o bloco estruturado (`command.data`)",
        ));
    }
    Ok(UsageSnapshot {
        agent: agent.to_string(),
        source: "print".into(),
        windows,
        // o `/usage` do agy descreve os grupos, mas não nomeia plano nenhum.
        plan_type: None,
        fetched_at: now_ms(),
    })
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

    /// Payload REAL, verbatim, de `agy -p "/usage" --output-format json`
    /// (agy 1.1.13, nesta máquina, 16/08/2026). Exit 0. Note o que ele prova
    /// além das janelas: `conversation_id` VAZIO, `num_turns` 0,
    /// `duration_seconds` 0 e `usage` inteiro zerado — a sonda não abre turno,
    /// não cria conversa e não consome quota.
    const FIXTURE_AGY_USAGE: &str = r#"{
      "conversation_id": "",
      "status": "SUCCESS",
      "response": "Gemini Models\tWeekly Limit Remaining\t97%\t2026-08-19T17:02:16Z\nGemini Models\tFive Hour Limit Remaining\t94%\t2026-08-17T01:35:53Z\nClaude and GPT models\tWeekly Limit Remaining\t100%\t2026-08-24T01:16:40Z\nClaude and GPT models\tFive Hour Limit Remaining\t100%\t2026-08-17T06:16:40Z\n",
      "duration_seconds": 0,
      "num_turns": 0,
      "usage": { "input_tokens": 0, "output_tokens": 0, "thinking_tokens": 0, "cache_read_tokens": 0, "total_tokens": 0 },
      "command": {
        "name": "usage",
        "data": {
          "description": "Within each group, models share a weekly limit and a 5-hour limit. Quota is consumed proportionally to the cost of the tokens.",
          "groups": [
            {
              "name": "Gemini Models",
              "description": "Models within this group: Gemini Flash, Gemini Pro",
              "buckets": [
                { "id": "gemini-weekly", "name": "Weekly Limit Remaining", "description": "You have used some of your weekly limit, it will fully refresh in 2 days, 15 hours.", "window": "weekly", "remaining_fraction": 0.9691848158836365, "reset_time": "2026-08-19T17:02:16Z" },
                { "id": "gemini-5h", "name": "Five Hour Limit Remaining", "description": "You have used some of your 5-hour limit, it will fully refresh in 19 minutes.", "window": "5h", "remaining_fraction": 0.9379197955131531, "reset_time": "2026-08-17T01:35:53Z" }
              ]
            },
            {
              "name": "Claude and GPT models",
              "description": "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
              "buckets": [
                { "id": "3p-weekly", "name": "Weekly Limit Remaining", "window": "weekly", "remaining_fraction": 1, "reset_time": "2026-08-24T01:16:40Z" },
                { "id": "3p-5h", "name": "Five Hour Limit Remaining", "window": "5h", "remaining_fraction": 1, "reset_time": "2026-08-17T06:16:40Z" }
              ]
            }
          ]
        }
      }
    }"#;

    /// Desfecho de ERRO REAL do print mode do agy, capturado forçando
    /// `--print-timeout 2s` num turno de verdade (16/08/2026). Fecha o buraco
    /// de prova §5.1 do incidente 2026-08-16: o `response` vem VAZIO mesmo, e
    /// a razão mora num campo que o relatório não conhecia, `error`. Exit 1,
    /// stderr VAZIO.
    const FIXTURE_AGY_ERRO: &str = r#"{
      "conversation_id": "83fedb99-22c9-408c-83a4-b550c705aa55",
      "status": "ERROR",
      "response": "",
      "error": "timeout waiting for response",
      "duration_seconds": 0.041688,
      "num_turns": 1,
      "usage": { "input_tokens": 0, "output_tokens": 0, "thinking_tokens": 0, "cache_read_tokens": 0, "total_tokens": 0 }
    }"#;

    #[test]
    fn agy_real_vira_quatro_janelas_em_dois_pools() {
        let payload: Value = serde_json::from_str(FIXTURE_AGY_USAGE).unwrap();
        let ws = parse_agy_usage(&payload);
        // os dois pools são separados: mostrar só um mentiria sobre o outro.
        assert_eq!(ws.len(), 4);
        assert_eq!(
            ws.iter().map(|w| w.id.as_str()).collect::<Vec<_>>(),
            ["gemini-weekly", "gemini-5h", "3p-weekly", "3p-5h"]
        );
        // rótulo = janela pt-BR (a MESMA do claude/codex) + o grupo, porque
        // dois "7 dias" sem dono no popover seriam indistinguíveis.
        assert_eq!(
            ws.iter().map(|w| w.label.as_str()).collect::<Vec<_>>(),
            [
                "7 dias · Gemini",
                "5 h · Gemini",
                "7 dias · Claude and GPT",
                "5 h · Claude and GPT"
            ]
        );
        assert_eq!(
            ws.iter().map(|w| w.window_minutes).collect::<Vec<_>>(),
            [Some(10_080), Some(300), Some(10_080), Some(300)]
        );
        assert_eq!(
            ws.iter().map(|w| w.resets_at).collect::<Vec<_>>(),
            [
                Some(1_787_158_936),
                Some(1_786_930_553),
                Some(1_787_534_200),
                Some(1_786_947_400)
            ]
        );
    }

    #[test]
    fn fracao_restante_vira_percentual_usado_sem_arredondar() {
        let payload: Value = serde_json::from_str(FIXTURE_AGY_USAGE).unwrap();
        let ws = parse_agy_usage(&payload);
        // used = (1 - remaining) * 100, com o float sujo preservado: o CLI
        // manda 0.9691848158836365 e quem arredonda é a UI (fmtPct), não o
        // pipeline. 3,08% ≠ o "97%" que o TSV do `response` mostraria.
        assert!((ws[0].used_percent - 3.081_518_411_636_352_5).abs() < 1e-12);
        assert!((ws[1].used_percent - 6.208_020_448_684_692).abs() < 1e-12);
        // 100% restante = 0% usado, exato (nada de -0.0 nem 1e-14).
        assert_eq!(ws[2].used_percent, 0.0);
        assert_eq!(ws[3].used_percent, 0.0);
    }

    #[test]
    fn sem_bloco_estruturado_nao_se_reconstroi_do_texto() {
        // o `response` em TSV está lá inteiro, e mesmo assim nada sai: ele tem
        // percentual arredondado e nenhum id de bucket (contrato pior).
        let so_texto = json!({
            "status": "SUCCESS",
            "response": "Gemini Models\tWeekly Limit Remaining\t97%\t2026-08-19T17:02:16Z\n"
        });
        assert!(parse_agy_usage(&so_texto).is_empty());
        // e o `/credits`, que é command_result de outra forma, também não vira
        // janela nenhuma (era o motivo do `None` original do ADR-038).
        let credits = json!({
            "status": "SUCCESS",
            "command": { "name": "credits", "data": { "balance": "12.34" } }
        });
        assert!(parse_agy_usage(&credits).is_empty());
    }

    #[test]
    fn bucket_torto_do_agy_degrada_sem_inventar() {
        let payload = json!({ "command": { "name": "usage", "data": { "groups": [{
            "name": "Grupo Novo",
            "buckets": [
                // window que não conhecemos: rótulo degrada pro próprio valor
                // e a duração NÃO é inventada.
                { "id": "novo-mensal", "window": "monthly", "remaining_fraction": 0.5, "reset_time": "2026-09-01T00:00:00Z" },
                // sem fração não vira medidor (não fabrica 0%).
                { "id": "sem-fracao", "window": "5h", "reset_time": "2026-08-17T06:16:40Z" },
                // sem id não há chave estável de render.
                { "window": "5h", "remaining_fraction": 0.9 },
                // reset em formato irreconhecível: janela entra, reset não.
                { "id": "reset-torto", "window": "5h", "remaining_fraction": 0.25, "reset_time": "amanhã cedo" }
            ]
        }]}}});
        let ws = parse_agy_usage(&payload);
        assert_eq!(ws.len(), 2);
        assert_eq!(ws[0].id, "novo-mensal");
        assert_eq!(ws[0].label, "monthly · Grupo Novo");
        assert_eq!(ws[0].window_minutes, None);
        assert_eq!(ws[1].id, "reset-torto");
        assert_eq!(ws[1].resets_at, None);
        assert_eq!(ws[1].used_percent, 75.0);
    }

    #[test]
    fn grupo_sem_nome_util_nao_gruda_sufixo_vazio_no_rotulo() {
        assert_eq!(agy_group_tag("Gemini Models").as_deref(), Some("Gemini"));
        assert_eq!(
            agy_group_tag("Claude and GPT models").as_deref(),
            Some("Claude and GPT")
        );
        // "Models" sozinho não vira string vazia: recua pro nome original.
        assert_eq!(agy_group_tag("Models").as_deref(), Some("Models"));
        assert_eq!(agy_group_tag("   "), None);
        // grupo sem nome ⇒ rótulo é só a janela (nada de " · " pendurado).
        let payload = json!({ "command": { "data": { "groups": [{
            "buckets": [{ "id": "x", "window": "weekly", "remaining_fraction": 0.2 }]
        }]}}});
        assert_eq!(parse_agy_usage(&payload)[0].label, "7 dias");
    }

    #[test]
    fn desfecho_de_erro_do_agy_diz_o_motivo_pelo_campo_error() {
        let erro: Value = serde_json::from_str(FIXTURE_AGY_ERRO).unwrap();
        // o `response` do ERROR vem VAZIO (medido); quem carrega a razão é o
        // `error` — o campo que o relatório do incidente não conhecia.
        assert_eq!(erro.get("response").unwrap().as_str(), Some(""));
        assert_eq!(
            crate::adapters::agy_result_error(&erro).as_deref(),
            Some("timeout waiting for response")
        );
        // SUCCESS não tem motivo a extrair.
        let ok: Value = serde_json::from_str(FIXTURE_AGY_USAGE).unwrap();
        assert_eq!(crate::adapters::agy_result_error(&ok), None);
        // ERROR sem nenhum dos dois campos: None honesto, sem frase inventada.
        assert_eq!(
            crate::adapters::agy_result_error(&json!({ "status": "ERROR" })),
            None
        );
        // e o `response` serve de reserva quando o `error` não vem.
        assert_eq!(
            crate::adapters::agy_result_error(&json!({ "status": "ERROR", "response": "x" }))
                .as_deref(),
            Some("x")
        );
    }

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
        // agy TEM fonte desde 16/08/2026, mas o dialeto dele é print — a
        // statusline dele não existe, e o gate é por DIALETO, não por "tem ou
        // não tem medidor".
        assert!(statusline_snapshot("agy", &payload, 42).is_none());
        // motor desconhecido: nada (degradação honesta).
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
        assert_eq!(
            classify_failure("HTTP 429 Too Many Requests"),
            "rate-limited"
        );
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
