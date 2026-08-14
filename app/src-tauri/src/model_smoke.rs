//! FUMAÇA DE UM TOKEN — M2 do docs/model-autonomy-plan.md.
//!
//! POR QUE existe: M1 pergunta ao CLI o que ele CONHECE; isso não responde se o
//! slug funciona com a SUA autenticação. Esse conhecimento hoje está escrito à
//! mão em `lib/agents.ts` ("gpt-5.6 puro é ID de API, rejeitado com auth
//! ChatGPT") porque alguém testou. Aqui o app testa: uma chamada MÍNIMA por
//! candidato, com o desfecho classificado no enum do plano.
//!
//! É a ÚNICA peça do app que gasta quota de propósito. As guardas são duras:
//!
//!   • **Nunca em laço nem no boot.** O comando só existe pra ser chamado por
//!     gesto ou agenda; e há uma janela mínima entre rodadas do MESMO motor
//!     (`ROUND_COOLDOWN_MS`) que faz um laço acidental falhar em vez de queimar
//!     dinheiro. Não há assinatura de ticker, nem chamada no setup.
//!   • **Teto de candidatos por rodada** (`MAX_CANDIDATES`): pedir mais é erro,
//!     não "roda os primeiros e cala" (truncar em silêncio é mentira barata).
//!   • **Custo mínimo por dialeto**: prompt de um token, sem ferramentas, sem
//!     sessão persistida, sem config do usuário. Medido nesta máquina em
//!     14/08/2026: o turno do claude caiu de $0,036 para $0,00055 só derrubando
//!     as definições de ferramenta (`--tools ""`).
//!   • **`unreachable` não é veredito.** Ele nunca promove nem rebaixa nada: no
//!     registro, uma tentativa `unreachable` NÃO sobrescreve um veredito antigo
//!     (`record_result`). "Não deu para saber" é diferente de "não funciona".
//!
//! O que foi provado NESTA máquina (14/08/2026) e virou fixture (ADR-016):
//!
//!   • claude 2.1.220 — slug inválido: `is_error: true`, `api_error_status:
//!     404`. Slug válido: `is_error: false` e `modelUsage[…]` com
//!     `contextWindow: 200000` e `canonicalModel` — é o único motor que reporta
//!     o teto de contexto, e por isso o único que hoje aponta `context-mismatch`.
//!   • codex 0.147 — slug inválido: `item.completed` com `type: "error"` e
//!     "Model metadata for `X` not found", seguido de um 400 do servidor. O
//!     aviso de metadata é o que separa "o CLI não conhece" (unknown-slug) de
//!     "a sua auth não alcança" (auth-rejected). Slug válido: `turn.completed`.
//!   • agy 1.1.13 — slug inválido: `status: "ERROR"` com "is not recognized as
//!     a known model", recusa LOCAL (sem chamada, custo zero). Slug válido:
//!     `status: "SUCCESS"`.
//!
//! Quem decide QUAL motor pode ser testado é o registry
//! (`Capabilities.model_smoke`) — nada aqui compara nome de agent fora do match
//! no ENUM de dialeto.

use crate::adapters::{capabilities_of, ModelSmokeDialect};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Teto de candidatos por rodada (plano: "teto de N candidatos por rodada").
pub const MAX_CANDIDATES: usize = 3;

/// Janela mínima entre rodadas do MESMO motor. Não é cache: é o freio que faz
/// um laço acidental falhar em vez de queimar quota (a fumaça é gesto/agenda,
/// não polling).
pub const ROUND_COOLDOWN_MS: i64 = 60_000;

/// Teto de cada chamada. Um CLI pendurado não segura a rodada inteira.
const CALL_TIMEOUT_SECS: u64 = 90;

/// Prompt de um token. Curto de propósito: o que importa é o DESFECHO, não a
/// resposta (e o system prompt de cada dialeto já pede uma letra só).
const SMOKE_PROMPT: &str = "ok";
const SMOKE_SYSTEM: &str = "Responda apenas: k";

const HISTORY_FILE: &str = "model-smoke.json";

/// Desfecho da fumaça — o enum do plano, sem meio-termo inventado.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SmokeOutcome {
    /// Aceito e respondeu.
    Ok,
    /// O slug existe, mas a SUA autenticação não o alcança.
    AuthRejected,
    /// O CLI não reconhece este slug.
    UnknownSlug,
    /// Aceito, mas o teto de contexto difere do catálogo.
    ContextMismatch,
    /// Não deu pra saber (rede, spawn, saída inesperada). NUNCA vira veredito.
    Unreachable,
}

impl SmokeOutcome {
    /// Isto é um VEREDITO sobre o slug? `unreachable` não é: ele não promove
    /// nem rebaixa nada, e é o único que responde `false` aqui.
    pub fn is_verdict(self) -> bool {
        self != SmokeOutcome::Unreachable
    }
}

/// Resultado carimbado de UMA fumaça (ADR-016: sem data, sem versão de CLI e
/// sem a frase do próprio CLI, não é evidência — é boato).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmokeResult {
    pub agent: String,
    /// O slug EXATO que foi testado.
    pub model: String,
    pub outcome: SmokeOutcome,
    /// A frase do PRÓPRIO CLI (evidência, não paráfrase). É ela que vira o
    /// "o Codex rejeitou este slug com a sua autenticação" do M3.
    pub detail: String,
    /// Versão do CLI que respondeu (probe na hora, sem cache).
    pub cli_version: Option<String>,
    /// Teto de contexto que o CLI reportou, quando reporta.
    pub context_window: Option<u64>,
    /// Teto que o catálogo (models.dev) diz, quando conhece o modelo.
    pub catalog_context: Option<u64>,
    /// Slug canônico pra quem o CLI resolveu o alias, quando informa.
    pub canonical_model: Option<String>,
    pub checked_at: i64,
}

// ---------------------------------------------------------------------------
// Peças PURAS: classificação por dialeto, testada com as saídas REAIS.
// ---------------------------------------------------------------------------

/// O que uma chamada produziu, antes de virar veredito. Separado do
/// `SmokeResult` porque a classificação é pura (testável sem spawnar CLI).
#[derive(Clone, Debug, PartialEq)]
pub struct SmokeReading {
    pub outcome: SmokeOutcome,
    pub detail: String,
    pub context_window: Option<u64>,
    pub canonical_model: Option<String>,
}

impl SmokeReading {
    fn new(outcome: SmokeOutcome, detail: impl Into<String>) -> Self {
        Self {
            outcome,
            detail: detail.into(),
            context_window: None,
            canonical_model: None,
        }
    }
}

/// stdout do `claude -p --output-format json` → leitura.
///
/// Real (14/08/2026): slug inválido devolve `is_error: true` +
/// `api_error_status: 404` + `result` com a frase; slug válido devolve
/// `is_error: false`, `result: "k"` e `modelUsage[<id>].contextWindow`.
pub(crate) fn read_claude(stdout: &str) -> SmokeReading {
    let Ok(v) = serde_json::from_str::<Value>(stdout.trim()) else {
        return SmokeReading::new(
            SmokeOutcome::Unreachable,
            format!("saída fora do formato JSON: {}", snippet(stdout)),
        );
    };
    let detail = v
        .get("result")
        .and_then(|x| x.as_str())
        .unwrap_or("sem mensagem")
        .to_string();
    if v.get("is_error").and_then(|x| x.as_bool()).unwrap_or(false) {
        let status = v.get("api_error_status").and_then(|x| x.as_i64());
        // 404 capturado de verdade (slug inexistente). 401/403 mapeados pela
        // semântica HTTP — NEEDS-VERIFY: o 1º caso real vira fixture aqui.
        let outcome = match status {
            Some(404) => SmokeOutcome::UnknownSlug,
            Some(401) | Some(403) => SmokeOutcome::AuthRejected,
            _ => SmokeOutcome::Unreachable,
        };
        return SmokeReading::new(outcome, detail);
    }
    // Sucesso: o `modelUsage` é chaveado pelo id resolvido — o app não sabe a
    // chave de antemão, então pega a primeira (a fumaça roda UM modelo só).
    let usage = v
        .get("modelUsage")
        .and_then(|x| x.as_object())
        .and_then(|m| m.values().next());
    SmokeReading {
        outcome: SmokeOutcome::Ok,
        detail,
        context_window: usage
            .and_then(|u| u.get("contextWindow"))
            .and_then(|x| x.as_u64()),
        canonical_model: usage
            .and_then(|u| u.get("canonicalModel"))
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
    }
}

/// stdout JSONL do `codex exec --json` → leitura.
///
/// Real (14/08/2026): quando o CLI não conhece o slug, ele avisa ANTES de
/// chamar — `item.completed` com `type: "error"` e "Model metadata for `X` not
/// found". Esse aviso é o divisor: com ele, a recusa seguinte é sobre um slug
/// que o CLI não conhece (`unknown-slug`); SEM ele, uma recusa do servidor é a
/// autenticação não alcançando o slug (`auth-rejected`).
pub(crate) fn read_codex(stdout: &str) -> SmokeReading {
    // O aviso de metadata e a falha do turno são guardados SEPARADOS: quando o
    // CLI é quem não conhece o slug, a frase dele é a evidência (a recusa do
    // servidor que vem depois é consequência, não causa).
    let mut metadata_msg: Option<String> = None;
    let mut falha: Option<String> = None;
    let mut completou = false;
    for line in stdout.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line.trim()) else {
            continue; // log do CLI no stdout: ignora (postura do transporte)
        };
        match v.get("type").and_then(|x| x.as_str()) {
            Some("item.completed") => {
                let item = v.get("item");
                let is_err = item
                    .and_then(|i| i.get("type"))
                    .and_then(|x| x.as_str())
                    .is_some_and(|t| t == "error");
                let msg = item
                    .and_then(|i| i.get("message"))
                    .and_then(|x| x.as_str())
                    .unwrap_or_default();
                if is_err && msg.contains("Model metadata for") && msg.contains("not found") {
                    metadata_msg.get_or_insert_with(|| msg.to_string());
                }
            }
            Some("turn.completed") => completou = true,
            Some("turn.failed") => {
                let msg = v
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("turno falhou sem mensagem");
                falha = Some(msg.to_string());
            }
            Some("error") => {
                if let Some(msg) = v.get("message").and_then(|x| x.as_str()) {
                    falha.get_or_insert_with(|| msg.to_string());
                }
            }
            _ => {}
        }
    }
    if completou {
        return SmokeReading::new(SmokeOutcome::Ok, "turno concluído");
    }
    if let Some(msg) = metadata_msg {
        // O próprio CLI disse que não conhece o slug: veredito na fonte.
        return SmokeReading::new(SmokeOutcome::UnknownSlug, msg);
    }
    let Some(msg) = falha else {
        return SmokeReading::new(
            SmokeOutcome::Unreachable,
            format!("saída sem desfecho reconhecível: {}", snippet(stdout)),
        );
    };
    // Sem aviso de metadata, o CLI conhece o slug: recusa 4xx do servidor é a
    // autenticação. Qualquer outra coisa é "não sei" (nunca veredito).
    let recusa = ["\"status\":400", "\"status\":401", "\"status\":403"]
        .iter()
        .any(|s| msg.replace(' ', "").contains(s));
    if recusa {
        SmokeReading::new(SmokeOutcome::AuthRejected, msg)
    } else {
        SmokeReading::new(SmokeOutcome::Unreachable, msg)
    }
}

/// stdout do `agy -p --output-format json` → leitura.
///
/// Real (14/08/2026): `status: "SUCCESS"` no aceite; `status: "ERROR"` com
/// "is not recognized as a known model or custom model in settings" quando o
/// slug não existe — recusa LOCAL, sem chamada e sem custo.
pub(crate) fn read_agy(stdout: &str) -> SmokeReading {
    let Ok(v) = serde_json::from_str::<Value>(stdout.trim()) else {
        return SmokeReading::new(
            SmokeOutcome::Unreachable,
            format!("saída fora do formato JSON: {}", snippet(stdout)),
        );
    };
    let status = v.get("status").and_then(|x| x.as_str()).unwrap_or_default();
    if status == "SUCCESS" {
        return SmokeReading::new(SmokeOutcome::Ok, "turno concluído");
    }
    let err = v
        .get("error")
        .and_then(|x| x.as_str())
        .unwrap_or("erro sem mensagem")
        .to_string();
    // Só a frase REAL vira veredito. Recusa de auth do agy ainda não foi
    // capturada nesta máquina — sem fixture, ela cai em `unreachable` ("não
    // sei"), que é honesto; inventar a frase é que esconderia bug (ADR-016).
    if err.contains("is not recognized as a known model") || err.contains("invalid model selection")
    {
        SmokeReading::new(SmokeOutcome::UnknownSlug, primeira_linha(&err))
    } else {
        SmokeReading::new(SmokeOutcome::Unreachable, primeira_linha(&err))
    }
}

/// A leitura vira veredito final confrontando o teto de contexto com o
/// catálogo: aceito mas com teto diferente é `context-mismatch` (o caso
/// "dentro do Codex são 272k, na API 1M" do plano). Sem um dos dois números,
/// nada muda — divergência que não dá pra medir não vira acusação.
pub(crate) fn apply_context_check(
    reading: SmokeReading,
    catalog_context: Option<u64>,
) -> SmokeReading {
    let (Some(vivo), Some(catalogo)) = (reading.context_window, catalog_context) else {
        return reading;
    };
    if reading.outcome != SmokeOutcome::Ok || vivo == catalogo {
        return reading;
    }
    SmokeReading {
        outcome: SmokeOutcome::ContextMismatch,
        detail: format!(
            "aceito, mas o CLI reporta {vivo} tokens de contexto e o catálogo diz {catalogo}"
        ),
        ..reading
    }
}

/// Trecho curto de uma saída inesperada (o detalhe é evidência, não despejo).
fn snippet(s: &str) -> String {
    let t = s.trim();
    if t.is_empty() {
        return "(vazio)".into();
    }
    t.chars().take(200).collect()
}

fn primeira_linha(s: &str) -> String {
    s.lines().next().unwrap_or(s).trim().to_string()
}

// ---------------------------------------------------------------------------
// Registro carimbado (mesmo padrão do catalog.rs: arquivo em app_data_dir +
// espelho em memória, escrita atômica).
// ---------------------------------------------------------------------------

static HISTORY_PATH: OnceLock<PathBuf> = OnceLock::new();
static HISTORY: Mutex<Option<Vec<SmokeResult>>> = Mutex::new(None);
/// Último início de rodada por motor (freio anti-laço; só memória, some no
/// restart — o objetivo é impedir laço vivo, não auditar).
static LAST_ROUND: Mutex<Option<HashMap<String, i64>>> = Mutex::new(None);

pub fn init(app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = HISTORY_PATH.set(dir.join(HISTORY_FILE));
    }
}

fn history_lock() -> std::sync::MutexGuard<'static, Option<Vec<SmokeResult>>> {
    HISTORY.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn ensure_loaded() {
    let mut guard = history_lock();
    if guard.is_some() {
        return;
    }
    let loaded = HISTORY_PATH
        .get()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice::<Vec<SmokeResult>>(&b).ok())
        .unwrap_or_default();
    *guard = Some(loaded);
}

fn save_to_disk(path: &Path, rows: &[SmokeResult]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("criar dir do histórico: {e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(rows).map_err(|e| format!("serializar histórico: {e}"))?;
    std::fs::write(&tmp, bytes).map_err(|e| format!("escrever histórico: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("publicar histórico: {e}"))
}

/// Aplica um resultado sobre o histórico (peça PURA, testada).
///
/// GUARDA DO PLANO: `unreachable` **não** promove nem rebaixa nada. Se já
/// existe um veredito pra este (motor, slug), a tentativa que não soube dizer
/// nada não o substitui. Sem veredito anterior, ela entra — porque "tentamos e
/// não deu" é dado, e sumir com a tentativa seria esconder estado.
pub(crate) fn record_result(rows: &mut Vec<SmokeResult>, novo: SmokeResult) {
    let pos = rows
        .iter()
        .position(|r| r.agent == novo.agent && r.model == novo.model);
    match pos {
        Some(i) => {
            if !novo.outcome.is_verdict() && rows[i].outcome.is_verdict() {
                return; // "não sei" não apaga o que já se sabia
            }
            rows[i] = novo;
        }
        None => rows.push(novo),
    }
}

/// A rodada pode começar agora? (freio anti-laço; peça PURA)
pub(crate) fn round_allowed(last: Option<i64>, now: i64) -> bool {
    match last {
        Some(t) => now - t >= ROUND_COOLDOWN_MS,
        None => true,
    }
}

// ---------------------------------------------------------------------------
// Chamadas por dialeto (o ÚNICO lugar que conhece as flags de cada fornecedor).
// ---------------------------------------------------------------------------

/// Roda o comando e devolve o stdout, ou uma leitura `unreachable` explicando.
/// Saída de erro do processo NÃO é descartada: quando o stdout não classifica,
/// o stderr vira o detalhe (ADR-017: nada de falha muda).
async fn run_capture(mut cmd: tokio::process::Command) -> Result<String, SmokeReading> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let out = tokio::time::timeout(Duration::from_secs(CALL_TIMEOUT_SECS), cmd.output())
        .await
        .map_err(|_| {
            SmokeReading::new(
                SmokeOutcome::Unreachable,
                format!("o CLI não respondeu em {CALL_TIMEOUT_SECS}s"),
            )
        })?
        .map_err(|e| {
            SmokeReading::new(SmokeOutcome::Unreachable, format!("não consegui rodar: {e}"))
        })?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    if stdout.trim().is_empty() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(SmokeReading::new(
            SmokeOutcome::Unreachable,
            if err.is_empty() {
                format!("o CLI saiu sem dizer nada ({})", out.status)
            } else {
                snippet(&err)
            },
        ));
    }
    Ok(stdout)
}

async fn smoke_claude(model: &str) -> SmokeReading {
    let mut cmd = tokio::process::Command::new("claude");
    cmd.args([
        "-p",
        SMOKE_PROMPT,
        "--model",
        model,
        "--output-format",
        "json",
        // custo mínimo: sem definições de ferramenta (o mesmo turno caiu de
        // $0,036 pra $0,00055), sem sessão em disco, sem MCP, sem
        // customização, um turno só.
        "--tools",
        "",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--safe-mode",
        "--max-turns",
        "1",
        "--system-prompt",
        SMOKE_SYSTEM,
    ]);
    match run_capture(cmd).await {
        Ok(stdout) => read_claude(&stdout),
        Err(reading) => reading,
    }
}

async fn smoke_codex(model: &str, cwd: &Path) -> SmokeReading {
    let mut cmd = tokio::process::Command::new("codex");
    // `exec` NÃO aceita `-a untrusted` (só o app-server aceita). O confinamento
    // aqui é `-s read-only` + prompt de um token: a fumaça não edita nada.
    cmd.args([
        "exec",
        "-m",
        model,
        "-s",
        "read-only",
        "--skip-git-repo-check",
        "--ephemeral",
        "--ignore-user-config",
        "--json",
    ])
    .arg("-C")
    .arg(cwd)
    .arg(SMOKE_PROMPT);
    match run_capture(cmd).await {
        Ok(stdout) => read_codex(&stdout),
        Err(reading) => reading,
    }
}

async fn smoke_agy(model: &str) -> SmokeReading {
    let mut cmd = tokio::process::Command::new("agy");
    cmd.args([
        "-p",
        SMOKE_PROMPT,
        "--model",
        model,
        "--output-format",
        "json",
    ]);
    match run_capture(cmd).await {
        Ok(stdout) => read_agy(&stdout),
        Err(reading) => reading,
    }
}

// ---------------------------------------------------------------------------
// Comandos.
// ---------------------------------------------------------------------------

/// Uma RODADA de fumaça: testa até `MAX_CANDIDATES` slugs de um motor e grava
/// o resultado carimbado.
///
/// SÓ POR GESTO OU AGENDA. Não há chamador automático deste comando no app, e o
/// `ROUND_COOLDOWN_MS` faz um laço acidental falhar em vez de gastar quota.
#[tauri::command]
pub async fn model_smoke(
    app: AppHandle,
    agent: String,
    models: Vec<String>,
) -> Result<Vec<SmokeResult>, String> {
    init(&app);
    let dialect = capabilities_of(&agent)
        .and_then(|c| c.model_smoke)
        .ok_or_else(|| format!("{agent} não tem como testar um modelo (capability ausente)"))?;
    if models.is_empty() {
        return Err("nenhum candidato para testar".into());
    }
    if models.len() > MAX_CANDIDATES {
        return Err(format!(
            "a fumaça testa no máximo {MAX_CANDIDATES} candidatos por rodada (pedidos: {})",
            models.len()
        ));
    }
    let now = crate::usage_window::now_ms();
    {
        let mut guard = LAST_ROUND
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let map = guard.get_or_insert_with(HashMap::new);
        if !round_allowed(map.get(&agent).copied(), now) {
            return Err(format!(
                "a fumaça de {agent} rodou agora há pouco (ela é por gesto, não por laço)"
            ));
        }
        map.insert(agent.clone(), now);
    }

    // A versão do CLI é lida UMA vez por rodada (é o carimbo de todas).
    let cli_version = crate::detect::detected_version(&agent).await;
    // O catálogo (models.dev) é o outro lado do `context-mismatch`: sem o init,
    // o lookup devolveria None e a divergência passaria batida.
    crate::catalog::init(&app);
    // Diretório de trabalho da fumaça: o dialeto que roda "num projeto" precisa
    // de um cwd, e ele nunca é o repo do usuário (a fumaça não olha código).
    // Falha em preparar o app_data_dir cai no temp — nada some em silêncio,
    // porque o diretório escolhido só afeta um turno read-only de um token.
    let cwd = app
        .path()
        .app_data_dir()
        .ok()
        .filter(|d| std::fs::create_dir_all(d).is_ok())
        .unwrap_or_else(std::env::temp_dir);

    let mut out = Vec::new();
    for model in models {
        // match EXAUSTIVO: dialeto novo no registry não cai em `_ =>` mudo.
        let reading = match dialect {
            ModelSmokeDialect::ClaudePrintJson => smoke_claude(&model).await,
            ModelSmokeDialect::CodexExecJson => smoke_codex(&model, &cwd).await,
            ModelSmokeDialect::AgyPrintJson => smoke_agy(&model).await,
        };
        let catalog_context = crate::catalog::lookup(&model).and_then(|m| m.context);
        let reading = apply_context_check(reading, catalog_context);
        out.push(SmokeResult {
            agent: agent.clone(),
            model,
            outcome: reading.outcome,
            detail: reading.detail,
            cli_version: cli_version.clone(),
            context_window: reading.context_window,
            catalog_context,
            canonical_model: reading.canonical_model,
            checked_at: crate::usage_window::now_ms(),
        });
    }

    ensure_loaded();
    let rows = {
        let mut guard = history_lock();
        let rows = guard.get_or_insert_with(Vec::new);
        for r in &out {
            record_result(rows, r.clone());
        }
        rows.clone()
    };
    if let Some(path) = HISTORY_PATH.get() {
        // Falha de escrita não some: o resultado da rodada volta pra quem pediu
        // (a evidência não se perde), mas o log registra que o carimbo não
        // sobreviveu ao restart.
        if let Err(e) = save_to_disk(path, &rows) {
            log::warn!("model_smoke: não consegui gravar o histórico: {e}");
        }
    }
    Ok(out)
}

/// Tudo que já foi testado, com carimbo. Nunca falha: histórico vazio é
/// "ainda não testamos", não erro.
#[tauri::command]
pub fn model_smoke_history(app: AppHandle) -> Vec<SmokeResult> {
    init(&app);
    ensure_loaded();
    history_lock().clone().unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Testes — as fixtures são as saídas REAIS capturadas nesta máquina em
// 14/08/2026 (ADR-016), rodando a fumaça de verdade contra um slug válido e um
// inválido de cada motor.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// claude 2.1.220, `--model claude-naoexiste-9-9` (recortado nos campos
    /// que a classificação lê).
    const CLAUDE_SLUG_INVALIDO: &str = r#"{"is_error":true,"duration_api_ms":0,"num_turns":1,"stop_reason":"stop_sequence","session_id":"98b60080-efbe-40d4-8b5b-8af07c14d62f","total_cost_usd":0,"modelUsage":{},"terminal_reason":"api_error","subtype":"success","api_error_status":404,"result":"There's an issue with the selected model (claude-naoexiste-9-9). It may not exist or you may not have access to it. Run --model to pick a different model.","type":"result","duration_ms":778}"#;

    /// claude 2.1.220, `--model haiku --tools ""` — a rodada de $0,00055.
    const CLAUDE_SLUG_VALIDO: &str = r#"{"is_error":false,"duration_api_ms":1465,"num_turns":1,"stop_reason":"end_turn","session_id":"78fb5f4e-06a1-4548-ac03-32acfcd0c883","total_cost_usd":0.000548,"usage":{"input_tokens":163,"output_tokens":77},"modelUsage":{"claude-haiku-4-5-20251001":{"inputTokens":163,"outputTokens":77,"costUSD":0.000548,"contextWindow":200000,"maxOutputTokens":32000,"canonicalModel":"claude-haiku-4-5","provider":"firstParty"}},"terminal_reason":"completed","subtype":"success","api_error_status":null,"result":"k","type":"result","duration_ms":2153}"#;

    /// codex 0.147, `-m gpt-9.9-naoexiste` (JSONL literal).
    const CODEX_SLUG_INVALIDO: &str = r#"{"type":"thread.started","thread_id":"01a0009e-f7b4-7622-9f79-bbf2ebb90bb1"}
{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata for `gpt-9.9-naoexiste` not found. Defaulting to fallback metadata; this can degrade performance and cause issues."}}
{"type":"turn.started"}
{"type":"error","message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'gpt-9.9-naoexiste' model is not supported when using Codex with a ChatGPT account.\"}}"}
{"type":"turn.failed","error":{"message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'gpt-9.9-naoexiste' model is not supported when using Codex with a ChatGPT account.\"}}"}}"#;

    /// codex 0.147, `-m gpt-5.6-luna` (JSONL literal).
    const CODEX_SLUG_VALIDO: &str = r#"{"type":"thread.started","thread_id":"01a0009f-737e-7cf2-80fd-2b32b3b34529"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Got it. What would you like to work on?"}}
{"type":"turn.completed","usage":{"input_tokens":11652,"cached_input_tokens":8960,"output_tokens":15}}"#;

    /// agy 1.1.13, `--model gemini-9.9-naoexiste` (recusa LOCAL, custo zero).
    const AGY_SLUG_INVALIDO: &str = r#"{"conversation_id":"","status":"ERROR","response":"","error":"invalid model selection (--model \"gemini-9.9-naoexiste\" --effort \"\"): model gemini-9.9-naoexiste is not recognized as a known model or custom model in settings\nAvailable models:\n  Gemini 3.7 Flash (High)\n  Gemini 3.7 Flash (Medium)","duration_seconds":0,"num_turns":0,"usage":{"input_tokens":0,"output_tokens":0}}"#;

    /// agy 1.1.13, `--model gemini-3.7-flash-low`.
    const AGY_SLUG_VALIDO: &str = r#"{"conversation_id":"6aeb464b-f4e3-4a89-99de-9ed6f96e2a72","status":"SUCCESS","response":"How can I help you today? Feel free to share what project or task you'd like to work on!\n","duration_seconds":3.475172,"num_turns":1,"usage":{"input_tokens":15969,"output_tokens":28,"total_tokens":15997}}"#;

    fn result(agent: &str, model: &str, outcome: SmokeOutcome) -> SmokeResult {
        SmokeResult {
            agent: agent.into(),
            model: model.into(),
            outcome,
            detail: "detalhe".into(),
            cli_version: Some("0.0.0".into()),
            context_window: None,
            catalog_context: None,
            canonical_model: None,
            checked_at: 1_000,
        }
    }

    #[test]
    fn claude_slug_inexistente_e_404_vira_unknown_slug_com_a_frase_do_cli() {
        let r = read_claude(CLAUDE_SLUG_INVALIDO);
        assert_eq!(r.outcome, SmokeOutcome::UnknownSlug);
        assert!(r.detail.contains("claude-naoexiste-9-9"));
        assert_eq!(r.context_window, None);
    }

    #[test]
    fn claude_slug_valido_vira_ok_e_traz_contexto_e_slug_canonico() {
        let r = read_claude(CLAUDE_SLUG_VALIDO);
        assert_eq!(r.outcome, SmokeOutcome::Ok);
        assert_eq!(r.context_window, Some(200_000));
        assert_eq!(r.canonical_model.as_deref(), Some("claude-haiku-4-5"));
    }

    #[test]
    fn claude_401_e_403_falam_de_autenticacao_e_status_estranho_e_nao_sei() {
        let com_status = |s: &str| {
            format!(r#"{{"is_error":true,"api_error_status":{s},"result":"recusado"}}"#)
        };
        assert_eq!(
            read_claude(&com_status("401")).outcome,
            SmokeOutcome::AuthRejected
        );
        assert_eq!(
            read_claude(&com_status("403")).outcome,
            SmokeOutcome::AuthRejected
        );
        // 500 não diz nada sobre o slug: "não sei", nunca veredito.
        assert_eq!(
            read_claude(&com_status("500")).outcome,
            SmokeOutcome::Unreachable
        );
    }

    #[test]
    fn codex_avisa_que_nao_conhece_o_slug_antes_de_chamar_e_isso_vence_o_400() {
        // O MESMO 400 aparece pro slug inexistente e pro ID de API puro
        // (`gpt-5.6`): o que separa os dois de uma recusa de auth é o aviso de
        // metadata. Sem essa leitura, tudo viraria "auth-rejected" errado.
        let r = read_codex(CODEX_SLUG_INVALIDO);
        assert_eq!(r.outcome, SmokeOutcome::UnknownSlug);
        assert!(r.detail.contains("Model metadata for"));
    }

    #[test]
    fn codex_turno_concluido_vira_ok() {
        assert_eq!(read_codex(CODEX_SLUG_VALIDO).outcome, SmokeOutcome::Ok);
    }

    #[test]
    fn codex_recusa_400_sem_aviso_de_metadata_e_a_sua_autenticacao() {
        // Slug que o CLI CONHECE mas o servidor recusa: é a auth que não
        // alcança — a frase que o M3 vai mostrar pro humano.
        let jsonl = r#"{"type":"turn.started"}
{"type":"turn.failed","error":{"message":"{\"type\":\"error\",\"status\":400,\"error\":{\"message\":\"The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account.\"}}"}}"#;
        let r = read_codex(jsonl);
        assert_eq!(r.outcome, SmokeOutcome::AuthRejected);
        assert!(r.detail.contains("ChatGPT account"));
    }

    #[test]
    fn codex_sem_desfecho_reconhecivel_e_nao_sei() {
        assert_eq!(
            read_codex("{\"type\":\"thread.started\"}").outcome,
            SmokeOutcome::Unreachable
        );
        assert_eq!(read_codex("").outcome, SmokeOutcome::Unreachable);
    }

    #[test]
    fn agy_recusa_local_de_slug_vira_unknown_slug_sem_a_lista_inteira_no_detalhe() {
        let r = read_agy(AGY_SLUG_INVALIDO);
        assert_eq!(r.outcome, SmokeOutcome::UnknownSlug);
        assert!(r.detail.contains("is not recognized as a known model"));
        // O agy despeja a lista de modelos no erro; o detalhe fica na 1ª linha.
        assert!(!r.detail.contains("Gemini 3.7 Flash"));
    }

    #[test]
    fn agy_success_vira_ok() {
        assert_eq!(read_agy(AGY_SLUG_VALIDO).outcome, SmokeOutcome::Ok);
    }

    #[test]
    fn saida_que_nao_e_json_nunca_vira_veredito() {
        // Fail-open na leitura: CLI que cuspiu lixo não condena slug nenhum.
        for r in [read_claude("Segmentation fault"), read_agy("<html>502</html>")] {
            assert_eq!(r.outcome, SmokeOutcome::Unreachable);
            assert!(!r.outcome.is_verdict());
        }
    }

    #[test]
    fn contexto_diferente_do_catalogo_vira_context_mismatch() {
        let base = read_claude(CLAUDE_SLUG_VALIDO);
        // O caso do plano: o CLI diz um teto, o catálogo (API) diz outro.
        let r = apply_context_check(base.clone(), Some(1_000_000));
        assert_eq!(r.outcome, SmokeOutcome::ContextMismatch);
        assert!(r.detail.contains("200000") && r.detail.contains("1000000"));
        // Igual = segue ok; sem número dos dois lados, nada muda.
        assert_eq!(
            apply_context_check(base.clone(), Some(200_000)).outcome,
            SmokeOutcome::Ok
        );
        assert_eq!(apply_context_check(base, None).outcome, SmokeOutcome::Ok);
    }

    #[test]
    fn contexto_nao_transforma_uma_recusa_em_mismatch() {
        let recusa = read_claude(CLAUDE_SLUG_INVALIDO);
        assert_eq!(
            apply_context_check(recusa, Some(1_000_000)).outcome,
            SmokeOutcome::UnknownSlug
        );
    }

    #[test]
    fn unreachable_nao_promove_nem_rebaixa_um_veredito_gravado() {
        let mut rows = vec![result("codex", "gpt-5.4", SmokeOutcome::Ok)];
        record_result(&mut rows, result("codex", "gpt-5.4", SmokeOutcome::Unreachable));
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].outcome, SmokeOutcome::Ok, "\"não sei\" não apaga o que se sabia");

        // …mas um veredito NOVO substitui o antigo (o slug foi aposentado).
        record_result(&mut rows, result("codex", "gpt-5.4", SmokeOutcome::UnknownSlug));
        assert_eq!(rows[0].outcome, SmokeOutcome::UnknownSlug);
    }

    #[test]
    fn tentativa_sem_veredito_anterior_e_gravada_em_vez_de_sumir() {
        let mut rows: Vec<SmokeResult> = Vec::new();
        record_result(&mut rows, result("agy", "gemini-9", SmokeOutcome::Unreachable));
        assert_eq!(rows.len(), 1, "\"tentamos e não deu\" também é estado");
        assert!(!rows[0].outcome.is_verdict());
    }

    #[test]
    fn resultado_de_outro_motor_nao_sobrescreve_o_mesmo_slug() {
        let mut rows = vec![result("agy", "claude-sonnet-4-6", SmokeOutcome::Ok)];
        record_result(
            &mut rows,
            result("claude-code", "claude-sonnet-4-6", SmokeOutcome::UnknownSlug),
        );
        assert_eq!(rows.len(), 2, "o veredito é do par (motor, slug)");
    }

    #[test]
    fn rodada_seguida_e_barrada_pelo_freio_anti_laco() {
        assert!(round_allowed(None, 10_000), "a primeira rodada sempre passa");
        assert!(!round_allowed(Some(10_000), 10_000 + ROUND_COOLDOWN_MS - 1));
        assert!(round_allowed(Some(10_000), 10_000 + ROUND_COOLDOWN_MS));
    }

    #[test]
    fn so_o_unreachable_deixa_de_ser_veredito() {
        for o in [
            SmokeOutcome::Ok,
            SmokeOutcome::AuthRejected,
            SmokeOutcome::UnknownSlug,
            SmokeOutcome::ContextMismatch,
        ] {
            assert!(o.is_verdict(), "{o:?} decide algo sobre o slug");
        }
        assert!(!SmokeOutcome::Unreachable.is_verdict());
    }

    /// Prova MANUAL da fumaça de ponta a ponta (spawna o CLI de verdade e
    /// gasta um token por candidato — por isso `#[ignore]`, mesma disciplina
    /// do `fetch_real_da_conta` em claude_usage.rs). É a forma reprodutível de
    /// re-auditar o dialeto quando um CLI mudar de saída:
    ///
    ///   cargo test -- --ignored --nocapture fumaca_real
    ///
    /// Desfechos observados em 14/08/2026 (as fixtures acima vieram DESTA
    /// rodada): claude haiku → Ok (contexto 200000), claude-naoexiste-9-9 →
    /// UnknownSlug; codex gpt-5.6-luna → Ok, gpt-9.9-naoexiste → UnknownSlug;
    /// agy gemini-3.7-flash-low → Ok, gemini-9.9-naoexiste → UnknownSlug.
    #[tokio::test]
    #[ignore = "spawna os CLIs reais e gasta um token por candidato"]
    async fn fumaca_real_nesta_maquina() {
        let cwd = std::env::temp_dir();
        let casos: [(&str, &str); 6] = [
            ("claude-code", "haiku"),
            ("claude-code", "claude-naoexiste-9-9"),
            ("codex", "gpt-5.6-luna"),
            ("codex", "gpt-9.9-naoexiste"),
            ("agy", "gemini-3.7-flash-low"),
            ("agy", "gemini-9.9-naoexiste"),
        ];
        for (agent, model) in casos {
            let dialect = capabilities_of(agent)
                .and_then(|c| c.model_smoke)
                .expect("motor declara dialeto de fumaça");
            let r = match dialect {
                ModelSmokeDialect::ClaudePrintJson => smoke_claude(model).await,
                ModelSmokeDialect::CodexExecJson => smoke_codex(model, &cwd).await,
                ModelSmokeDialect::AgyPrintJson => smoke_agy(model).await,
            };
            eprintln!(
                "{agent:<12} {model:<24} → {:?}  ctx={:?}  canonical={:?}\n             {}",
                r.outcome,
                r.context_window,
                r.canonical_model,
                primeira_linha(&r.detail)
            );
        }
    }

    #[test]
    fn desfecho_serializa_no_vocabulario_do_plano() {
        // Mexeu aqui, mexa no espelho TS (lib/modelSmoke.ts).
        let json = serde_json::to_string(&vec![
            SmokeOutcome::Ok,
            SmokeOutcome::AuthRejected,
            SmokeOutcome::UnknownSlug,
            SmokeOutcome::ContextMismatch,
            SmokeOutcome::Unreachable,
        ])
        .unwrap();
        assert_eq!(
            json,
            r#"["ok","auth-rejected","unknown-slug","context-mismatch","unreachable"]"#
        );
    }
}
