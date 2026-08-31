//! Arbitragem dos recursos interativos possuídos pela Frota.
//!
//! Um endpoint CDP compartilhado não é, por si só, uma integração segura:
//! dois pilotos ainda podem clicar e navegar ao mesmo tempo. Este registry
//! concede uma única posse por projeto a um run, a uma chamada de plugin ou à
//! pessoa. A observação continua livre; input exige a lease correspondente.

use rand::Rng;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

const HUMAN_LEASE_TTL: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, PartialEq, Eq)]
enum PilotOwner {
    Agent { run_id: String },
    Plugin { plugin_key: String, call_id: String },
    Human { token: String, last_seen_ms: i64 },
}

#[derive(Clone, Debug)]
struct PilotRecord {
    lease_id: String,
    since_ms: i64,
    owner: PilotOwner,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPilotView {
    pub project_id: String,
    pub mode: String,
    pub label: String,
    pub since: Option<i64>,
    pub expires_at: Option<i64>,
    pub can_take_over: bool,
}

impl BrowserPilotView {
    fn idle(project_id: &str) -> Self {
        Self {
            project_id: project_id.into(),
            mode: "idle".into(),
            label: "Sem piloto".into(),
            since: None,
            expires_at: None,
            can_take_over: true,
        }
    }
}

#[derive(Default, Debug)]
pub struct ExperienceBroker {
    browser_pilots: Mutex<HashMap<String, PilotRecord>>,
}

#[derive(Debug)]
pub struct BrowserPilotLease {
    project_id: String,
    lease_id: String,
    broker: Arc<ExperienceBroker>,
}

impl Drop for BrowserPilotLease {
    fn drop(&mut self) {
        self.broker.release(&self.project_id, &self.lease_id);
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn random_token() -> String {
    let mut bytes = [0_u8; 24];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn human_expired(owner: &PilotOwner, now: i64) -> bool {
    matches!(owner, PilotOwner::Human { last_seen_ms, .. }
        if now.saturating_sub(*last_seen_ms) > HUMAN_LEASE_TTL.as_millis() as i64)
}

fn owner_label(owner: &PilotOwner) -> (&'static str, String, Option<i64>) {
    match owner {
        PilotOwner::Agent { .. } => ("agent", "Agent em execução".into(), None),
        PilotOwner::Plugin { .. } => ("plugin", "Plugin em execução".into(), None),
        PilotOwner::Human { last_seen_ms, .. } => (
            "human",
            "Você está pilotando".into(),
            Some(*last_seen_ms + HUMAN_LEASE_TTL.as_millis() as i64),
        ),
    }
}

impl ExperienceBroker {
    fn clear_expired(map: &mut HashMap<String, PilotRecord>, project_id: &str, now: i64) {
        if map
            .get(project_id)
            .is_some_and(|record| human_expired(&record.owner, now))
        {
            map.remove(project_id);
        }
    }

    fn insert(
        self: &Arc<Self>,
        project_id: &str,
        owner: PilotOwner,
    ) -> Result<BrowserPilotLease, String> {
        let now = now_ms();
        let mut pilots = self
            .browser_pilots
            .lock()
            .map_err(|_| "broker de experiências indisponível".to_string())?;
        Self::clear_expired(&mut pilots, project_id, now);
        if let Some(record) = pilots.get(project_id) {
            let (_, label, _) = owner_label(&record.owner);
            return Err(format!(
                "o Navegador do projeto já tem um piloto: {label}; observe ou aguarde a liberação"
            ));
        }
        let lease_id = random_token();
        pilots.insert(
            project_id.into(),
            PilotRecord {
                lease_id: lease_id.clone(),
                since_ms: now,
                owner,
            },
        );
        Ok(BrowserPilotLease {
            project_id: project_id.into(),
            lease_id,
            broker: self.clone(),
        })
    }

    pub fn acquire_agent(
        self: &Arc<Self>,
        project_id: &str,
        run_id: &str,
    ) -> Result<BrowserPilotLease, String> {
        self.insert(
            project_id,
            PilotOwner::Agent {
                run_id: run_id.into(),
            },
        )
    }

    pub fn acquire_plugin(
        self: &Arc<Self>,
        project_id: &str,
        plugin_key: &str,
        call_id: &str,
    ) -> Result<BrowserPilotLease, String> {
        self.insert(
            project_id,
            PilotOwner::Plugin {
                plugin_key: plugin_key.into(),
                call_id: call_id.into(),
            },
        )
    }

    fn release(&self, project_id: &str, lease_id: &str) {
        if let Ok(mut pilots) = self.browser_pilots.lock() {
            if pilots
                .get(project_id)
                .is_some_and(|record| record.lease_id == lease_id)
            {
                pilots.remove(project_id);
            }
        }
    }

    pub fn status(&self, project_id: &str) -> BrowserPilotView {
        let now = now_ms();
        let Ok(mut pilots) = self.browser_pilots.lock() else {
            return BrowserPilotView {
                project_id: project_id.into(),
                mode: "unavailable".into(),
                label: "Broker indisponível".into(),
                since: None,
                expires_at: None,
                can_take_over: false,
            };
        };
        Self::clear_expired(&mut pilots, project_id, now);
        let Some(record) = pilots.get(project_id) else {
            return BrowserPilotView::idle(project_id);
        };
        let (mode, label, expires_at) = owner_label(&record.owner);
        BrowserPilotView {
            project_id: project_id.into(),
            mode: mode.into(),
            label,
            since: Some(record.since_ms),
            expires_at,
            can_take_over: false,
        }
    }

    pub fn acquire_human(self: &Arc<Self>, project_id: &str) -> Result<String, String> {
        let token = random_token();
        let now = now_ms();
        let mut pilots = self
            .browser_pilots
            .lock()
            .map_err(|_| "broker de experiências indisponível".to_string())?;
        Self::clear_expired(&mut pilots, project_id, now);
        if let Some(record) = pilots.get(project_id) {
            let (_, label, _) = owner_label(&record.owner);
            return Err(format!(
                "o Navegador do projeto já tem um piloto: {label}; observe ou aguarde a liberação"
            ));
        }
        pilots.insert(
            project_id.into(),
            PilotRecord {
                lease_id: random_token(),
                since_ms: now,
                owner: PilotOwner::Human {
                    token: token.clone(),
                    last_seen_ms: now,
                },
            },
        );
        Ok(token)
    }

    pub fn heartbeat_human(&self, project_id: &str, token: &str) -> Result<(), String> {
        let now = now_ms();
        let mut pilots = self
            .browser_pilots
            .lock()
            .map_err(|_| "broker de experiências indisponível".to_string())?;
        Self::clear_expired(&mut pilots, project_id, now);
        let record = pilots
            .get_mut(project_id)
            .ok_or("a posse humana expirou; assuma o controle novamente")?;
        match &mut record.owner {
            PilotOwner::Human {
                token: expected,
                last_seen_ms,
            } if expected == token => {
                *last_seen_ms = now;
                Ok(())
            }
            _ => Err("este painel não possui o piloto do navegador".into()),
        }
    }

    pub fn release_human(&self, project_id: &str, token: &str) -> Result<(), String> {
        let mut pilots = self
            .browser_pilots
            .lock()
            .map_err(|_| "broker de experiências indisponível".to_string())?;
        let owned = pilots.get(project_id).is_some_and(|record| {
            matches!(&record.owner, PilotOwner::Human { token: expected, .. } if expected == token)
        });
        if !owned {
            return Err("este painel não possui o piloto do navegador".into());
        }
        pilots.remove(project_id);
        Ok(())
    }

    pub fn validate_human(&self, project_id: &str, token: &str) -> Result<(), String> {
        self.heartbeat_human(project_id, token)
    }

    pub fn release_project(&self, project_id: &str) {
        if let Ok(mut pilots) = self.browser_pilots.lock() {
            pilots.remove(project_id);
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HumanPilotGrant {
    pub token: String,
    pub status: BrowserPilotView,
}

#[tauri::command]
pub fn browser_pilot_status(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<BrowserPilotView, String> {
    let project_id = crate::browser::project_id_of(&app, &project_path)?;
    Ok(app.state::<Arc<ExperienceBroker>>().status(&project_id))
}

#[tauri::command]
pub fn browser_pilot_acquire(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<HumanPilotGrant, String> {
    let project_id = crate::browser::project_id_of(&app, &project_path)?;
    if app
        .state::<Arc<crate::browser::BrowserRegistry>>()
        .get(&project_id)
        .is_none()
    {
        return Err("ligue o Navegador do projeto antes de assumir o controle".into());
    }
    let broker = app.state::<Arc<ExperienceBroker>>().inner().clone();
    let token = broker.acquire_human(&project_id)?;
    Ok(HumanPilotGrant {
        status: broker.status(&project_id),
        token,
    })
}

#[tauri::command]
pub fn browser_pilot_heartbeat(
    app: tauri::AppHandle,
    project_path: String,
    token: String,
) -> Result<BrowserPilotView, String> {
    let project_id = crate::browser::project_id_of(&app, &project_path)?;
    let broker = app.state::<Arc<ExperienceBroker>>();
    broker.heartbeat_human(&project_id, &token)?;
    Ok(broker.status(&project_id))
}

#[tauri::command]
pub fn browser_pilot_release(
    app: tauri::AppHandle,
    project_path: String,
    token: String,
) -> Result<BrowserPilotView, String> {
    let project_id = crate::browser::project_id_of(&app, &project_path)?;
    let broker = app.state::<Arc<ExperienceBroker>>();
    broker.release_human(&project_id, &token)?;
    Ok(broker.status(&project_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn um_projeto_tem_um_unico_piloto() {
        let broker = Arc::new(ExperienceBroker::default());
        let lease = broker.acquire_agent("p1", "run-1").unwrap();
        assert!(broker.acquire_plugin("p1", "plugin", "call-1").is_err());
        assert_eq!(broker.status("p1").mode, "agent");
        drop(lease);
        assert_eq!(broker.status("p1").mode, "idle");
    }

    #[test]
    fn lease_de_outro_projeto_nao_colide() {
        let broker = Arc::new(ExperienceBroker::default());
        let _a = broker.acquire_agent("p1", "run-1").unwrap();
        let _b = broker.acquire_agent("p2", "run-2").unwrap();
        assert_eq!(broker.status("p2").mode, "agent");
    }

    #[test]
    fn token_humano_errado_nao_controla_nem_libera() {
        let broker = Arc::new(ExperienceBroker::default());
        let token = broker.acquire_human("p1").unwrap();
        assert!(broker.validate_human("p1", "outro").is_err());
        assert!(broker.release_human("p1", "outro").is_err());
        assert!(broker.release_human("p1", &token).is_ok());
        assert_eq!(broker.status("p1").mode, "idle");
    }

    #[test]
    fn painel_humano_abandonado_expira_sem_daemon() {
        let broker = Arc::new(ExperienceBroker::default());
        let _token = broker.acquire_human("p1").unwrap();
        if let Ok(mut pilots) = broker.browser_pilots.lock() {
            if let Some(PilotRecord {
                owner: PilotOwner::Human { last_seen_ms, .. },
                ..
            }) = pilots.get_mut("p1")
            {
                *last_seen_ms = now_ms() - HUMAN_LEASE_TTL.as_millis() as i64 - 1;
            }
        }
        assert_eq!(broker.status("p1").mode, "idle");
    }
}
