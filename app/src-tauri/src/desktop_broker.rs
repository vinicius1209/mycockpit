//! Broker de posse e autorizações de pilotagem do desktop.
//!
//! Enquanto o navegador do projeto é por-projeto (ADR-131), o controle do
//! desktop é de escopo global. Este broker assegura que no máximo um run
//! pilota o desktop por vez, e é o dono das concessões (grant) da pessoa.
//!
//! Correção de 22/09/2026 (ADR-225, bloco de correção): a lease guardada no
//! gateway do run valia para sempre depois do primeiro clique. Revogar tirava
//! o grant e o slot, mas o run seguia pilotando, e um segundo run podia tomar o
//! slot livre: dois pilotos ao mesmo tempo. Agora cada lease tem uma GERAÇÃO e
//! só vale enquanto for a geração do dono atual; revogar troca o dono na hora.
//!
//! Grant só existe para run que PEDIU e ainda está vivo (`registrar_pedido` até
//! `end_run`): liberar um turno que já acabou é recusado, não vira grant órfão.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPilotView {
    pub active: bool,
    pub run_id: Option<String>,
    pub since_ms: Option<i64>,
}

/// Posse de pilotagem do desktop. RAII: o drop devolve a posse e solta
/// botões e modificadores, mas só se ESTA geração ainda for a dona. Lease
/// velha (revogada, ou trocada por outra) cai sem efeito físico.
pub struct DesktopPilotLease {
    generation: u64,
    broker: Arc<DesktopBroker>,
}

impl DesktopPilotLease {
    pub fn generation(&self) -> u64 {
        self.generation
    }
}

impl Drop for DesktopPilotLease {
    fn drop(&mut self) {
        self.broker.release_generation(self.generation);
    }
}

struct Pilot {
    run_id: String,
    since_ms: i64,
    generation: u64,
}

pub struct DesktopBroker {
    /// Run que pediu e ainda está vivo → se a pessoa liberou.
    runs: Mutex<HashMap<String, bool>>,
    active_pilot: Mutex<Option<Pilot>>,
    next_generation: AtomicU64,
    /// A liberação física (teclas e botões). Injetável para teste não
    /// postar evento de verdade na máquina de quem roda a suíte.
    release_inputs: fn(),
}

impl Default for DesktopBroker {
    fn default() -> Self {
        Self::with_release(crate::desktop_driver::emergency_release_inputs)
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl DesktopBroker {
    pub fn with_release(release_inputs: fn()) -> Self {
        Self {
            runs: Mutex::new(HashMap::new()),
            active_pilot: Mutex::new(None),
            next_generation: AtomicU64::new(1),
            release_inputs,
        }
    }

    /// O run pediu o controle: passa a poder receber grant até `end_run`.
    pub fn registrar_pedido(&self, run_id: &str) {
        if let Ok(mut runs) = self.runs.lock() {
            runs.entry(run_id.to_string()).or_insert(false);
        }
    }

    pub fn has_grant(&self, run_id: &str) -> bool {
        self.runs
            .lock()
            .map(|runs| runs.get(run_id).copied().unwrap_or(false))
            .unwrap_or(false)
    }

    /// Gesto da pessoa. Falha fechado: run que não pediu, ou que já terminou,
    /// não recebe grant.
    pub fn grant_run(&self, run_id: &str) -> Result<(), String> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| "broker de desktop indisponível".to_string())?;
        match runs.get_mut(run_id) {
            Some(granted) => {
                *granted = true;
                Ok(())
            }
            None => Err("este turno já terminou; o pedido de controle do computador não vale mais".into()),
        }
    }

    /// Tira o grant e, se o run é o piloto, a posse na hora (com liberação
    /// física). Devolve se havia grant.
    pub fn revoke_run(&self, run_id: &str) -> bool {
        let had = self
            .runs
            .lock()
            .ok()
            .and_then(|mut runs| runs.get_mut(run_id).map(|g| std::mem::replace(g, false)))
            .unwrap_or(false);
        self.release_run(run_id);
        had
    }

    /// Fim do run: esquece o pedido e o grant, e devolve a posse se era dele.
    /// Devolve se havia grant.
    pub fn end_run(&self, run_id: &str) -> bool {
        let had = self
            .runs
            .lock()
            .ok()
            .and_then(|mut runs| runs.remove(run_id))
            .unwrap_or(false);
        self.release_run(run_id);
        had
    }

    pub fn acquire_pilot(self: &Arc<Self>, run_id: &str) -> Result<DesktopPilotLease, String> {
        // Mesma ordem de trava de `revoke_run` (runs → piloto): um revoke no
        // meio não deixa nascer posse sem grant.
        let runs = self
            .runs
            .lock()
            .map_err(|_| "broker de desktop indisponível".to_string())?;
        if !runs.get(run_id).copied().unwrap_or(false) {
            return Err("o controle do computador não foi liberado pela pessoa para este turno".into());
        }
        let mut pilot = self
            .active_pilot
            .lock()
            .map_err(|_| "broker de desktop indisponível".to_string())?;
        if pilot.as_ref().is_some_and(|p| p.run_id != run_id) {
            return Err(
                "o controle do computador já está com outro turno; aguarde a liberação".into(),
            );
        }
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        *pilot = Some(Pilot {
            run_id: run_id.to_string(),
            since_ms: now_ms(),
            generation,
        });
        drop(pilot);
        drop(runs);
        Ok(DesktopPilotLease {
            generation,
            broker: self.clone(),
        })
    }

    /// A lease desta geração ainda é a dona da posse.
    pub fn is_current(&self, generation: u64) -> bool {
        self.active_pilot
            .lock()
            .map(|p| p.as_ref().is_some_and(|p| p.generation == generation))
            .unwrap_or(false)
    }

    fn release_generation(&self, generation: u64) {
        self.release_where(|p| p.generation == generation);
    }

    fn release_run(&self, run_id: &str) {
        self.release_where(|p| p.run_id == run_id);
    }

    fn release_where(&self, dono: impl Fn(&Pilot) -> bool) {
        let liberou = self
            .active_pilot
            .lock()
            .map(|mut pilot| {
                if pilot.as_ref().is_some_and(&dono) {
                    *pilot = None;
                    true
                } else {
                    false
                }
            })
            .unwrap_or(false);
        // Fora da trava: postar evento no SO não segura o broker.
        if liberou {
            (self.release_inputs)();
        }
    }

    pub fn status(&self) -> DesktopPilotView {
        let pilot = self
            .active_pilot
            .lock()
            .ok()
            .and_then(|p| p.as_ref().map(|p| (p.run_id.clone(), p.since_ms)));
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
    use std::sync::atomic::AtomicUsize;

    // Um contador por teste (a suíte roda em paralelo), e nenhum evento real
    // postado na máquina de quem roda.
    static SOLTOU_A: AtomicUsize = AtomicUsize::new(0);
    static SOLTOU_B: AtomicUsize = AtomicUsize::new(0);
    static SOLTOU_C: AtomicUsize = AtomicUsize::new(0);
    fn soltar_a() {
        SOLTOU_A.fetch_add(1, Ordering::SeqCst);
    }
    fn soltar_b() {
        SOLTOU_B.fetch_add(1, Ordering::SeqCst);
    }
    fn soltar_c() {
        SOLTOU_C.fetch_add(1, Ordering::SeqCst);
    }

    #[test]
    fn broker_gerencia_grants_e_leases() {
        let broker = Arc::new(DesktopBroker::with_release(soltar_a));
        assert!(!broker.has_grant("run-1"));
        assert!(broker.acquire_pilot("run-1").is_err(), "sem grant não há posse");

        broker.registrar_pedido("run-1");
        broker.grant_run("run-1").unwrap();
        assert!(broker.has_grant("run-1"));

        let lease = broker.acquire_pilot("run-1").expect("adquire lease");
        let status = broker.status();
        assert!(status.active);
        assert_eq!(status.run_id.as_deref(), Some("run-1"));

        broker.registrar_pedido("run-2");
        broker.grant_run("run-2").unwrap();
        assert!(broker.acquire_pilot("run-2").is_err(), "segundo run não toma a posse");

        drop(lease);
        assert!(!broker.status().active);
        assert_eq!(SOLTOU_A.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn revogar_derruba_a_lease_viva_e_nao_deixa_dois_pilotos() {
        let broker = Arc::new(DesktopBroker::with_release(soltar_b));
        broker.registrar_pedido("run-1");
        broker.grant_run("run-1").unwrap();
        let velha = broker.acquire_pilot("run-1").unwrap();
        assert!(broker.is_current(velha.generation()));

        assert!(broker.revoke_run("run-1"));
        assert!(!broker.is_current(velha.generation()), "a lease guardada no gateway não vale mais");
        assert!(!broker.has_grant("run-1"));
        assert!(broker.acquire_pilot("run-1").is_err(), "sem novo grant não volta a pilotar");
        assert_eq!(SOLTOU_B.load(Ordering::SeqCst), 1, "revogar solta teclas na hora");

        broker.registrar_pedido("run-2");
        broker.grant_run("run-2").unwrap();
        let nova = broker.acquire_pilot("run-2").unwrap();
        // A lease velha caindo depois não mexe na posse nem no teclado do run-2.
        drop(velha);
        assert!(broker.is_current(nova.generation()));
        assert_eq!(SOLTOU_B.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn grant_so_para_run_que_pediu_e_ainda_vive() {
        let broker = Arc::new(DesktopBroker::with_release(soltar_c));
        assert!(broker.grant_run("fantasma").is_err());
        broker.registrar_pedido("run-1");
        broker.grant_run("run-1").unwrap();
        let lease = broker.acquire_pilot("run-1").unwrap();
        assert!(broker.end_run("run-1"));
        assert!(!broker.status().active);
        assert!(!broker.is_current(lease.generation()));
        assert!(broker.grant_run("run-1").is_err(), "turno encerrado não recebe grant");
        drop(lease);
        assert_eq!(SOLTOU_C.load(Ordering::SeqCst), 1);
    }
}
