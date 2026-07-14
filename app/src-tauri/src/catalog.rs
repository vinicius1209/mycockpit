//! Camada A da inteligência de modelos: catálogo DINÂMICO de preços via
//! models.dev (https://models.dev/api.json, ~3.2MB, 166 providers). Guardamos
//! só o que interessa (anthropic/openai/google, modelos com preço de output)
//! num arquivo compacto em app_data_dir + espelho em memória. O refresh é
//! best-effort via `curl` subprocess (mesmo padrão do detect::fetch_latest):
//! falha de rede NÃO toca o cache existente — pricing.rs cai pro SEED.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::process::Command;
use tokio::time::timeout;

/// Preços em $/1M tokens (a unidade que models.dev publica).
#[derive(Serialize, Deserialize, Clone)]
pub struct CatalogModel {
    pub provider: String,
    pub id: String,
    pub name: String,
    pub input: f64,
    pub output: f64,
    /// None = provider não publica preço de cache → cache cobrado como input.
    pub cache_read: Option<f64>,
    pub context: Option<u64>,
    pub release_date: Option<String>,
}

/// Só os providers cujos CLIs o cockpit orquestra (claude/codex/agy).
const PROVIDERS: [&str; 3] = ["anthropic", "openai", "google"];
const CATALOG_FILE: &str = "models-catalog.json";
const REFRESH_URL: &str = "https://models.dev/api.json";

/// Onde fica o cache em disco; setado 1x (setup do Tauri ou 1º comando).
static CACHE_PATH: OnceLock<PathBuf> = OnceLock::new();
/// Espelho em memória. None = ainda não tentou carregar do arquivo;
/// Some(vec vazio) = já tentou e não havia cache (não relê o disco à toa).
static CATALOG: RwLock<Option<Vec<CatalogModel>>> = RwLock::new(None);

/// Registra o caminho do cache (idempotente). Chamado no setup do app e no
/// início de cada comando — o load do arquivo em si é lazy, na 1ª consulta.
pub fn init(app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = CACHE_PATH.set(dir.join(CATALOG_FILE));
    }
}

fn read_lock() -> std::sync::RwLockReadGuard<'static, Option<Vec<CatalogModel>>> {
    CATALOG.read().unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn write_lock() -> std::sync::RwLockWriteGuard<'static, Option<Vec<CatalogModel>>> {
    CATALOG.write().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Garante que a memória reflete o arquivo (lazy, 1ª consulta). Sem CACHE_PATH
/// (testes / app_data_dir indisponível) vira no-op e o lookup devolve None.
fn ensure_loaded() {
    if read_lock().is_some() {
        return;
    }
    let Some(path) = CACHE_PATH.get() else { return };
    let loaded = load_from_disk(path).unwrap_or_default();
    let mut w = write_lock();
    if w.is_none() {
        *w = Some(loaded);
    }
}

fn load_from_disk(path: &Path) -> Option<Vec<CatalogModel>> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Escrita atômica (.tmp + rename), mesmo racional do attachments::write_atomic:
/// nunca deixa um catálogo meio-escrito p/ o próximo boot ler.
fn save_to_disk(path: &Path, models: &[CatalogModel]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("criar dir do catálogo: {e}"))?;
    }
    let bytes = serde_json::to_vec(models).map_err(|e| format!("serializar catálogo: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &bytes).map_err(|e| format!("gravar catálogo: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("renomear catálogo: {e}"))
}

/// Extrai o formato do models.dev — `{provider: {models: {id: {name, cost:
/// {input, output, cache_read?}, limit: {context}, release_date}}}}` — para a
/// forma compacta. Só PROVIDERS; pula modelos sem preço de output (embeddings/
/// moderation e free tiers não servem p/ estimar custo de chat).
/// NOTA: models.dev também publica `cost.tiers` (preço maior acima de ~200k
/// tokens de contexto); ignorado nesta versão, fica pro futuro.
fn extract(raw: &serde_json::Value) -> Vec<CatalogModel> {
    let mut out = Vec::new();
    for prov in PROVIDERS {
        let Some(models) = raw
            .get(prov)
            .and_then(|p| p.get("models"))
            .and_then(|m| m.as_object())
        else {
            continue;
        };
        for (id, m) in models {
            let cost = m.get("cost");
            let get = |k: &str| cost.and_then(|c| c.get(k)).and_then(|v| v.as_f64());
            let input = get("input").unwrap_or(0.0);
            let output = get("output").unwrap_or(0.0);
            if output <= 0.0 {
                continue;
            }
            out.push(CatalogModel {
                provider: prov.to_string(),
                id: id.clone(),
                name: m
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(id)
                    .to_string(),
                input,
                output,
                cache_read: get("cache_read"),
                context: m
                    .get("limit")
                    .and_then(|l| l.get("context"))
                    .and_then(|v| v.as_u64()),
                release_date: m
                    .get("release_date")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
            });
        }
    }
    out
}

/// Consulta do pricing.rs: (a) id EXATO (case-insensitive), (b) senão prefixo
/// em qualquer direção — id do catálogo prefixo do model consultado ou
/// vice-versa — com o id mais LONGO vencendo ("gpt-5.6-terra-xyz" casa
/// gpt-5.6-terra, não gpt-5.6). None = sem catálogo ou sem match (cai no SEED).
pub fn lookup(model: &str) -> Option<CatalogModel> {
    ensure_loaded();
    let guard = read_lock();
    lookup_in(guard.as_deref().unwrap_or(&[]), model)
}

fn lookup_in(list: &[CatalogModel], model: &str) -> Option<CatalogModel> {
    let m = model.to_lowercase();
    if let Some(c) = list.iter().find(|c| c.id.to_lowercase() == m) {
        return Some(c.clone());
    }
    list.iter()
        .filter(|c| {
            let id = c.id.to_lowercase();
            m.starts_with(&id) || id.starts_with(&m)
        })
        .max_by_key(|c| c.id.len())
        .cloned()
}

/// Baixa e reprocessa o catálogo (best-effort; o front chama de vez em quando).
/// Qualquer falha (offline, timeout, JSON estranho) devolve Err SEM tocar o
/// cache existente — memória e arquivo só mudam depois de um parse feliz.
#[tauri::command]
pub async fn refresh_models_catalog(app: AppHandle) -> Result<usize, String> {
    init(&app);
    let out = timeout(
        Duration::from_secs(10),
        Command::new("curl")
            .args(["-s", "--max-time", "8", REFRESH_URL])
            .output(),
    )
    .await
    .map_err(|_| "timeout consultando models.dev".to_string())?
    .map_err(|e| format!("curl indisponível: {e}"))?;
    if !out.status.success() {
        return Err(format!("curl falhou ({})", out.status));
    }
    let raw: serde_json::Value =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("JSON inesperado: {e}"))?;
    let models = extract(&raw);
    if models.is_empty() {
        // resposta válida mas sem nossos providers = formato mudou; não apaga
        // um cache bom com um vazio.
        return Err("models.dev sem modelos dos providers esperados".into());
    }
    let path = CACHE_PATH.get().ok_or("app_data_dir indisponível")?;
    save_to_disk(path, &models)?;
    let n = models.len();
    *write_lock() = Some(models);
    Ok(n)
}

/// Catálogo atual: memória → arquivo (lazy) → vazio (nunca falha; a UI trata
/// vazio como "ainda sem refresh").
#[tauri::command]
pub fn get_models_catalog(app: AppHandle) -> Vec<CatalogModel> {
    init(&app);
    ensure_loaded();
    read_lock().clone().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fixture mínima no formato real do models.dev: provider fora da lista,
    /// modelo sem output (embedding) e cache_read presente/ausente.
    const FIXTURE: &str = r#"{
        "anthropic": { "models": {
            "claude-fable-5": { "name": "Claude Fable 5",
                "cost": { "input": 10.0, "output": 50.0, "cache_read": 1.0 },
                "limit": { "context": 300000 }, "release_date": "2026-05-01" },
            "claude-embed-1": { "name": "Embed", "cost": { "input": 0.1, "output": 0 } }
        }},
        "openai": { "models": {
            "gpt-5.6": { "name": "GPT-5.6", "cost": { "input": 1.25, "output": 10.0 } },
            "gpt-5.6-terra": { "name": "GPT-5.6 Terra",
                "cost": { "input": 2.5, "output": 15.0, "cache_read": 0.25 } }
        }},
        "mistral": { "models": {
            "mistral-max": { "name": "Max", "cost": { "input": 2.0, "output": 6.0 } }
        }}
    }"#;

    fn fixture_models() -> Vec<CatalogModel> {
        extract(&serde_json::from_str(FIXTURE).expect("fixture válida"))
    }

    #[test]
    fn extract_keeps_only_known_providers_with_output_price() {
        let models = fixture_models();
        let mut ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        ids.sort();
        // embedding (output 0) e provider mistral ficam de fora
        assert_eq!(ids, ["claude-fable-5", "gpt-5.6", "gpt-5.6-terra"]);
        let fable = models.iter().find(|m| m.id == "claude-fable-5").unwrap();
        assert_eq!(fable.cache_read, Some(1.0));
        assert_eq!(fable.context, Some(300_000));
        assert_eq!(fable.release_date.as_deref(), Some("2026-05-01"));
        let base = models.iter().find(|m| m.id == "gpt-5.6").unwrap();
        assert!(base.cache_read.is_none());
    }

    #[test]
    fn lookup_exact_match_is_case_insensitive() {
        let models = fixture_models();
        let hit = lookup_in(&models, "GPT-5.6-Terra").expect("match exato");
        assert_eq!(hit.output, 15.0);
    }

    #[test]
    fn lookup_prefix_longest_id_wins() {
        let models = fixture_models();
        // "gpt-5.6-terra-2026" tem DOIS prefixos no catálogo (gpt-5.6 e
        // gpt-5.6-terra); o mais longo vence — a regressão do contains do seed.
        let hit = lookup_in(&models, "gpt-5.6-terra-2026").expect("match por prefixo");
        assert_eq!(hit.id, "gpt-5.6-terra");
    }

    #[test]
    fn lookup_miss_returns_none() {
        assert!(lookup_in(&fixture_models(), "sei-la-9000").is_none());
        assert!(lookup_in(&[], "gpt-5.6").is_none()); // catálogo vazio = seed
    }
}
