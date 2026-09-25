//! O registro das transmissões do navegador (ADR-258). Saiu de `browser_cdp.rs`
//! pela catraca de tamanho; é filho dele e enxerga a `PreviewSession`.

use super::PreviewSession;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// As transmissões vivas, uma por PÁGINA (ADR-258). Antes era uma por projeto:
/// a aba da conversa e a janela flutuante, olhando páginas diferentes,
/// derrubavam a transmissão uma da outra, e uma podia mostrar o quadro da
/// página da outra com o próprio nome no seletor.
#[derive(Default)]
pub struct BrowserPreviewRegistry {
    sessions: Mutex<HashMap<String, Arc<PreviewSession>>>,
}

fn chave_da_transmissao(project_id: &str, target_id: &str) -> String {
    format!("{project_id}\u{1f}{target_id}")
}

impl BrowserPreviewRegistry {
    /// Para todas as transmissões do projeto (navegador desligado).
    pub fn stop_project(&self, project_id: &str) {
        self.parar_onde(|s| s.project_id == project_id);
    }

    fn parar_onde(&self, parar: impl Fn(&PreviewSession) -> bool) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.retain(|_, s| {
                if parar(s) {
                    let _ = s.stop.send(true);
                    false
                } else {
                    true
                }
            });
        }
    }

    pub(super) fn get(&self, project_id: &str, target_id: &str) -> Option<Arc<PreviewSession>> {
        self.sessions
            .lock()
            .ok()
            .and_then(|sessions| sessions.get(&chave_da_transmissao(project_id, target_id)).cloned())
    }

    pub(super) fn inserir(&self, session: Arc<PreviewSession>) -> Result<(), String> {
        self.sessions
            .lock()
            .map_err(|_| "registry de preview indisponível".to_string())?
            .insert(chave_da_transmissao(&session.project_id, &session.target_id), session);
        Ok(())
    }

    /// Tira a vista das páginas do projeto (menos `manter`); a que fica sem
    /// ninguém olhando para. Uma vista olha UMA página por vez.
    pub(super) fn sair(&self, project_id: &str, vista: &str, manter: Option<&str>) {
        self.parar_onde(|s| {
            if s.project_id != project_id || Some(s.target_id.as_str()) == manter {
                return false;
            }
            let Ok(mut vistas) = s.vistas.lock() else { return false };
            vistas.remove(vista);
            vistas.is_empty()
        });
    }

    /// A janela que fechou leva as vistas dela, e só elas: a aba da conversa na
    /// janela principal segue transmitindo (antes caía junto).
    pub fn sair_da_janela(&self, janela: &str) {
        let prefixo = format!("{janela}:");
        self.parar_onde(|s| {
            let Ok(mut vistas) = s.vistas.lock() else { return false };
            vistas.retain(|v| !v.starts_with(&prefixo));
            vistas.is_empty()
        });
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64};
    use tokio::sync::watch;

    fn sessao(project: &str, target: &str, vistas: &[&str]) -> (Arc<PreviewSession>, watch::Receiver<bool>) {
        let (stop, parado) = watch::channel(false);
        let s = Arc::new(PreviewSession {
            project_id: project.into(),
            target_id: target.into(),
            latest: Mutex::new(Default::default()),
            revision: AtomicU64::new(0),
            last_notice_at: AtomicI64::new(0),
            running: AtomicBool::new(true),
            error: Mutex::new(None),
            de_fundo: AtomicBool::new(false),
            vistas: Mutex::new(vistas.iter().map(|v| v.to_string()).collect()),
            stop,
        });
        (s, parado)
    }

    #[test]
    fn duas_paginas_do_mesmo_projeto_transmitem_juntas() {
        // O defeito de antes: uma transmissão por projeto, e a vista nova
        // derrubava a outra.
        let r = BrowserPreviewRegistry::default();
        let (a, parou_a) = sessao("p1", "A", &["main:aba"]);
        let (b, _) = sessao("p1", "B", &["painel-1:flutuante"]);
        r.inserir(a).unwrap();
        r.inserir(b).unwrap();
        assert!(r.get("p1", "A").is_some());
        assert!(r.get("p1", "B").is_some());
        assert!(!*parou_a.borrow());
    }

    #[test]
    fn a_vista_que_troca_de_pagina_so_para_a_transmissao_que_ficou_sem_ninguem() {
        let r = BrowserPreviewRegistry::default();
        let (a, parou_a) = sessao("p1", "A", &["main:aba", "painel-1:flutuante"]);
        let (b, parou_b) = sessao("p1", "B", &["main:aba"]);
        r.inserir(a).unwrap();
        r.inserir(b).unwrap();
        // A aba vai para a página C: sai de A (que segue com o painel) e de B
        // (que fica sem ninguém e para).
        r.sair("p1", "main:aba", Some("C"));
        assert!(r.get("p1", "A").is_some());
        assert!(!*parou_a.borrow());
        assert!(r.get("p1", "B").is_none());
        assert!(*parou_b.borrow());
    }

    #[test]
    fn a_janela_que_fecha_leva_so_as_proprias_vistas() {
        let r = BrowserPreviewRegistry::default();
        let (a, parou_a) = sessao("p1", "A", &["main:aba"]);
        let (b, parou_b) = sessao("p1", "B", &["painel-1:flutuante"]);
        r.inserir(a).unwrap();
        r.inserir(b).unwrap();
        r.sair_da_janela("painel-1");
        assert!(!*parou_a.borrow());
        assert!(*parou_b.borrow());
        assert!(r.get("p1", "A").is_some());
    }

    #[test]
    fn desligar_o_navegador_para_todas_as_transmissoes_do_projeto_e_so_dele() {
        let r = BrowserPreviewRegistry::default();
        let (a, parou_a) = sessao("p1", "A", &["main:aba"]);
        let (outro, parou_outro) = sessao("p2", "X", &["main:aba2"]);
        r.inserir(a).unwrap();
        r.inserir(outro).unwrap();
        r.stop_project("p1");
        assert!(*parou_a.borrow());
        assert!(!*parou_outro.borrow());
    }
}
