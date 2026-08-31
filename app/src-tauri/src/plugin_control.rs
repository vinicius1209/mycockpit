//! Projeção e comandos do control plane de plugins.
//!
//! Manifesto valida pacote, grants persistem decisão, runtime possui processos.
//! Este módulo junta as três verdades para a UI sem dar a nenhuma delas o papel
//! da outra.

use serde::Serialize;
use std::collections::HashSet;
use std::sync::Arc;
use tauri::Emitter;

use crate::plugin_grants::{GrantStatus, GrantView, PluginAuditEvent};
use crate::plugin_manifest::{PluginPackage, PluginScan};
use crate::plugin_runtime::{PluginRuntimeRegistry, PluginRuntimeView};
use crate::resource_broker::{ResourceKind, ResourceLeaseRegistry};

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginState {
    Validated,
    Invalid,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginContributionCounts {
    pub skills: usize,
    pub mcp_servers: usize,
    pub tools: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginView {
    pub key: String,
    pub name: String,
    pub version: Option<String>,
    pub state: PluginState,
    pub executable: bool,
    pub capabilities: Vec<String>,
    pub contributes: PluginContributionCounts,
    pub fingerprint: Option<String>,
    pub detail: Option<String>,
    pub grant: GrantView,
    pub runtime: PluginRuntimeView,
    pub active_resources: Vec<ResourceKind>,
    pub audit: Vec<PluginAuditEvent>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInventory {
    pub manifest_version: u8,
    pub execution_supported: bool,
    pub plugins: Vec<PluginView>,
    pub detail: String,
}

fn valid_view(
    package: PluginPackage,
    conn: &rusqlite::Connection,
    runtime: &PluginRuntimeRegistry,
    leases: &ResourceLeaseRegistry,
) -> Result<PluginView, String> {
    let key = package.key();
    Ok(PluginView {
        key: key.clone(),
        name: package.manifest.name.clone(),
        version: Some(package.manifest.version.clone()),
        state: PluginState::Validated,
        executable: package.manifest.main.is_some(),
        capabilities: package.manifest.capability_names(),
        contributes: PluginContributionCounts {
            skills: package.manifest.contributes.skills.len(),
            mcp_servers: package.manifest.contributes.mcp_servers.len(),
            tools: package.manifest.contributes.tools.len(),
        },
        fingerprint: Some(package.fingerprint.clone()),
        detail: package.manifest.description.clone(),
        grant: crate::plugin_grants::view(conn, &package)?,
        runtime: runtime.view(&key),
        active_resources: leases.active_for_plugin(&key),
        audit: crate::plugin_grants::recent(conn, &key, 5)?,
    })
}

fn orphan_view(plugin_key: String, audit: Vec<PluginAuditEvent>) -> PluginView {
    PluginView {
        key: plugin_key.clone(),
        name: plugin_key,
        version: None,
        state: PluginState::Invalid,
        executable: false,
        capabilities: Vec::new(),
        contributes: PluginContributionCounts::default(),
        fingerprint: None,
        detail: Some(
            "O grant existe, mas o pacote não foi encontrado. Revogue-o se a remoção foi intencional."
                .into(),
        ),
        grant: GrantView {
            status: GrantStatus::Disabled,
            enabled: false,
            reviewed_at: None,
        },
        runtime: PluginRuntimeView::default(),
        active_resources: Vec::new(),
        audit,
    }
}

#[tauri::command]
pub fn inspect_plugins(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, Arc<PluginRuntimeRegistry>>,
    leases: tauri::State<'_, Arc<ResourceLeaseRegistry>>,
) -> Result<PluginInventory, String> {
    let scans = crate::plugin_manifest::scan_plugins(&app)?;
    let conn = crate::mcp_control::db(&app)?;
    let mut seen = HashSet::new();
    let mut plugins = Vec::new();
    for scan in scans {
        match scan {
            PluginScan::Valid(package) => {
                seen.insert(package.key());
                plugins.push(valid_view(package, &conn, runtime.inner(), leases.inner())?);
            }
            PluginScan::Invalid(package) => {
                seen.insert(package.key.clone());
                plugins.push(PluginView {
                    key: package.key,
                    name: package.name,
                    version: None,
                    state: PluginState::Invalid,
                    executable: false,
                    capabilities: Vec::new(),
                    contributes: PluginContributionCounts::default(),
                    fingerprint: None,
                    detail: Some(package.detail),
                    grant: GrantView::pending(),
                    runtime: PluginRuntimeView::default(),
                    active_resources: Vec::new(),
                    audit: Vec::new(),
                });
            }
        }
    }
    for plugin_key in crate::plugin_grants::grant_keys(&conn)? {
        if !seen.contains(&plugin_key) {
            let audit = crate::plugin_grants::recent(&conn, &plugin_key, 5)?;
            plugins.push(orphan_view(plugin_key, audit));
        }
    }
    plugins.sort_by(|left, right| left.key.cmp(&right.key));
    Ok(PluginInventory {
        manifest_version: crate::plugin_manifest::MANIFEST_VERSION,
        execution_supported: true,
        plugins,
        detail: "Descobrir não executa. Um grant atual publica contribuições; skills entram só quando invocadas, MCPs são materializados por run e workers de tools só nascem para uma chamada concreta."
            .into(),
    })
}

fn changed(app: &tauri::AppHandle, plugin_key: &str) {
    if let Err(error) = app.emit(
        "plugin://inventory-changed",
        serde_json::json!({ "pluginKey": plugin_key }),
    ) {
        log::warn!("não consegui publicar a mudança do plugin {plugin_key}: {error}");
    }
}

#[tauri::command]
pub fn approve_plugin(
    app: tauri::AppHandle,
    plugin_key: String,
    reviewed_fingerprint: String,
    runtime: tauri::State<'_, Arc<PluginRuntimeRegistry>>,
    leases: tauri::State<'_, Arc<ResourceLeaseRegistry>>,
) -> Result<(), String> {
    let package = crate::plugin_manifest::find_plugin(&app, &plugin_key)?;
    let conn = crate::mcp_control::db(&app)?;
    crate::plugin_grants::approve(&conn, &package, &reviewed_fingerprint)?;
    runtime.stop(&plugin_key);
    leases.release_plugin(&plugin_key);
    changed(&app, &plugin_key);
    Ok(())
}

#[tauri::command]
pub fn set_plugin_enabled(
    app: tauri::AppHandle,
    plugin_key: String,
    enabled: bool,
    runtime: tauri::State<'_, Arc<PluginRuntimeRegistry>>,
    leases: tauri::State<'_, Arc<ResourceLeaseRegistry>>,
) -> Result<(), String> {
    let package = crate::plugin_manifest::find_plugin(&app, &plugin_key)?;
    let conn = crate::mcp_control::db(&app)?;
    crate::plugin_grants::set_enabled(&conn, &package, enabled)?;
    if !enabled {
        runtime.stop(&plugin_key);
        leases.release_plugin(&plugin_key);
    }
    changed(&app, &plugin_key);
    Ok(())
}

#[tauri::command]
pub fn revoke_plugin_grant(
    app: tauri::AppHandle,
    plugin_key: String,
    runtime: tauri::State<'_, Arc<PluginRuntimeRegistry>>,
    leases: tauri::State<'_, Arc<ResourceLeaseRegistry>>,
) -> Result<(), String> {
    let conn = crate::mcp_control::db(&app)?;
    crate::plugin_grants::revoke(&conn, &plugin_key)?;
    runtime.stop(&plugin_key);
    leases.release_plugin(&plugin_key);
    changed(&app, &plugin_key);
    Ok(())
}

#[tauri::command]
pub fn stop_plugin_runtime(
    app: tauri::AppHandle,
    plugin_key: String,
    runtime: tauri::State<'_, Arc<PluginRuntimeRegistry>>,
    leases: tauri::State<'_, Arc<ResourceLeaseRegistry>>,
) -> Result<(), String> {
    runtime.stop(&plugin_key);
    leases.release_plugin(&plugin_key);
    match crate::mcp_control::db(&app) {
        Ok(conn) => {
            if let Err(error) = crate::plugin_grants::audit(
                &conn,
                &plugin_key,
                "runtime",
                "stop-requested",
                None,
                None,
            ) {
                log::warn!("não consegui auditar a parada do plugin {plugin_key}: {error}");
            }
        }
        Err(error) => {
            log::warn!("não consegui abrir a auditoria ao parar o plugin {plugin_key}: {error}");
        }
    }
    changed(&app, &plugin_key);
    Ok(())
}
