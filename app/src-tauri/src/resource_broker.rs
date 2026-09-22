//! Recursos locais que tools podem operar.
//!
//! Tool e recurso são eixos diferentes: Playwright é uma fonte de tools;
//! navegador do projeto é o alvo possuído pela Frota. Este módulo concentra o
//! vocabulário e as poucas classificações explícitas de integrações conhecidas.
//! O restante do app consome claims tipados, nunca nomes de provider.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tauri::Manager;

use crate::adapters::{CapabilityScope, PolicyEnforceability};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceKind {
    ProjectBrowser,
    ExternalBrowser,
    DesktopControl,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceOwner {
    Frota,
    Provider,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceEvidence {
    Binding,
    IntegrationRegistry,
    PluginManifest,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceState {
    Ready,
    Blocked,
}

/// Claim efetivo já resolvido para um run. Não contém endpoint, path de perfil
/// nem outro identificador sensível da máquina.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveResourceAccess {
    pub id: String,
    pub label: String,
    pub kind: ResourceKind,
    pub owner: ResourceOwner,
    pub scope: CapabilityScope,
    pub enforceability: PolicyEnforceability,
    pub evidence: ResourceEvidence,
    pub state: ResourceState,
    pub via: String,
}

#[derive(Clone, Debug)]
struct ActiveLease {
    plugin_key: String,
    resource: ResourceKind,
}

/// Leases pertencem ao processo do app e somem no Drop. Não persistem
/// endpoints nem permissões do SO, e nunca iniciam um recurso por conta própria.
#[derive(Default)]
pub struct ResourceLeaseRegistry {
    leases: Mutex<HashMap<String, ActiveLease>>,
}

impl ResourceLeaseRegistry {
    fn insert(&self, id: String, lease: ActiveLease) -> Result<(), String> {
        self.leases
            .lock()
            .map_err(|_| "registry de recursos indisponível".to_string())?
            .insert(id, lease);
        Ok(())
    }

    fn remove(&self, id: &str) {
        if let Ok(mut leases) = self.leases.lock() {
            leases.remove(id);
        }
    }

    pub fn release_plugin(&self, plugin_key: &str) {
        if let Ok(mut leases) = self.leases.lock() {
            leases.retain(|_, lease| lease.plugin_key != plugin_key);
        }
    }

    pub fn release_all(&self) {
        if let Ok(mut leases) = self.leases.lock() {
            leases.clear();
        }
    }

    pub(crate) fn active_for_plugin(&self, plugin_key: &str) -> Vec<ResourceKind> {
        let Ok(leases) = self.leases.lock() else {
            return Vec::new();
        };
        let mut resources: Vec<ResourceKind> = leases
            .values()
            .filter(|lease| lease.plugin_key == plugin_key)
            .map(|lease| lease.resource)
            .collect();
        resources.sort_by_key(|resource| match resource {
            ResourceKind::ProjectBrowser => 0,
            ResourceKind::ExternalBrowser => 1,
            ResourceKind::DesktopControl => 2,
        });
        resources.dedup();
        resources
    }
}

pub struct PluginResourceLease {
    ids: Vec<String>,
    registry: Arc<ResourceLeaseRegistry>,
    _browser_pilot: Option<crate::experience_broker::BrowserPilotLease>,
    pub(crate) env: BTreeMap<String, String>,
    pub(crate) claims: Vec<EffectiveResourceAccess>,
}

impl Drop for PluginResourceLease {
    fn drop(&mut self) {
        for id in &self.ids {
            self.registry.remove(id);
        }
    }
}

/// O browser marcado no binding é uma exigência forte: a Frota possui o
/// processo e resolve o endpoint antes do spawn. `ready=false` preserva o
/// pedido no manifesto mesmo quando o preflight bloqueia o run.
pub fn project_browser(via: &str, ready: bool) -> EffectiveResourceAccess {
    EffectiveResourceAccess {
        id: format!("project-browser:{via}"),
        label: "Navegador do projeto".to_string(),
        kind: ResourceKind::ProjectBrowser,
        owner: ResourceOwner::Frota,
        scope: CapabilityScope::Project,
        enforceability: PolicyEnforceability::Hard,
        evidence: ResourceEvidence::Binding,
        state: if ready {
            ResourceState::Ready
        } else {
            ResourceState::Blocked
        },
        via: via.to_string(),
    }
}

fn plugin_resource_claim(
    plugin_key: &str,
    kind: ResourceKind,
    ready: bool,
) -> EffectiveResourceAccess {
    let (slug, label, scope) = match kind {
        ResourceKind::ProjectBrowser => (
            "project-browser",
            "Navegador do projeto",
            CapabilityScope::Project,
        ),
        ResourceKind::ExternalBrowser => (
            "external-browser",
            "Outro navegador",
            CapabilityScope::Project,
        ),
        ResourceKind::DesktopControl => (
            "desktop-control",
            "Controle do desktop",
            CapabilityScope::Global,
        ),
    };
    EffectiveResourceAccess {
        id: format!("plugin:{plugin_key}:{slug}"),
        label: label.into(),
        kind,
        owner: ResourceOwner::Frota,
        scope,
        enforceability: PolicyEnforceability::Hard,
        evidence: ResourceEvidence::PluginManifest,
        state: if ready {
            ResourceState::Ready
        } else {
            ResourceState::Blocked
        },
        via: plugin_key.into(),
    }
}

/// Preflight sem efeito. Em especial, navegador desligado continua desligado:
/// a tool não recebe autorização para criar uma segunda janela como fallback.
pub(crate) async fn preflight_plugin_resources(
    app: &tauri::AppHandle,
    project_id: &str,
    plugin_key: &str,
    resources: &[ResourceKind],
) -> (Vec<EffectiveResourceAccess>, Option<String>) {
    let mut claims = Vec::new();
    let mut blocked = None;
    let mut seen = HashSet::new();
    for kind in resources.iter().copied().filter(|kind| seen.insert(*kind)) {
        let (ready, reason) = match kind {
            ResourceKind::ProjectBrowser => {
                let ready = crate::browser::live_endpoint(app, project_id).await.is_some();
                (
                    ready,
                    (!ready).then_some(
                        "o Navegador do projeto está desligado; ligue-o antes de usar esta tool"
                            .to_string(),
                    ),
                )
            }
            ResourceKind::ExternalBrowser => (
                false,
                Some(
                    "a Frota não autoriza plugin a abrir outro navegador; use o Navegador do projeto"
                        .to_string(),
                ),
            ),
            ResourceKind::DesktopControl => {
                let ready = crate::desktop::controller_ready();
                (
                    ready,
                    (!ready).then_some(
                        "controle do desktop indisponível; conceda as permissões de Gravação de tela e Acessibilidade no sistema operacional"
                            .to_string(),
                    ),
                )
            }
        };
        claims.push(plugin_resource_claim(plugin_key, kind, ready));
        if blocked.is_none() {
            blocked = reason;
        }
    }
    (claims, blocked)
}

pub(crate) async fn acquire_plugin_resources(
    app: &tauri::AppHandle,
    registry: Arc<ResourceLeaseRegistry>,
    project_id: &str,
    plugin_key: &str,
    call_id: &str,
    resources: &[ResourceKind],
) -> Result<PluginResourceLease, String> {
    let (claims, blocked) =
        preflight_plugin_resources(app, project_id, plugin_key, resources).await;
    if let Some(reason) = blocked {
        return Err(reason);
    }
    let mut env = BTreeMap::new();
    let mut browser_pilot = None;
    if resources.contains(&ResourceKind::ProjectBrowser) {
        let endpoint = crate::browser::live_endpoint(app, project_id)
            .await
            .ok_or("o Navegador do projeto deixou de estar disponível")?;
        browser_pilot = Some(
            app.state::<Arc<crate::experience_broker::ExperienceBroker>>()
                .inner()
                .clone()
                .acquire_plugin(project_id, plugin_key, call_id)?,
        );
        env.insert("FROTA_PROJECT_BROWSER_CDP".into(), endpoint);
    }
    let id = format!("{plugin_key}:{call_id}");
    let mut ids: Vec<String> = Vec::new();
    for claim in &claims {
        let lease_id = format!("{id}:{}", claim.id);
        if let Err(error) = registry.insert(
            lease_id.clone(),
            ActiveLease {
                plugin_key: plugin_key.into(),
                resource: claim.kind,
            },
        ) {
            for inserted in &ids {
                registry.remove(inserted);
            }
            return Err(error);
        }
        ids.push(lease_id);
    }
    Ok(PluginResourceLease {
        ids,
        registry,
        _browser_pilot: browser_pilot,
        env,
        claims,
    })
}

/// Fingerprints de integrações, independentes do provider onde foram vistas.
/// É propositalmente uma allowlist exata: alias desconhecido fica sem claim em
/// vez de ganhar acesso inferido por substring.
pub fn integration_resources(name: &str) -> Vec<ResourceKind> {
    match name.trim().to_ascii_lowercase().as_str() {
        "playwright" | "playwright-mcp" | "chrome-devtools" | "chrome-devtools-mcp" => {
            vec![ResourceKind::ExternalBrowser]
        }
        "computer-use" | "computer_use" => vec![ResourceKind::DesktopControl],
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_do_projeto_e_claim_forte_possuido_pela_frota() {
        let access = project_browser("playwright", true);
        assert_eq!(access.kind, ResourceKind::ProjectBrowser);
        assert_eq!(access.owner, ResourceOwner::Frota);
        assert_eq!(access.enforceability, PolicyEnforceability::Hard);
        assert_eq!(access.state, ResourceState::Ready);
    }

    #[test]
    fn integracao_tem_o_mesmo_recurso_em_qualquer_provider() {
        assert_eq!(
            integration_resources("playwright"),
            vec![ResourceKind::ExternalBrowser]
        );
        assert_eq!(
            integration_resources("computer-use"),
            vec![ResourceKind::DesktopControl]
        );
    }

    #[test]
    fn alias_desconhecido_nao_recebe_permissao_por_adivinhacao() {
        assert!(integration_resources("minha-tool-de-browser").is_empty());
    }
}
