//! Broker de posse e autorizações de pilotagem do desktop.
//!
//! Enquanto o navegador do projeto é por-projeto (ADR-131), o controle do
//! desktop é de escopo global. Este broker assegura que no máximo um ator
//! (run ou pessoa) pilota o desktop por vez, e mantém a lista de runs que
//! receberam concessão explícita (grant) da pessoa.
//!
//! O encerramento ou drop da lease aciona a limpeza fail-safe de inputs.

use serde::Serialize;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPilotView {
    pub active: bool,
    pub run_id: Option<String>,
    pub since_ms: Option<i64>,
}

/// Posse ativa de pilotagem do desktop. RAII: o drop revoga a posse e dispara
/// a liberação forçada de teclas presas.
pub struct DesktopPilotLease {
    run_id: String,
    broker: Arc<DesktopBroker>,
}

impl Drop for DesktopPilotLease {
    fn drop(&mut self) {
        self.broker.release_pilot(&self.run_id);
        crate::desktop_driver::emergency_release_inputs();
    }
}

#[derive(Default)]
pub struct DesktopBroker {
    active_pilot: Mutex<Option<(String, i64)>>,
    grants: Mutex<HashSet<String>>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl DesktopBroker {
    pub fn has_grant(&self, run_id: &str) -> bool {
        self.grants
            .lock()
            .map(|g| g.contains(run_id))
            .unwrap_or(false)
    }

    pub fn grant_run(&self, run_id: &str) {
        if let Ok(mut g) = self.grants.lock() {
            g.insert(run_id.to_string());
        }
    }

    pub fn revoke_run(&self, run_id: &str) {
        if let Ok(mut g) = self.grants.lock() {
            g.remove(run_id);
        }
    }

    pub fn acquire_pilot(self: &Arc<Self>, run_id: &str) -> Result<DesktopPilotLease, String> {
        let mut pilot = self
            .active_pilot
            .lock()
            .map_err(|_| "broker de desktop indisponível".to_string())?;

        if let Some((holder, _)) = pilot.as_ref() {
            if holder != run_id {
                return Err(
                    "o controle do desktop já está sendo operado por outro run; aguarde a liberação"
                        .into(),
                );
            }
        }

        let now = now_ms();
        *pilot = Some((run_id.to_string(), now));

        Ok(DesktopPilotLease {
            run_id: run_id.to_string(),
            broker: self.clone(),
        })
    }

    pub fn release_pilot(&self, run_id: &str) {
        if let Ok(mut pilot) = self.active_pilot.lock() {
            if pilot.as_ref().is_some_and(|(id, _)| id == run_id) {
                *pilot = None;
            }
        }
    }

    pub fn status(&self) -> DesktopPilotView {
        let pilot = self.active_pilot.lock().ok().and_then(|p| p.clone());
        match pilot {
            Some((run_id, since_ms)) => DesktopPilotView {
                active: true,
                run_id: Some(run_id),
                since_ms: Some(since_ms),
            },
            None => DesktopPilotView {
                active: false,
                run_id: None,
                since_ms: None,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn broker_gerencia_grants_e_leases() {
        let broker = Arc::new(DesktopBroker::default());
        assert!(!broker.has_grant("run-1"));

        broker.grant_run("run-1");
        assert!(broker.has_grant("run-1"));

        let lease = broker.acquire_pilot("run-1").expect("adquire lease");
        let status = broker.status();
        assert!(status.active);
        assert_eq!(status.run_id.as_deref(), Some("run-1"));

        // Segundo run não consegue tomar a posse
        assert!(broker.acquire_pilot("run-2").is_err());

        // Drop libera a posse
        drop(lease);
        assert!(!broker.status().active);

        broker.revoke_run("run-1");
        assert!(!broker.has_grant("run-1"));
    }
}
