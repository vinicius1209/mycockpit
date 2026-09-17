//! Leitura do ponto em que o PRÓPRIO motor compacta (ADR-196, ADR-198).
//!
//! O anel de contexto usava a janela do modelo como teto e oferecia compactar a
//! 70% dela: palpite nosso. O limiar real é do motor, e cada um o guarda num
//! lugar (estudo em `docs/contexto-dos-motores-estudo.md`):
//!
//! - Claude Code: responde `get_context_usage` por `control_request`.
//! - Codex: calcula de `config/read` (app-server) mais o catálogo local de
//!   modelos, com a fórmula do 0.154.0 validada no binário ao token.
//! - agy: grava, a cada geração, a própria estimativa e o limite no banco da
//!   conversa. Não é contrato: sem o campo, nada se afirma.
//!
//! Sonda FORA do turno (AGENTS.md desta pasta, item 1): quem chama é o anel
//! visível ou o fim de uma compactação, nunca o `run_agent`. Todo processo tem
//! prazo e morre no drop. Falha é erro com motivo, nunca leitura vazia.

use crate::adapters::{self, ContextCeilingProbe};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// Medido: 0,7s (Claude sem hooks nem MCP), 0,3s (app-server do Codex). O teto
/// cobre CLI fria e disco lento.
const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
const REQUEST_ID: &str = "frota-context-ceiling";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextCategory {
    pub name: String,
    pub tokens: u64,
    /// `used` · `deferred` · `buffer` · `free`, como o motor classifica.
    pub kind: String,
}

/// De onde veio o limiar. A UI explica cada origem com palavras diferentes,
/// porque a confiança não é a mesma.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CeilingOrigin {
    /// O motor respondeu por um canal estruturado dele.
    EngineReport,
    /// Calculado da configuração efetiva e do catálogo do motor.
    EngineConfig,
    /// Lido do registro interno que o motor grava a cada geração.
    EngineRecord,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineContext {
    /// Footprint atual da sessão segundo o motor, quando ele informa. Depois
    /// de compactar é a estimativa do contexto resumido.
    pub total_tokens: Option<u64>,
    /// Contagem PRÓPRIA do motor que ele compara ao limiar, quando difere do
    /// uso da API (agy: estimativa da última geração). Vale para o momento em
    /// que foi lida.
    pub engine_estimate: Option<u64>,
    /// Janela que o motor considera, quando ele informa.
    pub max_tokens: Option<u64>,
    /// Onde a compactação automática dispara. `None` quando desligada ou
    /// quando o motor não permite afirmar.
    pub auto_compact_threshold: Option<u64>,
    pub auto_compact_enabled: bool,
    /// Detalhe da fonte do limiar (`model-default`, `env`, `catalogo`…).
    pub source: Option<String>,
    pub origin: CeilingOrigin,
    pub model: Option<String>,
    pub categories: Vec<ContextCategory>,
    pub observed_at: u64,
}

// ----------------------------------------------------------------- Claude ----

/// Uma linha do stdout da sonda → resposta, se for a NOSSA. `None` = linha que
/// não interessa (hook, init, outro id). Puro.
pub fn parse_control_line(line: &str, observed_at: u64) -> Option<Result<EngineContext, String>> {
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    if v.get("type").and_then(Value::as_str) != Some("control_response") {
        return None;
    }
    let response = v.get("response")?;
    if response.get("request_id").and_then(Value::as_str) != Some(REQUEST_ID) {
        return None;
    }
    if response.get("subtype").and_then(Value::as_str) != Some("success") {
        let error = response
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("o motor recusou a leitura de contexto sem motivo");
        return Some(Err(error.to_string()));
    }
    Some(parse_context_usage(response.get("response")?, observed_at))
}

fn parse_context_usage(r: &Value, observed_at: u64) -> Result<EngineContext, String> {
    let total_tokens = r
        .get("totalTokens")
        .and_then(Value::as_u64)
        .ok_or("a leitura de contexto veio sem totalTokens")?;
    let max_tokens = r
        .get("maxTokens")
        .and_then(Value::as_u64)
        .filter(|m| *m > 0)
        .ok_or("a leitura de contexto veio sem maxTokens")?;
    let auto_compact_enabled = r
        .get("isAutoCompactEnabled")
        .and_then(Value::as_bool)
        .ok_or("a leitura de contexto não disse se a compactação automática está ligada")?;
    // Ligada sem limiar seria uma promessa sem número: não afirma nenhum.
    let auto_compact_threshold = r
        .get("autoCompactThreshold")
        .and_then(Value::as_u64)
        .filter(|t| auto_compact_enabled && *t > 0);
    let categories = r
        .get("categories")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|c| {
                    Some(ContextCategory {
                        name: c.get("name")?.as_str()?.to_string(),
                        tokens: c.get("tokens")?.as_u64()?,
                        kind: c.get("kind")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(EngineContext {
        total_tokens: Some(total_tokens),
        engine_estimate: None,
        max_tokens: Some(max_tokens),
        auto_compact_threshold,
        auto_compact_enabled,
        source: r
            .get("autocompactSource")
            .and_then(Value::as_str)
            .map(str::to_string),
        origin: CeilingOrigin::EngineReport,
        model: r.get("model").and_then(Value::as_str).map(str::to_string),
        categories,
        observed_at,
    })
}

fn request_line() -> String {
    serde_json::json!({
        "type": "control_request",
        "request_id": REQUEST_ID,
        // `summary` responde do último usage e de estimativas locais, sem as
        // chamadas de contagem por categoria do `full`.
        "request": { "subtype": "get_context_usage", "detail": "summary" },
    })
    .to_string()
        + "\n"
}

async fn probe_claude(
    cwd: &str,
    session_id: &str,
    model: Option<&str>,
) -> Result<EngineContext, String> {
    let mut child = crate::agent::claude_context_probe_command(cwd, session_id, model)
        .spawn()
        .map_err(|e| format!("não consegui abrir o Claude Code para ler o contexto: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("a sonda de contexto ficou sem stdin")?;
    let stdout = child.stdout.take().ok_or("a sonda de contexto ficou sem stdout")?;
    stdin
        .write_all(request_line().as_bytes())
        .await
        .map_err(|e| format!("não consegui pedir a leitura de contexto: {e}"))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("não consegui pedir a leitura de contexto: {e}"))?;
    let mut lines = BufReader::new(stdout).lines();
    let outcome = loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                if let Some(result) = parse_control_line(&line, crate::run_resources::epoch_ms()) {
                    break result;
                }
            }
            Ok(None) => break Err("o Claude Code encerrou sem responder a leitura de contexto".into()),
            Err(e) => break Err(format!("falha ao ler a resposta de contexto: {e}")),
        }
    };
    // Fechar o stdin encerra o modo stream-json; o drop mata o que sobrar.
    drop(stdin);
    let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
    outcome
}

// ------------------------------------------------------------------ Codex ----

/// Limiar do Codex a partir da resposta de `config/read` e do catálogo local.
/// Fórmula do 0.154.0 (`openai_models.rs`, `context_window.rs`), validada no
/// binário contra uma Responses API local: janela = override limitado ao
/// máximo do catálogo, senão a do catálogo; limiar = min(limite configurado,
/// 90% da janela); janela reportada = janela × percentual efetivo. Puro.
pub fn codex_ceiling(
    config_read: &Value,
    catalog: &Value,
    model_hint: Option<&str>,
    observed_at: u64,
) -> Result<EngineContext, String> {
    let config = config_read.get("config").unwrap_or(config_read);
    let model = model_hint
        .filter(|m| !m.is_empty() && *m != "default")
        .map(str::to_string)
        .or_else(|| config.get("model").and_then(Value::as_str).map(str::to_string))
        .ok_or("não sei qual modelo do Codex medir")?;
    let scope = config
        .get("model_auto_compact_token_limit_scope")
        .and_then(Value::as_str);
    let entry = catalog
        .get("models")
        .and_then(Value::as_array)
        .and_then(|models| {
            models
                .iter()
                .find(|m| m.get("slug").and_then(Value::as_str) == Some(model.as_str()))
        })
        .ok_or_else(|| format!("o modelo {model} não está no catálogo local do Codex"))?;
    let catalog_window = entry
        .get("context_window")
        .and_then(Value::as_u64)
        .or_else(|| entry.get("max_context_window").and_then(Value::as_u64))
        .filter(|w| *w > 0)
        .ok_or_else(|| format!("o catálogo local do Codex não traz a janela de {model}"))?;
    let max_window = entry.get("max_context_window").and_then(Value::as_u64);
    let window = match config.get("model_context_window").and_then(Value::as_u64) {
        Some(w) => max_window.map_or(w, |m| w.min(m)),
        None => catalog_window,
    };
    let max_tokens = entry
        .get("effective_context_window_percent")
        .and_then(Value::as_u64)
        .map(|pct| window * pct / 100);
    let configured = config
        .get("model_auto_compact_token_limit")
        .and_then(Value::as_u64)
        .or_else(|| entry.get("auto_compact_token_limit").and_then(Value::as_u64));
    let ninety = window * 9 / 10;
    // `body_after_prefix` conta só o crescimento depois do prefixo carregado,
    // que a Frota não enxerga: ligada, mas sem número afirmável.
    let threshold = if scope == Some("body_after_prefix") {
        None
    } else {
        Some(configured.map_or(ninety, |c| c.min(ninety)))
    };
    Ok(EngineContext {
        total_tokens: None,
        engine_estimate: None,
        max_tokens,
        auto_compact_threshold: threshold,
        auto_compact_enabled: true,
        source: Some(if scope == Some("body_after_prefix") {
            "body_after_prefix".to_string()
        } else if configured.is_some() {
            "configuracao".to_string()
        } else {
            "catalogo".to_string()
        }),
        origin: CeilingOrigin::EngineConfig,
        model: Some(model),
        categories: Vec::new(),
        observed_at,
    })
}

fn codex_home() -> Option<PathBuf> {
    std::env::var("CODEX_HOME")
        .map(PathBuf::from)
        .ok()
        .or_else(|| std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".codex")))
}

async fn probe_codex(cwd: &str, model_hint: Option<&str>) -> Result<EngineContext, String> {
    let config = crate::codex_appserver::probe_once(
        "config/read",
        serde_json::json!({ "cwd": cwd }),
        PROBE_TIMEOUT.as_secs(),
    )
    .await
    .map_err(|e| format!("o Codex não respondeu a configuração ({}): {}", e.kind, e.message))?;
    let path = codex_home()
        .ok_or("não achei a pasta do Codex")?
        .join("models_cache.json");
    let catalog = tauri::async_runtime::spawn_blocking(move || {
        std::fs::read_to_string(&path)
            .map_err(|e| format!("não consegui ler o catálogo local do Codex: {e}"))
            .and_then(|t| {
                serde_json::from_str::<Value>(&t)
                    .map_err(|e| format!("catálogo local do Codex ilegível: {e}"))
            })
    })
    .await
    .map_err(|e| format!("leitura do catálogo do Codex interrompida: {e}"))??;
    codex_ceiling(&config, &catalog, model_hint, crate::run_resources::epoch_ms())
}

// -------------------------------------------------------------------- agy ----

fn varint(b: &[u8], i: &mut usize) -> Option<u64> {
    let mut out = 0u64;
    let mut shift = 0;
    loop {
        let byte = *b.get(*i)?;
        *i += 1;
        if shift >= 64 {
            return None;
        }
        out |= u64::from(byte & 0x7f) << shift;
        if byte < 0x80 {
            return Some(out);
        }
        shift += 7;
    }
}

/// Primeiro campo `field` com o tipo de fio pedido (0 = varint, 2 = bytes).
/// Protobuf cru, sem esquema: só atravessa, nunca confia além do que lê.
fn pb_field<'a>(b: &'a [u8], field: u64, wire: u64) -> Option<PbValue<'a>> {
    let mut i = 0;
    while i < b.len() {
        let key = varint(b, &mut i)?;
        let (f, w) = (key >> 3, key & 7);
        let value = match w {
            0 => PbValue::Varint(varint(b, &mut i)?),
            1 => {
                i = i.checked_add(8).filter(|end| *end <= b.len())?;
                continue;
            }
            2 => {
                let len = usize::try_from(varint(b, &mut i)?).ok()?;
                let end = i.checked_add(len).filter(|end| *end <= b.len())?;
                let bytes = &b[i..end];
                i = end;
                PbValue::Bytes(bytes)
            }
            5 => {
                i = i.checked_add(4).filter(|end| *end <= b.len())?;
                continue;
            }
            _ => return None,
        };
        if f == field && w == wire {
            return Some(value);
        }
    }
    None
}

enum PbValue<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
}

fn pb_bytes(b: &[u8], field: u64) -> Option<&[u8]> {
    match pb_field(b, field, 2)? {
        PbValue::Bytes(v) => Some(v),
        PbValue::Varint(_) => None,
    }
}

fn pb_varint(b: &[u8], field: u64) -> Option<u64> {
    match pb_field(b, field, 0)? {
        PbValue::Varint(v) => Some(v),
        PbValue::Bytes(_) => None,
    }
}

/// Um registro de `gen_metadata` do agy → (estimativa, limite, modelo).
/// Caminho medido em 8.514 de 8.548 gerações reais (agy 1.2.4): mensagem 1 →
/// 9 → 10, com a estimativa no campo 1 e o limite no campo 4; o modelo mora
/// no campo 19 da mensagem 1. Faltou qualquer peça, `None`. Puro.
pub fn agy_generation_record(blob: &[u8]) -> Option<(u64, u64, Option<String>)> {
    let generation = pb_bytes(blob, 1)?;
    let budget = pb_bytes(pb_bytes(generation, 9)?, 10)?;
    let estimate = pb_varint(budget, 1)?;
    let limit = pb_varint(budget, 4).filter(|l| *l > 0)?;
    let model = pb_bytes(generation, 19).and_then(|m| String::from_utf8(m.to_vec()).ok());
    Some((estimate, limit, model))
}

fn agy_context(estimate: u64, limit: u64, model: Option<String>, observed_at: u64) -> EngineContext {
    EngineContext {
        total_tokens: None,
        engine_estimate: Some(estimate),
        max_tokens: None,
        auto_compact_threshold: Some(limit),
        auto_compact_enabled: true,
        source: Some("registro-da-geracao".to_string()),
        origin: CeilingOrigin::EngineRecord,
        model,
        categories: Vec::new(),
        observed_at,
    }
}

fn probe_agy_blocking(session_id: &str) -> Result<EngineContext, String> {
    // O id vira nome de arquivo: só o alfabeto de UUID passa.
    if session_id.is_empty()
        || !session_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        return Err("id de conversa do Antigravity inválido".into());
    }
    let home = std::env::var("HOME").map_err(|_| "HOME ausente")?;
    let path = PathBuf::from(home)
        .join(".gemini/antigravity-cli/conversations")
        .join(format!("{session_id}.db"));
    if !path.exists() {
        return Err("o Antigravity não tem registro local desta conversa".into());
    }
    let conn = rusqlite::Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("não consegui abrir o registro do Antigravity: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT data FROM gen_metadata ORDER BY idx DESC LIMIT 20")
        .map_err(|e| format!("registro do Antigravity em formato inesperado: {e}"))?;
    let blobs = stmt
        .query_map([], |row| row.get::<_, Vec<u8>>(0))
        .map_err(|e| format!("não consegui ler o registro do Antigravity: {e}"))?;
    for blob in blobs.flatten() {
        if let Some((estimate, limit, model)) = agy_generation_record(&blob) {
            return Ok(agy_context(estimate, limit, model, crate::run_resources::epoch_ms()));
        }
    }
    Err("o registro do Antigravity não traz o limite de compactação nas últimas gerações".into())
}

// ---------------------------------------------------------------- comando ----

/// Lê o limiar pela capability do motor. `Ok(None)` = motor sem sonda
/// declarada (a UI segue com a janela como teto, sem afirmar limiar).
pub async fn read(
    agent: &str,
    cwd: &str,
    session_id: &str,
    model: Option<&str>,
    resolved_model: Option<&str>,
) -> Result<Option<EngineContext>, String> {
    let Some(probe) = adapters::capabilities_of(agent).and_then(|c| c.context_ceiling) else {
        return Ok(None);
    };
    let session = session_id.to_string();
    let work = async {
        match probe {
            ContextCeilingProbe::ClaudeControlRequest => probe_claude(cwd, session_id, model).await,
            ContextCeilingProbe::CodexConfigCatalog => {
                probe_codex(cwd, resolved_model.or(model)).await
            }
            ContextCeilingProbe::AgyGenerationRecord => {
                tauri::async_runtime::spawn_blocking(move || probe_agy_blocking(&session))
                    .await
                    .map_err(|e| format!("leitura do registro do Antigravity interrompida: {e}"))?
            }
        }
    };
    match tokio::time::timeout(PROBE_TIMEOUT, work).await {
        Ok(result) => result.map(Some),
        Err(_) => Err("a leitura de contexto do motor estourou o prazo de 8s".into()),
    }
}

#[tauri::command]
pub async fn read_engine_context(
    agent: String,
    cwd: String,
    session_id: String,
    model: Option<String>,
    resolved_model: Option<String>,
) -> Result<Option<EngineContext>, String> {
    let result = read(
        &agent,
        &cwd,
        &session_id,
        model.as_deref(),
        resolved_model.as_deref(),
    )
    .await;
    if let Err(error) = &result {
        log::warn!("sonda de contexto do motor falhou: {error}");
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIGADA: &str = include_str!("../testdata/claude-2.1.270/context-usage.jsonl");
    const DESLIGADA: &str =
        include_str!("../testdata/claude-2.1.270/context-usage-sem-autocompact.jsonl");
    const CODEX_SEM_OVERRIDE: &str =
        include_str!("../testdata/codex-0.154.0/config-read-sem-override.json");
    const CODEX_COM_OVERRIDE: &str =
        include_str!("../testdata/codex-0.154.0/config-read-com-override.json");
    const CODEX_CATALOGO: &str =
        include_str!("../testdata/codex-0.154.0/models-cache-sol-astra.json");
    const AGY_GEN_252K: &[u8] = include_bytes!("../testdata/agy-1.2.4/gen-metadata-179.bin");
    const AGY_GEN_255K: &[u8] = include_bytes!("../testdata/agy-1.2.4/gen-metadata-180.bin");

    fn ler(fixture: &str) -> EngineContext {
        fixture
            .lines()
            .find_map(|l| parse_control_line(l, 42))
            .expect("a fixture tem a resposta")
            .expect("resposta de sucesso")
    }

    fn json(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn resposta_real_traz_limiar_teto_e_total() {
        let ctx = ler(LIGADA);
        assert_eq!(ctx.total_tokens, Some(322_236));
        assert_eq!(ctx.max_tokens, Some(1_000_000));
        assert_eq!(ctx.auto_compact_threshold, Some(967_000));
        assert!(ctx.auto_compact_enabled);
        assert_eq!(ctx.source.as_deref(), Some("model-default"));
        assert_eq!(ctx.origin, CeilingOrigin::EngineReport);
        assert_eq!(ctx.model.as_deref(), Some("claude-opus-5[1m]"));
        assert_eq!(ctx.observed_at, 42);
        let buffer = ctx.categories.iter().find(|c| c.kind == "buffer").unwrap();
        assert_eq!(buffer.tokens, 33_000, "o buffer é a distância entre teto e limiar");
    }

    #[test]
    fn compactacao_desligada_nao_afirma_limiar() {
        let ctx = ler(DESLIGADA);
        assert!(!ctx.auto_compact_enabled);
        assert_eq!(ctx.auto_compact_threshold, None);
        assert_eq!(ctx.max_tokens, Some(1_000_000));
    }

    #[test]
    fn so_a_resposta_com_o_nosso_id_conta() {
        let hook = r#"{"type":"system","subtype":"hook_started"}"#;
        assert!(parse_control_line(hook, 0).is_none());
        let outro = LIGADA.replace(REQUEST_ID, "outro-pedido");
        assert!(outro.lines().all(|l| parse_control_line(l, 0).is_none()));
        assert!(parse_control_line("não é json", 0).is_none());
    }

    #[test]
    fn recusa_do_motor_vira_erro_com_motivo() {
        let recusa = format!(
            r#"{{"type":"control_response","response":{{"subtype":"error","request_id":"{REQUEST_ID}","error":"get_context_usage is not supported in this context"}}}}"#
        );
        let erro = parse_control_line(&recusa, 0).unwrap().unwrap_err();
        assert!(erro.contains("not supported"));
    }

    #[test]
    fn resposta_sem_campo_obrigatorio_e_erro_e_nao_zero() {
        let capada = format!(
            r#"{{"type":"control_response","response":{{"subtype":"success","request_id":"{REQUEST_ID}","response":{{"maxTokens":1000000,"isAutoCompactEnabled":true}}}}}}"#
        );
        assert!(parse_control_line(&capada, 0).unwrap().is_err());
    }

    #[test]
    fn comando_da_sonda_nao_manda_prompt_nem_liga_hooks_ou_mcp() {
        let cmd = crate::agent::claude_context_probe_command("/tmp", "sessao-x", Some("opus"));
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let blob = args.join(" ");
        assert!(blob.contains("--input-format stream-json"));
        assert!(blob.contains("--resume sessao-x"));
        assert!(blob.contains("disableAllHooks"));
        assert!(blob.contains("--strict-mcp-config"));
        assert!(blob.contains("--model opus"));
        assert!(!args.iter().any(|a| a == "--"), "sem prompt posicional: nenhum turno");
    }

    #[test]
    fn codex_sem_override_compacta_a_90_por_cento_do_catalogo() {
        // Binário 0.154.0 contra Responses API local: 244.799 não compacta,
        // 244.800 compacta, janela reportada 258.400.
        let ctx = codex_ceiling(
            &json(CODEX_SEM_OVERRIDE),
            &json(CODEX_CATALOGO),
            Some("gpt-5.6-sol"),
            7,
        )
        .unwrap();
        assert_eq!(ctx.auto_compact_threshold, Some(244_800));
        assert_eq!(ctx.max_tokens, Some(258_400));
        assert_eq!(ctx.origin, CeilingOrigin::EngineConfig);
        assert_eq!(ctx.source.as_deref(), Some("catalogo"));
        assert_eq!(ctx.total_tokens, None, "o total vem do rollout, não da configuração");
    }

    #[test]
    fn codex_override_de_janela_e_limite_segue_os_cortes_do_binario() {
        // Mesmo teste do binário: astra (máx. 872k) com janela 400k e limite
        // 500k compacta em 360.000 e reporta 380.000.
        let ctx = codex_ceiling(&json(CODEX_COM_OVERRIDE), &json(CODEX_CATALOGO), None, 7).unwrap();
        assert_eq!(ctx.model.as_deref(), Some("gpt-6-astra"), "sem modelo resolvido, vale o da config");
        assert_eq!(ctx.auto_compact_threshold, Some(360_000));
        assert_eq!(ctx.max_tokens, Some(380_000));
        assert_eq!(ctx.source.as_deref(), Some("configuracao"));
    }

    #[test]
    fn codex_janela_acima_do_maximo_do_catalogo_e_cortada() {
        let ctx = codex_ceiling(
            &json(CODEX_COM_OVERRIDE),
            &json(CODEX_CATALOGO),
            Some("gpt-5.6-sol"),
            7,
        )
        .unwrap();
        assert_eq!(ctx.auto_compact_threshold, Some(244_800));
        assert_eq!(ctx.max_tokens, Some(258_400));
    }

    #[test]
    fn codex_escopo_body_after_prefix_nao_afirma_limiar() {
        let mut cfg = json(CODEX_COM_OVERRIDE);
        cfg["config"]["model_auto_compact_token_limit_scope"] = Value::from("body_after_prefix");
        let ctx = codex_ceiling(&cfg, &json(CODEX_CATALOGO), None, 7).unwrap();
        assert!(ctx.auto_compact_enabled);
        assert_eq!(ctx.auto_compact_threshold, None);
    }

    #[test]
    fn codex_modelo_fora_do_catalogo_e_erro_com_motivo() {
        let erro = codex_ceiling(
            &json(CODEX_SEM_OVERRIDE),
            &json(CODEX_CATALOGO),
            Some("gpt-inexistente"),
            7,
        )
        .unwrap_err();
        assert!(erro.contains("gpt-inexistente"));
    }

    #[test]
    fn agy_registro_real_traz_estimativa_e_limite() {
        // Fork da conversa "nuvem": 252.769 e 255.444 não compactaram; o
        // degrau seguinte cruzou 256.000 e compactou.
        assert_eq!(
            agy_generation_record(AGY_GEN_252K),
            Some((252_769, 256_000, Some("gemini-3.8-flash".to_string())))
        );
        assert_eq!(agy_generation_record(AGY_GEN_255K).map(|r| (r.0, r.1)), Some((255_444, 256_000)));
        let ctx = agy_context(255_444, 256_000, None, 7);
        assert_eq!(ctx.origin, CeilingOrigin::EngineRecord);
        assert_eq!(ctx.engine_estimate, Some(255_444));
        assert_eq!(ctx.max_tokens, None, "o registro não traz a janela do modelo");
    }

    #[test]
    fn agy_registro_truncado_ou_estranho_nao_afirma_nada() {
        assert_eq!(agy_generation_record(&AGY_GEN_255K[..AGY_GEN_255K.len() / 2]), None);
        assert_eq!(agy_generation_record(b"lixo"), None);
        assert_eq!(agy_generation_record(&[]), None);
    }

    #[test]
    fn agy_id_fora_do_alfabeto_de_uuid_e_recusado() {
        assert!(probe_agy_blocking("../../etc/passwd").is_err());
        assert!(probe_agy_blocking("").is_err());
    }

    #[test]
    #[ignore = "executa o Claude Code real contra uma sessão desta máquina; prova manual da sonda"]
    fn sonda_real_le_o_limiar_sem_tocar_a_sessao() {
        // FROTA_SONDA_SESSAO=<sid> FROTA_SONDA_CWD=<pasta> cargo test sonda_real -- --ignored
        let sid = std::env::var("FROTA_SONDA_SESSAO").expect("FROTA_SONDA_SESSAO");
        let cwd = std::env::var("FROTA_SONDA_CWD").expect("FROTA_SONDA_CWD");
        let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
        let inicio = std::time::Instant::now();
        let ctx = rt
            .block_on(read("claude-code", &cwd, &sid, None, None))
            .expect("leitura")
            .expect("claude declara a sonda");
        eprintln!("sonda real em {:?}: {ctx:?}", inicio.elapsed());
        assert!(ctx.max_tokens.is_some() && ctx.total_tokens.is_some());
    }

    #[test]
    #[ignore = "lê o Codex e o Antigravity reais desta máquina; prova manual das sondas"]
    fn sondas_reais_de_codex_e_agy() {
        // FROTA_SONDA_AGY=<conversa> cargo test sondas_reais -- --ignored --nocapture
        let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
        let codex = rt.block_on(read("codex", "/tmp", "s", None, Some("gpt-6-astra")));
        eprintln!("codex real: {codex:?}");
        assert!(codex.expect("codex").expect("sonda").auto_compact_threshold.is_some());
        if let Ok(conv) = std::env::var("FROTA_SONDA_AGY") {
            let agy = rt.block_on(read("agy", "/tmp", &conv, None, None));
            eprintln!("agy real: {agy:?}");
            assert!(agy.expect("agy").expect("sonda").engine_estimate.is_some());
        }
    }

    #[test]
    fn motor_sem_sonda_responde_none_sem_subir_processo() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let r = rt.block_on(read("opencode", "/tmp", "s", None, None));
        assert_eq!(r, Ok(None));
    }
}
