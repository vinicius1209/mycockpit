//! Arbitragem dos recursos interativos possuídos pela Frota.
//!
//! Um endpoint CDP compartilhado não é, por si só, uma integração segura:
//! dois pilotos ainda podem clicar e navegar ao mesmo tempo. Este registry
//! concede posse a um run, a uma chamada de plugin ou à pessoa, por PÁGINA
//! (o agente da Frota e a pessoa) ou pelo PROJETO inteiro (quem enxerga o
//! navegador todo), sem colisão entre páginas diferentes (ADR-258). A
//! observação continua livre; input exige a lease correspondente.

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

/// O que a posse cobre (ADR-258). A página é da conversa (ADR-244), então o
/// agente da Frota e a pessoa pegam só a página em que agem, e duas conversas
/// do mesmo projeto não se bloqueiam. O projeto inteiro fica para quem enxerga
/// o navegador todo e não tem como se limitar a uma página: MCP de terceiros
/// ligado pela porta de depuração e plugins.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Alcance {
    Projeto,
    Pagina(String),
}

impl Alcance {
    /// As duas posses disputam a mesma coisa?
    fn colide(&self, outro: &Alcance) -> bool {
        match (self, outro) {
            (Alcance::Pagina(a), Alcance::Pagina(b)) => a == b,
            _ => true,
        }
    }
}

#[derive(Clone, Debug)]
struct PilotRecord {
    lease_id: String,
    since_ms: i64,
    alcance: Alcance,
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
    /// Por projeto, as posses vivas (várias, desde que não colidam).
    browser_pilots: Mutex<HashMap<String, Vec<PilotRecord>>>,
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
        PilotOwner::Agent { .. } => ("agent", "Agente em execução".into(), None),
        PilotOwner::Plugin { .. } => ("plugin", "Plugin em execução".into(), None),
        PilotOwner::Human { last_seen_ms, .. } => (
            "human",
            "Você está pilotando".into(),
            Some(*last_seen_ms + HUMAN_LEASE_TTL.as_millis() as i64),
        ),
    }
}

/// Por que a posse foi recusada, dito a quem pediu: quem está com ela e o quê.
/// Antes era sempre "a pessoa está pilotando", mesmo quando era outro agente.
fn motivo_da_recusa(record: &PilotRecord) -> String {
    let o_que = match &record.alcance {
        Alcance::Projeto => "o navegador inteiro do projeto",
        Alcance::Pagina(_) => "esta página",
    };
    match &record.owner {
        PilotOwner::Human { .. } => format!("A pessoa está pilotando {o_que} agora; observe ou aguarde ela soltar o controle."),
        PilotOwner::Agent { .. } => format!("Outro agente está usando {o_que} agora; observe ou aguarde o turno dele terminar."),
        PilotOwner::Plugin { .. } => format!("Um plugin está usando {o_que} agora; aguarde a chamada terminar."),
    }
}

impl ExperienceBroker {
    fn clear_expired(map: &mut HashMap<String, Vec<PilotRecord>>, project_id: &str, now: i64) {
        if let Some(records) = map.get_mut(project_id) {
            records.retain(|record| !human_expired(&record.owner, now));
        }
    }

    /// Registra a posse, se não colide com nenhuma viva. Devolve o id dela.
    fn insert(&self, project_id: &str, alcance: Alcance, owner: PilotOwner) -> Result<String, String> {
        let now = now_ms();
        let mut pilots = self
            .browser_pilots
            .lock()
            .map_err(|_| "broker de experiências indisponível".to_string())?;
        Self::clear_expired(&mut pilots, project_id, now);
        let records = pilots.entry(project_id.into()).or_default();
        if let Some(record) = records.iter().find(|r| r.alcance.colide(&alcance)) {
            return Err(motivo_da_recusa(record));
        }
        let lease_id = random_token();
        records.push(PilotRecord {
            lease_id: lease_id.clone(),
            since_ms: now,
            alcance,
            owner,
        });
        Ok(lease_id)
    }

    /// Posse de run ou de plugin: solta sozinha quando a lease cai (`Drop`).
    fn lease(self: &Arc<Self>, project_id: &str, alcance: Alcance, owner: PilotOwner) -> Result<BrowserPilotLease, String> {
        let lease_id = self.insert(project_id, alcance, owner)?;
        Ok(BrowserPilotLease {
            project_id: project_id.into(),
            lease_id,
            broker: self.clone(),
        })
    }

    pub fn acquire_agent(
        self: &Arc<Self>,
        project_id: &str,
        alcance: Alcance,
        run_id: &str,
    ) -> Result<BrowserPilotLease, String> {
        self.lease(project_id, alcance, PilotOwner::Agent { run_id: run_id.into() })
    }

    /// Plugin não sabe de páginas: pega o projeto inteiro.
    pub fn acquire_plugin(
        self: &Arc<Self>,
        project_id: &str,
        plugin_key: &str,
        call_id: &str,
    ) -> Result<BrowserPilotLease, String> {
        self.lease(
            project_id,
            Alcance::Projeto,
            PilotOwner::Plugin {
                plugin_key: plugin_key.into(),
                call_id: call_id.into(),
            },
        )
    }

    fn release(&self, project_id: &str, lease_id: &str) {
        if let Ok(mut pilots) = self.browser_pilots.lock() {
            if let Some(records) = pilots.get_mut(project_id) {
                records.retain(|record| record.lease_id != lease_id);
            }
        }
    }

    /// Quem controla ESTA página (ou o projeto inteiro, se alguém o segura).
    pub fn status(&self, project_id: &str, target_id: &str) -> BrowserPilotView {
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
        let pagina = Alcance::Pagina(target_id.into());
        let Some(record) = pilots
            .get(project_id)
            .and_then(|records| records.iter().find(|r| r.alcance.colide(&pagina)))
        else {
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

    /// A pessoa assume o controle da página que está olhando.
    pub fn acquire_human(self: &Arc<Self>, project_id: &str, target_id: &str) -> Result<String, String> {
        // A posse humana vive pelo heartbeat (e expira sem ele), não por lease.
        let token = random_token();
        self.insert(
            project_id,
            Alcance::Pagina(target_id.into()),
            PilotOwner::Human {
                token: token.clone(),
                last_seen_ms: now_ms(),
            },
        )?;
        Ok(token)
    }

    fn com_humano<T>(
        &self,
        project_id: &str,
        token: &str,
        f: impl FnOnce(&mut Vec<PilotRecord>, usize) -> T,
    ) -> Result<T, String> {
        let now = now_ms();
        let mut pilots = self
            .browser_pilots
            .lock()
            .map_err(|_| "broker de experiências indisponível".to_string())?;
        Self::clear_expired(&mut pilots, project_id, now);
        let records = pilots
            .get_mut(project_id)
            .ok_or("a posse humana expirou; assuma o controle novamente")?;
        let i = records
            .iter()
            .position(|r| matches!(&r.owner, PilotOwner::Human { token: t, .. } if t == token))
            .ok_or("este painel não possui o piloto do navegador")?;
        Ok(f(records, i))
    }

    pub fn heartbeat_human(&self, project_id: &str, token: &str) -> Result<(), String> {
        self.com_humano(project_id, token, |records, i| {
            if let PilotOwner::Human { last_seen_ms, .. } = &mut records[i].owner {
                *last_seen_ms = now_ms();
            }
        })
    }

    pub fn release_human(&self, project_id: &str, token: &str) -> Result<(), String> {
        self.com_humano(project_id, token, |records, i| {
            records.remove(i);
        })
    }

    /// O token vale para ESTA página: pilotar a página A não dá input na B.
    pub fn validate_human(&self, project_id: &str, target_id: &str, token: &str) -> Result<(), String> {
        let pagina = Alcance::Pagina(target_id.into());
        let certa = self.com_humano(project_id, token, |records, i| records[i].alcance == pagina)?;
        if !certa {
            return Err("o controle que você assumiu é de outra página".into());
        }
        self.heartbeat_human(project_id, token)
    }

    /// Algum run ou plugin segura qualquer parte do navegador do projeto? É o
    /// que impede desligá-lo no meio do trabalho de alguém.
    pub fn em_uso(&self, project_id: &str) -> Option<BrowserPilotView> {
        let pilots = self.browser_pilots.lock().ok()?;
        let record = pilots
            .get(project_id)?
            .iter()
            .find(|r| matches!(r.owner, PilotOwner::Agent { .. } | PilotOwner::Plugin { .. }))?;
        let (mode, label, expires_at) = owner_label(&record.owner);
        Some(BrowserPilotView {
            project_id: project_id.into(),
            mode: mode.into(),
            label,
            since: Some(record.since_ms),
            expires_at,
            can_take_over: false,
        })
    }

    /// Quem está com o navegador do projeto, em qualquer página e contando a
    /// pessoa: o que o cartão de Configurações mostra.
    pub fn status_do_projeto(&self, project_id: &str) -> BrowserPilotView {
        let Ok(mut pilots) = self.browser_pilots.lock() else {
            return BrowserPilotView {
                mode: "unavailable".into(),
                label: "Broker indisponível".into(),
                ..BrowserPilotView::idle(project_id)
            };
        };
        Self::clear_expired(&mut pilots, project_id, now_ms());
        let Some(record) = pilots.get(project_id).and_then(|r| r.first()) else {
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
    // Sem página: quem está usando o navegador do projeto, em qualquer página
    // (o cartão de Configurações).
    target_id: Option<String>,
) -> Result<BrowserPilotView, String> {
    let project_id = crate::browser::project_id_of(&app, &project_path)?;
    let broker = app.state::<Arc<ExperienceBroker>>();
    Ok(match target_id {
        Some(target) => broker.status(&project_id, &target),
        None => broker.status_do_projeto(&project_id),
    })
}

/// "Assumir controle" vale para a página que a pessoa está olhando (ADR-258).
#[tauri::command]
pub fn browser_pilot_acquire(
    app: tauri::AppHandle,
    project_path: String,
    target_id: String,
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
    let token = broker.acquire_human(&project_id, &target_id)?;
    Ok(HumanPilotGrant {
        status: broker.status(&project_id, &target_id),
        token,
    })
}

#[tauri::command]
pub fn browser_pilot_heartbeat(
    app: tauri::AppHandle,
    project_path: String,
    target_id: String,
    token: String,
) -> Result<BrowserPilotView, String> {
    let project_id = crate::browser::project_id_of(&app, &project_path)?;
    let broker = app.state::<Arc<ExperienceBroker>>();
    broker.heartbeat_human(&project_id, &token)?;
    Ok(broker.status(&project_id, &target_id))
}

#[tauri::command]
pub fn browser_pilot_release(
    app: tauri::AppHandle,
    project_path: String,
    target_id: String,
    token: String,
) -> Result<BrowserPilotView, String> {
    let project_id = crate::browser::project_id_of(&app, &project_path)?;
    let broker = app.state::<Arc<ExperienceBroker>>();
    broker.release_human(&project_id, &token)?;
    Ok(broker.status(&project_id, &target_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pagina(id: &str) -> Alcance {
        Alcance::Pagina(id.into())
    }

    #[test]
    fn a_mesma_pagina_tem_um_unico_piloto() {
        let broker = Arc::new(ExperienceBroker::default());
        let lease = broker.acquire_agent("p1", pagina("A"), "run-1").unwrap();
        assert!(broker.acquire_agent("p1", pagina("A"), "run-2").is_err());
        assert!(broker.acquire_human("p1", "A").is_err());
        assert_eq!(broker.status("p1", "A").mode, "agent");
        drop(lease);
        assert_eq!(broker.status("p1", "A").mode, "idle");
    }

    #[test]
    fn paginas_diferentes_do_mesmo_projeto_nao_se_bloqueiam() {
        // O defeito de antes (ADR-258): o agente de uma conversa segurava o
        // projeto inteiro e barrava o de outra conversa e a pessoa.
        let broker = Arc::new(ExperienceBroker::default());
        let _a = broker.acquire_agent("p1", pagina("A"), "run-conversa-a").unwrap();
        let _b = broker.acquire_agent("p1", pagina("B"), "run-conversa-b").unwrap();
        let token = broker.acquire_human("p1", "C").unwrap();
        assert!(broker.validate_human("p1", "C", &token).is_ok());
        assert_eq!(broker.status("p1", "B").mode, "agent");
        assert_eq!(broker.status("p1", "C").mode, "human");
    }

    #[test]
    fn quem_segura_o_projeto_inteiro_exclui_todos_e_e_excluido_por_qualquer_um() {
        let broker = Arc::new(ExperienceBroker::default());
        let terceiro = broker.acquire_agent("p1", Alcance::Projeto, "run-playwright").unwrap();
        assert!(broker.acquire_agent("p1", pagina("A"), "run-2").is_err());
        assert!(broker.acquire_human("p1", "B").is_err());
        assert_eq!(broker.status("p1", "qualquer").mode, "agent");
        drop(terceiro);
        let _pagina = broker.acquire_agent("p1", pagina("A"), "run-2").unwrap();
        assert!(broker.acquire_plugin("p1", "plugin", "call-1").is_err());
    }

    #[test]
    fn a_recusa_diz_quem_esta_com_a_pagina() {
        let broker = Arc::new(ExperienceBroker::default());
        let _agente = broker.acquire_agent("p1", pagina("A"), "run-1").unwrap();
        let erro = broker.acquire_human("p1", "A").unwrap_err();
        assert!(erro.starts_with("Outro agente está usando esta página"), "{erro}");
        let _token = broker.acquire_human("p1", "B").unwrap();
        let erro = broker.acquire_agent("p1", pagina("B"), "run-2").unwrap_err();
        assert!(erro.starts_with("A pessoa está pilotando esta página"), "{erro}");
    }

    #[test]
    fn o_status_do_projeto_ve_quem_estiver_em_qualquer_pagina_inclusive_a_pessoa() {
        let broker = Arc::new(ExperienceBroker::default());
        assert_eq!(broker.status_do_projeto("p1").mode, "idle");
        let token = broker.acquire_human("p1", "B").unwrap();
        assert_eq!(broker.status_do_projeto("p1").mode, "human");
        // `em_uso` é a pergunta do desligar: a pessoa não impede.
        assert!(broker.em_uso("p1").is_none());
        broker.release_human("p1", &token).unwrap();
        assert_eq!(broker.status_do_projeto("p1").mode, "idle");
    }

    #[test]
    fn lease_de_outro_projeto_nao_colide() {
        let broker = Arc::new(ExperienceBroker::default());
        let _a = broker.acquire_agent("p1", Alcance::Projeto, "run-1").unwrap();
        let _b = broker.acquire_agent("p2", Alcance::Projeto, "run-2").unwrap();
        assert_eq!(broker.status("p2", "x").mode, "agent");
    }

    #[test]
    fn token_humano_errado_nao_controla_nem_libera() {
        let broker = Arc::new(ExperienceBroker::default());
        let token = broker.acquire_human("p1", "A").unwrap();
        assert!(broker.validate_human("p1", "A", "outro").is_err());
        assert!(broker.release_human("p1", "outro").is_err());
        assert!(broker.release_human("p1", &token).is_ok());
        assert_eq!(broker.status("p1", "A").mode, "idle");
    }

    #[test]
    fn o_controle_de_uma_pagina_nao_da_input_em_outra() {
        let broker = Arc::new(ExperienceBroker::default());
        let token = broker.acquire_human("p1", "A").unwrap();
        assert!(broker.validate_human("p1", "B", &token).is_err());
        assert!(broker.validate_human("p1", "A", &token).is_ok());
    }

    #[test]
    fn painel_humano_abandonado_expira_sem_daemon() {
        let broker = Arc::new(ExperienceBroker::default());
        let _token = broker.acquire_human("p1", "A").unwrap();
        if let Ok(mut pilots) = broker.browser_pilots.lock() {
            for record in pilots.get_mut("p1").into_iter().flatten() {
                if let PilotOwner::Human { last_seen_ms, .. } = &mut record.owner {
                    *last_seen_ms = now_ms() - HUMAN_LEASE_TTL.as_millis() as i64 - 1;
                }
            }
        }
        assert_eq!(broker.status("p1", "A").mode, "idle");
        // E a página volta a estar livre para o agente.
        assert!(broker.acquire_agent("p1", pagina("A"), "run-1").is_ok());
    }
}
