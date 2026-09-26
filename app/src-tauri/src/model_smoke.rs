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
    HISTORY
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
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
            SmokeReading::new(
                SmokeOutcome::Unreachable,
                format!("não consegui rodar: {e}"),
            )
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

/// Lê o desfecho de um `opencode run --format json`. Recebe os DOIS fluxos
/// porque o motor os usa para coisas diferentes, medido em 26/08/2026:
///
///   • stdout, NDJSON: `step_finish` = turno fechou; `{"type":"error"}` carrega
///     a recusa do provedor (ex. `Insufficient balance`, 401);
///   • stderr: slug inexistente vira log com `ProviderModelNotFoundError`, e o
///     stdout fica VAZIO.
///
/// Sem olhar o stderr, "modelo que não existe" viraria `unreachable` ("não
/// sei") em vez de `unknown-slug` — e é exatamente essa a pergunta do curador.
pub(crate) fn read_opencode(stdout: &str, stderr: &str) -> SmokeReading {
    for line in stdout.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        match v.get("type").and_then(|t| t.as_str()) {
            Some("step_finish") => return SmokeReading::new(SmokeOutcome::Ok, "turno concluído"),
            Some("error") => {
                let msg = v
                    .get("error")
                    .and_then(|e| e.get("data"))
                    .and_then(|d| d.get("message"))
                    .and_then(|m| m.as_str())
                    .unwrap_or("erro sem mensagem");
                return SmokeReading::new(SmokeOutcome::Unreachable, primeira_linha(msg));
            }
            _ => {}
        }
    }
    // Só a frase REAL vira veredito (ADR-016): esta foi capturada na máquina.
    if stderr.contains("ProviderModelNotFoundError") {
        return SmokeReading::new(
            SmokeOutcome::UnknownSlug,
            "o opencode não conhece este modelo neste provedor",
        );
    }
    SmokeReading::new(
        SmokeOutcome::Unreachable,
        if stderr.trim().is_empty() {
            "o opencode saiu sem dizer nada".to_string()
        } else {
            primeira_linha(stderr)
        },
    )
}

/// Agente MÍNIMO da fumaça do OpenCode: sem ferramenta nenhuma e com o
/// system prompt de uma linha, injetado por `OPENCODE_CONFIG_CONTENT` (não
/// toca a config do usuário). O agente padrão manda ~12 mil tokens de prompt
/// e definições de ferramenta; medido em 26/09/2026 no `gemini-3.5-flash-lite`,
/// a entrada caiu de 12049 para 117 tokens (US$ 0,0039 → 0,00028). Foi o
/// agente padrão que fez uma fumaça no `claude-fable-5-1` custar US$ 0,20, só
/// em escrita de cache. Os desfechos de erro (slug inexistente, modelo
/// bloqueado) saem idênticos nos dois modos, conferido no mesmo dia.
const OPENCODE_SMOKE_AGENT: &str = "frota-fumaca";

fn opencode_smoke_config() -> String {
    serde_json::json!({ "agent": { OPENCODE_SMOKE_AGENT: {
        "mode": "primary", "prompt": SMOKE_SYSTEM, "tools": { "*": false }
    }}})
    .to_string()
}

fn opencode_smoke_args(model: &str) -> Vec<&str> {
    vec![
        "run",
        "--pure",
        "--format",
        "json",
        "--agent",
        OPENCODE_SMOKE_AGENT,
        "-m",
        model,
        "--",
        SMOKE_PROMPT,
    ]
}

async fn smoke_opencode(model: &str) -> SmokeReading {
    let mut cmd = tokio::process::Command::new("opencode");
    cmd.args(opencode_smoke_args(model))
        .env("OPENCODE_CONFIG_CONTENT", opencode_smoke_config())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // Captura PRÓPRIA (não o `run_capture`): aquele só olha stderr quando o
    // stdout está vazio, e aqui os dois carregam vereditos diferentes.
    let out = match tokio::time::timeout(Duration::from_secs(CALL_TIMEOUT_SECS), cmd.output()).await
    {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => {
            return SmokeReading::new(
                SmokeOutcome::Unreachable,
                format!("não consegui rodar: {e}"),
            )
        }
        Err(_) => {
            return SmokeReading::new(
                SmokeOutcome::Unreachable,
                format!("o CLI não respondeu em {CALL_TIMEOUT_SECS}s"),
            )
        }
    };
    read_opencode(
        &String::from_utf8_lossy(&out.stdout),
        &String::from_utf8_lossy(&out.stderr),
    )
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
            ModelSmokeDialect::OpenCodeRunJson => smoke_opencode(&model).await,
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
#[path = "model_smoke_tests.rs"]
mod tests;
