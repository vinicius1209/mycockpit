//! Cadastro explícito dos canais da Frota em CLIs de configuração global:
//! `frota-work` (ADR-173) e `frota-browser` (ADR-224), mesma receita, mesmo
//! binário, subcomandos diferentes. O cache nasce no boot/Configurações, nunca
//! no caminho crítico do envio.

use crate::provider_mcp_inventory::{inspect_global_entry, GlobalCliEntry};

/// Um canal da Frota cadastrável no CLI: o nome do MCP e o subcomando deste
/// binário que o serve.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Canal {
    pub nome: &'static str,
    pub subcomando: &'static str,
}

pub const TRABALHO: Canal = Canal {
    nome: crate::work_gateway::MCP_SERVER_NAME,
    subcomando: "work-server",
};
pub const NAVEGADOR: Canal = Canal {
    nome: crate::browser_gateway::MCP_SERVER_NAME,
    subcomando: crate::browser_gateway::SUBCOMANDO,
};
pub const DESKTOP: Canal = Canal {
    nome: crate::desktop_gateway::MCP_SERVER_NAME,
    subcomando: crate::desktop_gateway::SUBCOMANDO,
};
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

fn chave(agent: &str, canal: Canal) -> String {
    format!("{agent}\u{0}{}", canal.nome)
}

pub fn invalidate(agent: &str) {
    invalidate_canal(agent, TRABALHO);
}

pub fn invalidate_canal(agent: &str, canal: Canal) {
    match cache().lock() {
        Ok(mut cache) => {
            cache.remove(&chave(agent, canal));
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
    cached_canal(agent, TRABALHO)
}

pub fn cached_browser(agent: &str) -> Option<WorkMcpSetup> {
    cached_canal(agent, NAVEGADOR)
}

pub fn cached_desktop(agent: &str) -> Option<WorkMcpSetup> {
    cached_canal(agent, DESKTOP)
}

fn cached_canal(agent: &str, canal: Canal) -> Option<WorkMcpSetup> {
    cache().lock().ok()?.get(&chave(agent, canal)).cloned()
}

pub(crate) fn supports(agent: &str) -> bool {
    crate::adapters::capabilities_of(agent).is_some_and(|caps| caps.work_mcp_global_env)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
fn state_of(entry: Option<&GlobalCliEntry>, binary: &Path) -> SetupState {
    state_of_canal(entry, binary, TRABALHO)
}

fn state_of_canal(entry: Option<&GlobalCliEntry>, binary: &Path, canal: Canal) -> SetupState {
    match entry {
        None => SetupState::Absent,
        Some(entry)
            if entry.transport == "stdio"
                && entry.command_line == format!("{} {}", binary.display(), canal.subcomando) =>
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

async fn inspect(agent: &str, canal: Canal) -> Result<SetupState, String> {
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
    let entry = inspect_global_entry(agent, canal.nome).await?;
    Ok(state_of_canal(entry.as_ref(), &binary, canal))
}

async fn refresh(agent: &str, canal: Canal) -> WorkMcpSetup {
    let (state, detail) = match inspect(agent, canal).await {
        Ok(SetupState::Conflict) => (SetupState::Conflict, Some(format!(
            "Já existe uma entrada {} com outra configuração. Ajuste-a no CLI antes de conectar.", canal.nome))),
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
            cache.insert(chave(agent, canal), snapshot.clone());
        }
        Err(error) => log::warn!("não foi possível guardar o cadastro do acompanhamento: {error}"),
    }
    snapshot
}

#[tauri::command]
pub async fn work_mcp_status(agent: String) -> WorkMcpSetup {
    let _operation = operations().lock().await;
    refresh(&agent, TRABALHO).await
}

#[tauri::command]
pub async fn browser_mcp_status(agent: String) -> WorkMcpSetup {
    let _operation = operations().lock().await;
    refresh(&agent, NAVEGADOR).await
}

#[tauri::command]
pub async fn desktop_mcp_status(agent: String) -> WorkMcpSetup {
    let _operation = operations().lock().await;
    refresh(&agent, DESKTOP).await
}

pub fn warm() {
    tauri::async_runtime::spawn(async {
        for agent in crate::adapters::registered_agents().filter(|agent| supports(agent)) {
            let _operation = operations().lock().await;
            refresh(agent, TRABALHO).await;
            refresh(agent, NAVEGADOR).await;
            refresh(agent, DESKTOP).await;
        }
    });
}

#[tauri::command]
pub async fn set_work_mcp_enabled(agent: String, enabled: bool) -> Result<WorkMcpSetup, String> {
    set_canal_enabled(agent, enabled, TRABALHO).await
}

#[tauri::command]
pub async fn set_browser_mcp_enabled(agent: String, enabled: bool) -> Result<WorkMcpSetup, String> {
    set_canal_enabled(agent, enabled, NAVEGADOR).await
}

#[tauri::command]
pub async fn set_desktop_mcp_enabled(agent: String, enabled: bool) -> Result<WorkMcpSetup, String> {
    set_canal_enabled(agent, enabled, DESKTOP).await
}

/// Liga ou desliga um controle do computador de TERCEIRO (`computer-use`) no
/// cadastro global do motor, pelo CLI dele: gesto da pessoa em Configurações,
/// sem terminal. Só vale para nome que a Frota classifica como controle do
/// computador; qualquer outro é recusado.
#[tauri::command]
pub async fn set_desktop_external_enabled(
    agent: String,
    name: String,
    enabled: bool,
) -> Result<(), String> {
    if !crate::resource_broker::integration_resources(&name)
        .contains(&crate::resource_broker::ResourceKind::DesktopControl)
    {
        return Err(format!("{name} não é um controle do computador conhecido"));
    }
    if !supports(&agent) {
        return Err("este motor não tem cadastro global que a Frota altere".into());
    }
    let argv = if enabled {
        crate::mcp_instalacao::enable_argv(&agent, &name)
    } else {
        crate::mcp_instalacao::disable_argv(&agent, &name)
    }
    .ok_or("este motor não tem receita para alterar o cadastro")?;
    let _operation = operations().lock().await;
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::process::Command::new(&argv[0])
            .args(&argv[1..])
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await;
    // Relê o cadastro de qualquer jeito: a tela mostra o que o CLI diz agora.
    refresh(&agent, DESKTOP).await;
    let output = output
        .map_err(|_| "timeout ao alterar o cadastro; estado reconsultado".to_string())?
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "o CLI recusou a alteração: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let agora = crate::provider_mcp_inventory::externos_vistos_em_cache(
        &agent,
        crate::resource_broker::ResourceKind::DesktopControl,
    );
    if !agora.iter().any(|(nome, ligado)| *nome == name && *ligado == enabled) {
        return Err("o CLI não confirmou a alteração; reverifique".into());
    }
    Ok(())
}

async fn set_canal_enabled(agent: String, enabled: bool, canal: Canal) -> Result<WorkMcpSetup, String> {
    let _operation = operations().lock().await;
    let before = refresh(&agent, canal).await;
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
        crate::mcp_instalacao::enable_argv(&agent, canal.nome)
    } else if enabled {
        let binary = std::env::current_exe().map_err(|error| error.to_string())?;
        crate::mcp_instalacao::install_argv(
            &agent,
            &crate::mcp_instalacao::McpSpec {
                nome: canal.nome.into(),
                alvo: crate::mcp_instalacao::McpAlvo::Stdio {
                    comando: binary.to_string_lossy().into_owned(),
                    args: vec![canal.subcomando.into()],
                },
                headers: vec![],
                env: vec![],
            },
        )
    } else {
        crate::mcp_instalacao::uninstall_argv(&agent, canal.nome)
    }
    .ok_or("este motor não tem receita de cadastro global")?;
    // A cache fica pessimista durante o efeito, inclusive se houver timeout.
    invalidate_canal(&agent, canal);
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::process::Command::new(&argv[0])
            .args(&argv[1..])
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await;
    let after = refresh(&agent, canal).await;
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
