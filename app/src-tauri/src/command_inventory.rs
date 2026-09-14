//! Inventário de comandos "/" que o PRÓPRIO motor publica (ADR-189).
//!
//! A descoberta em disco (`sources.rs` + `provider_commands.rs`) adivinha por
//! pasta. O motor sabe: o Claude Code manda `slash_commands`, `skills` e
//! `plugins` no `system/init` de todo run; o Codex responde `skills/list` pelo
//! app-server sem turno de modelo. Este módulo guarda essa evidência COM
//! HORÁRIO e compõe o popover a partir dela, caindo no disco quando não há.
//! Qual canal vale para cada motor é a capability `command_inventory`; nada
//! aqui compara nome de agent.

use crate::adapters::{capabilities_of, BuiltinCommand, CommandInventory};
use crate::sources::SlashCommand;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

const INVENTORY_FILE: &str = "command-inventory.json";
/// Consulta lateral do Codex: reaproveitada por este tempo antes de subir o
/// app-server de novo (abrir o "/" várias vezes não pode virar vários spawns).
const QUERY_TTL_MS: u64 = 2 * 60 * 1000;
const QUERY_TIMEOUT_SECS: u64 = 8;

/// Plugin anunciado pelo motor, com a pasta de onde ele carrega.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObservedPlugin {
    pub name: String,
    pub path: String,
}

/// O que um run anunciou no início. É evidência do último run, não do presente.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObservedInventory {
    /// Rótulo de fonte dos itens que só existem aqui (ex. skills embutidas).
    pub source: String,
    pub slash_commands: Vec<String>,
    pub skills: Vec<String>,
    pub plugins: Vec<ObservedPlugin>,
    /// Comandos que o CLI declara só para terminal: nunca oferecidos.
    pub terminal_only: Vec<String>,
    pub observed_at: u64,
}

impl ObservedInventory {
    fn same_content(&self, other: &Self) -> bool {
        self.slash_commands == other.slash_commands
            && self.skills == other.skills
            && self.plugins == other.plugins
            && self.terminal_only == other.terminal_only
    }
}

fn strings(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(|x| x.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|i| i.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// `system/init` do Claude Code → inventário. Sem `slash_commands` não há o
/// que afirmar (versão antiga ou payload parcial): None, e o disco decide.
pub fn parse_claude_init(v: &Value, now_ms: u64) -> Option<ObservedInventory> {
    v.get("slash_commands")?.as_array()?;
    let plugins = v
        .get("plugins")
        .and_then(|x| x.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|p| {
                    Some(ObservedPlugin {
                        name: p.get("name")?.as_str()?.to_string(),
                        path: p.get("path")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Some(ObservedInventory {
        source: "claude".into(),
        slash_commands: strings(v, "slash_commands"),
        skills: strings(v, "skills"),
        plugins,
        terminal_only: strings(v, "terminal_slash_commands"),
        observed_at: now_ms,
    })
}

// ---------------------------------------------------------------- cache ----

static CACHE_PATH: OnceLock<PathBuf> = OnceLock::new();
static OBSERVED: OnceLock<Mutex<Option<HashMap<String, ObservedInventory>>>> = OnceLock::new();
/// Skills consultadas por cwd, com o horário da consulta.
type QueriedCache = HashMap<String, (u64, Vec<SlashCommand>)>;
static QUERIED: OnceLock<Mutex<QueriedCache>> = OnceLock::new();

pub fn init(app: &tauri::AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = CACHE_PATH.set(dir.join(INVENTORY_FILE));
    }
}

fn key(agent: &str, cwd: &str) -> String {
    format!("{agent}\u{1f}{}", cwd.trim_end_matches('/'))
}

fn observed_map() -> std::sync::MutexGuard<'static, Option<HashMap<String, ObservedInventory>>> {
    let guard = OBSERVED
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    guard
}

fn with_loaded<T>(f: impl FnOnce(&mut HashMap<String, ObservedInventory>) -> T) -> T {
    let mut guard = observed_map();
    if guard.is_none() {
        let loaded = CACHE_PATH
            .get()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        *guard = Some(loaded);
    }
    f(guard.as_mut().expect("carregado acima"))
}

/// Guarda o que o run anunciou. Só regrava o arquivo quando o conteúdo mudou
/// ou a evidência envelheceu: o custo é por run, nunca por mensagem.
pub fn observe(agent: &str, cwd: &str, inventory: ObservedInventory) {
    let snapshot = with_loaded(|map| {
        let k = key(agent, cwd);
        let stale = map.get(&k).is_none_or(|old| {
            !old.same_content(&inventory)
                || inventory.observed_at.saturating_sub(old.observed_at) > 10 * 60 * 1000
        });
        map.insert(k, inventory);
        stale.then(|| serde_json::to_string(map).ok()).flatten()
    });
    if let (Some(json), Some(path)) = (snapshot, CACHE_PATH.get()) {
        if let Err(error) = std::fs::write(path, json) {
            eprintln!("[command_inventory] não consegui gravar {}: {error}", path.display());
        }
    }
}

pub fn observed(agent: &str, cwd: &str) -> Option<ObservedInventory> {
    with_loaded(|map| map.get(&key(agent, cwd)).cloned())
}

fn queried_map() -> std::sync::MutexGuard<'static, QueriedCache> {
    QUERIED
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

// ---------------------------------------------------------- composição ----

/// Inventário devolvido ao composer: os itens e a PROCEDÊNCIA deles.
#[derive(Clone, Debug, Serialize)]
pub struct InventoryView {
    pub commands: Vec<SlashCommand>,
    /// "motor" quando veio do motor, "disco" quando só houve leitura de pasta.
    pub origin: &'static str,
    #[serde(rename = "observedAt")]
    pub observed_at: Option<u64>,
    /// Problemas que fariam item sumir em silêncio (ex. link quebrado).
    pub diagnostics: Vec<String>,
}

/// O que do motor entra na composição, já resolvido pelo canal da capability.
#[derive(Default)]
pub(crate) struct NativeEvidence<'a> {
    pub(crate) observed: Option<&'a ObservedInventory>,
    pub(crate) queried_skills: Option<&'a [SlashCommand]>,
}

/// Soma ao inventário de disco o que só o motor sabe: skills embutidas do
/// CLI e builtins auditados. Pura; o disco já veio resolvido.
pub(crate) fn add_engine_items(
    commands: &mut Vec<SlashCommand>,
    observed: Option<&ObservedInventory>,
    builtins: &[BuiltinCommand],
) {
    let mut seen: HashSet<String> = commands.iter().map(|c| c.name.clone()).collect();
    if let Some(inv) = observed {
        let blocked: HashSet<&str> = inv.terminal_only.iter().map(String::as_str).collect();
        for skill in &inv.skills {
            if blocked.contains(skill.as_str()) || !seen.insert(skill.clone()) {
                continue;
            }
            commands.push(SlashCommand {
                name: skill.clone(),
                kind: "skill".into(),
                origin: "global".into(),
                source: inv.source.clone(),
                ..SlashCommand::default()
            });
        }
    }
    for builtin in builtins {
        // Com evidência, só entra o que ESTE motor anunciou (versão nova pode
        // ter removido); sem evidência, vale a auditoria declarada.
        let announced = observed.is_none_or(|inv| {
            inv.slash_commands.iter().any(|c| c == builtin.name)
                && !inv.terminal_only.iter().any(|c| c == builtin.name)
        });
        if !announced || !seen.insert(builtin.name.to_string()) {
            continue;
        }
        commands.push(SlashCommand {
            name: builtin.name.into(),
            description: Some(builtin.description.into()),
            kind: "builtin".into(),
            origin: "global".into(),
            source: builtin.source.into(),
            ..SlashCommand::default()
        });
    }
}

fn now_ms() -> u64 {
    crate::run_resources::epoch_ms()
}

fn home() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
}

/// Monta o inventário de um projeto para um agent. `query` permite subir a
/// consulta lateral (popover); o caminho de envio passa `false` e usa só o
/// que já está em cache, para não pagar spawn por mensagem.
pub(crate) async fn build(
    app: &tauri::AppHandle,
    path: &str,
    agent: &str,
    query: bool,
) -> Result<InventoryView, String> {
    let caps = capabilities_of(agent);
    let channel = caps.and_then(|c| c.command_inventory);
    let observed = match channel {
        Some(CommandInventory::ClaudeRunInit) => observed(agent, path),
        _ => None,
    };
    let queried = match channel {
        Some(CommandInventory::CodexSkillsList) => codex_skills(path, query).await,
        _ => None,
    };
    let frota_skills = crate::plugin_contributions::skills(app)?;
    let (path_owned, agent_owned) = (path.to_string(), agent.to_string());
    let observed_for_disk = observed.clone();
    let queried_for_disk = queried.clone();
    let (mut commands, diagnostics) = tauri::async_runtime::spawn_blocking(move || {
        let home = home();
        crate::sources::collect_agent_inventory(
            Path::new(&path_owned),
            home.as_deref(),
            &agent_owned,
            &frota_skills,
            &NativeEvidence {
                observed: observed_for_disk.as_ref(),
                queried_skills: queried_for_disk.as_ref().map(|(_, s)| s.as_slice()),
            },
        )
    })
    .await
    .map_err(|error| error.to_string())?;
    let builtins = caps.map(|c| c.builtin_commands).unwrap_or(&[]);
    add_engine_items(&mut commands, observed.as_ref(), builtins);
    commands.sort_by(|a, b| a.name.cmp(&b.name));
    let engine_at = observed
        .as_ref()
        .map(|o| o.observed_at)
        .or(queried.as_ref().map(|(at, _)| *at));
    Ok(InventoryView {
        commands,
        origin: if engine_at.is_some() { "motor" } else { "disco" },
        observed_at: engine_at,
        diagnostics,
    })
}

// ---------------------------------------------------------------- codex ----

/// `skills/list` do app-server → itens do "/". Pura, testada com o payload real.
pub(crate) fn parse_codex_skills_list(result: &Value) -> Vec<(SlashCommand, Option<String>)> {
    let mut out = Vec::new();
    let groups = result.get("data").and_then(|d| d.as_array()).into_iter().flatten();
    for group in groups {
        for skill in group.get("skills").and_then(|s| s.as_array()).into_iter().flatten() {
            if skill.get("enabled").and_then(|e| e.as_bool()) == Some(false) {
                continue;
            }
            let Some(name) = skill.get("name").and_then(|n| n.as_str()) else {
                continue;
            };
            let scope = skill.get("scope").and_then(|s| s.as_str()).unwrap_or("user");
            let plugin = skill
                .get("pluginId")
                .and_then(|p| p.as_str())
                .map(|id| id.split('@').next().unwrap_or(id).to_string());
            let description = skill
                .pointer("/interface/shortDescription")
                .and_then(|d| d.as_str())
                .or_else(|| skill.get("description").and_then(|d| d.as_str()))
                .map(str::to_string);
            let path = skill.get("path").and_then(|p| p.as_str()).map(str::to_string);
            out.push((
                SlashCommand {
                    name: name.to_string(),
                    description,
                    kind: "skill".into(),
                    origin: if scope == "repo" { "project" } else { "global" }.into(),
                    source: "codex".into(),
                    provider_plugin: plugin,
                    ..SlashCommand::default()
                },
                path,
            ));
        }
    }
    out
}

/// Consulta (ou cache) das skills do Codex. `query=false` nunca sobe processo.
/// Falha da consulta devolve o cache antigo, se houver, ou None (disco).
async fn codex_skills(cwd: &str, query: bool) -> Option<(u64, Vec<SlashCommand>)> {
    let k = key("codex-skills", cwd);
    let cached = queried_map().get(&k).cloned();
    let fresh = cached
        .as_ref()
        .is_some_and(|(at, _)| now_ms().saturating_sub(*at) < QUERY_TTL_MS);
    if !query || fresh {
        return cached;
    }
    let params = serde_json::json!({ "cwds": [cwd] });
    match crate::codex_appserver::probe_once("skills/list", params, QUERY_TIMEOUT_SECS).await {
        Ok(result) => {
            let parsed = parse_codex_skills_list(&result);
            let commands = tauri::async_runtime::spawn_blocking(move || {
                parsed
                    .into_iter()
                    .map(|(mut command, path)| {
                        command.body = path.and_then(|p| {
                            crate::plugin_manifest::read_capped(Path::new(&p), 256 * 1024)
                                .ok()
                                .and_then(|b| String::from_utf8(b).ok())
                        });
                        command
                    })
                    .collect::<Vec<_>>()
            })
            .await
            .ok()?;
            let entry = (now_ms(), commands);
            queried_map().insert(k, entry.clone());
            Some(entry)
        }
        Err(error) => {
            eprintln!(
                "[command_inventory] skills/list falhou ({}): {}",
                error.kind, error.message
            );
            cached
        }
    }
}

// ------------------------------------------------------------- comandos ----

#[tauri::command]
pub async fn read_command_inventory(
    app: tauri::AppHandle,
    path: String,
    agent: String,
) -> Result<InventoryView, String> {
    build(&app, &path, &agent, true).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const INIT: &str = include_str!("../testdata/claude-2.1.270/init.json");
    const SKILLS_LIST: &str = include_str!("../testdata/codex-0.154.0/skills-list.json");

    fn init() -> ObservedInventory {
        parse_claude_init(&serde_json::from_str(INIT).unwrap(), 42).unwrap()
    }

    #[test]
    fn init_real_do_claude_vira_inventario_com_plugins_e_terminal() {
        let inv = init();
        assert_eq!(inv.slash_commands.len(), 57);
        assert_eq!(inv.skills.len(), 22);
        assert_eq!(inv.plugins.len(), 7);
        assert!(inv.skills.contains(&"vercel:deploy".to_string()));
        assert!(inv.plugins.iter().any(|p| p.name == "paper-desktop"
            && p.path.ends_with("paper/paper-desktop/0.1.0")));
        assert_eq!(inv.terminal_only, vec!["doctor", "color", "reload-plugins"]);
        assert_eq!(inv.observed_at, 42);
    }

    #[test]
    fn init_sem_slash_commands_nao_afirma_nada() {
        let v = serde_json::json!({"type": "system", "subtype": "init", "session_id": "s9"});
        assert!(parse_claude_init(&v, 1).is_none());
    }

    #[test]
    fn builtins_so_entram_os_auditados_e_anunciados() {
        let inv = init();
        let mut commands = Vec::new();
        add_engine_items(&mut commands, Some(&inv), crate::adapters::CLAUDE_BUILTINS);
        let builtins: Vec<&str> = commands
            .iter()
            .filter(|c| c.kind == "builtin")
            .map(|c| c.name.as_str())
            .collect();
        assert_eq!(builtins, vec!["context", "usage", "skill-doctor", "list-agents"]);
        // anunciados pelo CLI mas fora da auditoria: nunca aparecem
        for proibido in ["model", "effort", "config", "mcp", "clear", "doctor", "ultrareview"] {
            assert!(!commands.iter().any(|c| c.name == proibido), "{proibido} vazou");
        }
        assert!(commands.iter().all(|c| c.source == "claude"));
    }

    #[test]
    fn builtin_que_o_motor_deixou_de_anunciar_some() {
        let mut inv = init();
        inv.slash_commands.retain(|c| c != "usage");
        let mut commands = Vec::new();
        add_engine_items(&mut commands, Some(&inv), crate::adapters::CLAUDE_BUILTINS);
        assert!(!commands.iter().any(|c| c.name == "usage"));
        // sem evidência nenhuma, vale a auditoria declarada
        let mut sem = Vec::new();
        add_engine_items(&mut sem, None, crate::adapters::CLAUDE_BUILTINS);
        assert_eq!(sem.len(), crate::adapters::CLAUDE_BUILTINS.len());
    }

    #[test]
    fn skill_embutida_entra_sem_duplicar_o_que_o_disco_ja_trouxe() {
        let inv = init();
        let mut commands = vec![SlashCommand {
            name: "vercel:deploy".into(),
            description: Some("do disco".into()),
            kind: "command".into(),
            origin: "global".into(),
            source: "claude".into(),
            ..SlashCommand::default()
        }];
        add_engine_items(&mut commands, Some(&inv), &[]);
        assert_eq!(commands.iter().filter(|c| c.name == "vercel:deploy").count(), 1);
        assert_eq!(commands[0].description.as_deref(), Some("do disco"));
        let debug = commands.iter().find(|c| c.name == "debug").expect("skill embutida");
        assert_eq!((debug.kind.as_str(), debug.body.is_none()), ("skill", true));
    }

    #[test]
    fn skills_list_real_do_codex_traz_plugin_escopo_e_descricao_curta() {
        let parsed = parse_codex_skills_list(&serde_json::from_str(SKILLS_LIST).unwrap());
        assert_eq!(parsed.len(), 18);
        let (docs, path) = parsed
            .iter()
            .find(|(c, _)| c.name == "documents:documents")
            .unwrap();
        assert_eq!(docs.provider_plugin.as_deref(), Some("documents"));
        assert_eq!(
            docs.description.as_deref(),
            Some("Create and edit Word and Google Docs files")
        );
        assert!(path.as_deref().unwrap().ends_with("skills/documents/SKILL.md"));
        let (creator, _) = parsed.iter().find(|(c, _)| c.name == "skill-creator").unwrap();
        assert_eq!(creator.provider_plugin, None);
        assert!(parsed.iter().all(|(c, _)| c.source == "codex" && c.origin == "global"));
    }

    #[test]
    fn observacao_nova_com_mesmo_conteudo_nao_regrava() {
        let a = init();
        let mut b = init();
        b.observed_at = 99;
        assert!(a.same_content(&b));
        b.skills.push("nova".into());
        assert!(!a.same_content(&b));
    }
}
