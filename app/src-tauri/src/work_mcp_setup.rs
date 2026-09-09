//! Cadastro explícito do canal de trabalho em CLIs de configuração global.
//! O cache nasce no boot/Configurações, nunca no caminho crítico do envio.

use crate::provider_mcp_inventory::{inspect_global_entry, GlobalCliEntry};
use crate::work_gateway::MCP_SERVER_NAME;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SetupState {
    Absent,
    Configured,
    Disabled,
    Conflict,
    Unavailable,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkMcpSetup {
    pub agent: String,
    pub state: SetupState,
    pub checked_at: i64,
    pub detail: Option<String>,
}

impl WorkMcpSetup {
    pub fn age_secs(&self) -> i64 {
        (now_ms().saturating_sub(self.checked_at) / 1_000).max(0)
    }
}

pub fn invalidate(agent: &str) {
    match cache().lock() {
        Ok(mut cache) => {
            cache.remove(agent);
        }
        Err(error) => log::warn!("cache do acompanhamento indisponível: {error}"),
    }
}

fn cache() -> &'static Mutex<HashMap<String, WorkMcpSetup>> {
    static CACHE: OnceLock<Mutex<HashMap<String, WorkMcpSetup>>> = OnceLock::new();
    CACHE.get_or_init(Mutex::default)
}

// Serializa gestos e verificações para que uma consulta antiga não republique
// "configurado" depois de remover. É distinto do lock curto do snapshot.
fn operations() -> &'static tokio::sync::Mutex<()> {
    static OPS: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    OPS.get_or_init(|| tokio::sync::Mutex::new(()))
}

pub fn cached(agent: &str) -> Option<WorkMcpSetup> {
    cache().lock().ok()?.get(agent).cloned()
}

fn supports(agent: &str) -> bool {
    crate::adapters::capabilities_of(agent).is_some_and(|caps| caps.work_mcp_global_env)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.as_millis() as i64)
        .unwrap_or(0)
}

fn state_of(entry: Option<&GlobalCliEntry>, binary: &Path) -> SetupState {
    match entry {
        None => SetupState::Absent,
        Some(entry)
            if entry.transport == "stdio"
                && entry.command_line == format!("{} work-server", binary.display()) =>
        {
            if entry.enabled {
                SetupState::Configured
            } else {
                SetupState::Disabled
            }
        }
        Some(_) => SetupState::Conflict,
    }
}

async fn inspect(agent: &str) -> Result<SetupState, String> {
    if !supports(agent) {
        return Err("este motor não usa cadastro global de acompanhamento".into());
    }
    let minimum = crate::provider_mcp_inventory::global_work_min_version(agent)
        .ok_or("versão mínima deste canal não definida")?;
    let version = crate::detect::detected_version(agent)
        .await
        .ok_or("não foi possível confirmar a versão do CLI")?;
    let version = semver::Version::parse(&version).map_err(|error| error.to_string())?;
    let minimum_version = semver::Version::parse(minimum).map_err(|error| error.to_string())?;
    if version < minimum_version {
        return Err(format!("este canal exige CLI {minimum} ou mais recente"));
    }
    let binary = std::env::current_exe().map_err(|error| error.to_string())?;
    let entry = inspect_global_entry(agent, MCP_SERVER_NAME).await?;
    Ok(state_of(entry.as_ref(), &binary))
}

async fn refresh(agent: &str) -> WorkMcpSetup {
    let (state, detail) = match inspect(agent).await {
        Ok(SetupState::Conflict) => (SetupState::Conflict, Some(
            "Já existe uma entrada mc-work com outra configuração. Ajuste-a no CLI antes de conectar.".into())),
        Ok(state) => (state, None),
        Err(error) => (SetupState::Unavailable, Some(error)),
    };
    let snapshot = WorkMcpSetup {
        agent: agent.into(),
        state,
        checked_at: now_ms(),
        detail,
    };
    match cache().lock() {
        Ok(mut cache) => {
            cache.insert(agent.into(), snapshot.clone());
        }
        Err(error) => log::warn!("não foi possível guardar o cadastro do acompanhamento: {error}"),
    }
    snapshot
}

#[tauri::command]
pub async fn work_mcp_status(agent: String) -> WorkMcpSetup {
    let _operation = operations().lock().await;
    refresh(&agent).await
}

pub fn warm() {
    tauri::async_runtime::spawn(async {
        for agent in crate::adapters::registered_agents().filter(|agent| supports(agent)) {
            let _operation = operations().lock().await;
            refresh(agent).await;
        }
    });
}

#[tauri::command]
pub async fn set_work_mcp_enabled(agent: String, enabled: bool) -> Result<WorkMcpSetup, String> {
    let _operation = operations().lock().await;
    let before = refresh(&agent).await;
    match (&before.state, enabled) {
        (SetupState::Configured, true) | (SetupState::Absent, false) => return Ok(before),
        (SetupState::Absent, true)
        | (SetupState::Disabled, true)
        | (SetupState::Configured | SetupState::Disabled, false) => {}
        _ => {
            return Err(before
                .detail
                .unwrap_or_else(|| "reverifique o CLI antes de alterar".into()))
        }
    }
    let argv = if enabled && before.state == SetupState::Disabled {
        crate::mcp_instalacao::enable_argv(&agent, MCP_SERVER_NAME)
    } else if enabled {
        let binary = std::env::current_exe().map_err(|error| error.to_string())?;
        crate::mcp_instalacao::install_argv(
            &agent,
            &crate::mcp_instalacao::McpSpec {
                nome: MCP_SERVER_NAME.into(),
                alvo: crate::mcp_instalacao::McpAlvo::Stdio {
                    comando: binary.to_string_lossy().into_owned(),
                    args: vec!["work-server".into()],
                },
                headers: vec![],
                env: vec![],
            },
        )
    } else {
        crate::mcp_instalacao::uninstall_argv(&agent, MCP_SERVER_NAME)
    }
    .ok_or("este motor não tem receita de cadastro global")?;
    // A cache fica pessimista durante o efeito, inclusive se houver timeout.
    invalidate(&agent);
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::process::Command::new(&argv[0])
            .args(&argv[1..])
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await;
    let after = refresh(&agent).await;
    let output = output
        .map_err(|_| "timeout ao alterar o canal; inventário reconsultado".to_string())?
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "o CLI recusou a alteração: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let expected = if enabled {
        SetupState::Configured
    } else {
        SetupState::Absent
    };
    if after.state != expected {
        return Err(after
            .detail
            .unwrap_or_else(|| "o CLI não confirmou a alteração; reverifique".into()));
    }
    Ok(after)
}

#[cfg(test)]
#[path = "work_mcp_setup_tests.rs"]
mod tests;
