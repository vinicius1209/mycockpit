//! De que conversa é cada página do navegador do projeto (ADR-244).
//!
//! Pedido de 24/09/2026: "pensa que confuso ter apenas 1 aba de navegador
//! compartilhada entre conversas". O Chromium segue um por projeto (o perfil e
//! o login são do projeto), mas cada conversa tem as PRÓPRIAS páginas: o agente
//! de uma conversa só enxerga e só age nas dela, e a aba Navegador da conversa
//! mostra só as dela. Antes, cada turno pegava a primeira página aberta, e dois
//! agentes de conversas diferentes acabavam clicando na mesma.
//!
//! Posse em memória, de propósito: o id da página nasce e morre com o Chromium,
//! e o que sobra de uma sessão anterior é página sem dono, que a primeira
//! conversa a precisar de uma adota. Página que o agente abre (clique que abre
//! aba, `browser_tab_new`) nasce da conversa dele.
//!
//! OLHAR não abre página: a lista da tela é só leitura. Página nasce quando o
//! agente precisa de uma, ou quando a pessoa pede ("Abrir uma página aqui").
//! Senão, passear pelas conversas com a janela flutuante aberta deixaria uma
//! página nova em cada uma.
//!
//! O que fica de fora: um MCP de terceiros ligado direto ao CDP (o Playwright
//! com `--cdp-endpoint`) escolhe páginas por conta própria e não passa por aqui.

use crate::browser_cdp::RawPage;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

#[derive(Default, Debug)]
pub(crate) struct Donos {
    /// página → conversa
    dono: HashMap<String, String>,
    /// conversa → a última página em que ela trabalhou (o agente ou a pessoa)
    ultima: HashMap<String, String>,
}

impl Donos {
    /// Esquece as páginas que não existem mais. Puro.
    pub(crate) fn podar(&mut self, vivas: &[RawPage]) {
        self.dono.retain(|id, _| vivas.iter().any(|p| &p.id == id));
        self.ultima.retain(|_, id| vivas.iter().any(|p| &p.id == id));
    }

    /// As páginas da conversa, na ordem do navegador. Puro.
    pub(crate) fn da_conversa(&self, conv: &str, abas: &[RawPage]) -> Vec<RawPage> {
        abas.iter()
            .filter(|p| self.dono.get(&p.id).is_some_and(|d| d == conv))
            .cloned()
            .collect()
    }

    /// As que ainda não são de ninguém. Puro.
    pub(crate) fn sem_dono(&self, abas: &[RawPage]) -> Vec<RawPage> {
        abas.iter().filter(|p| !self.dono.contains_key(&p.id)).cloned().collect()
    }

    pub(crate) fn tomar(&mut self, pagina: &str, conv: &str) {
        self.dono.insert(pagina.to_string(), conv.to_string());
    }

    /// Anota a página em que a conversa está, se for dela.
    pub(crate) fn usar(&mut self, conv: &str, pagina: &str) {
        if self.dono.get(pagina).is_some_and(|d| d == conv) {
            self.ultima.insert(conv.to_string(), pagina.to_string());
        }
    }

    pub(crate) fn ultima(&self, conv: &str) -> Option<String> {
        self.ultima.get(conv).cloned()
    }
}

fn donos() -> &'static Mutex<Donos> {
    static D: OnceLock<Mutex<Donos>> = OnceLock::new();
    D.get_or_init(Default::default)
}

/// Roda `f` com o registro. Trava envenenada vira registro vazio de fato: a
/// posse se refaz na próxima chamada, sem derrubar o navegador.
pub(crate) fn com<T>(f: impl FnOnce(&mut Donos) -> T) -> T {
    let mut guarda = donos().lock().unwrap_or_else(|e| e.into_inner());
    f(&mut guarda)
}

/// O que fazer para a conversa ter página. Puro.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Garantia {
    /// Ela já tem estas.
    Tem(Vec<String>),
    /// Adota esta, que não era de ninguém.
    Adota(String),
    /// Precisa abrir uma.
    Abre,
}

pub(crate) fn garantia(d: &Donos, conv: &str, abas: &[RawPage]) -> Garantia {
    let minhas = d.da_conversa(conv, abas);
    if !minhas.is_empty() {
        return Garantia::Tem(minhas.into_iter().map(|p| p.id).collect());
    }
    match d.sem_dono(abas).into_iter().next() {
        Some(livre) => Garantia::Adota(livre.id),
        None => Garantia::Abre,
    }
}

/// Só leitura: as páginas que já são da conversa.
pub(crate) async fn listar_da_conversa(
    app: &tauri::AppHandle,
    project_path: &str,
    conv: &str,
) -> Result<Vec<RawPage>, String> {
    let todas = crate::browser_cdp::abas_do_projeto(app, project_path).await?;
    Ok(com(|d| {
        d.podar(&todas);
        d.da_conversa(conv, &todas)
    }))
}

/// Uma abertura de página por vez: duas chamadas da mesma conversa ao mesmo
/// tempo (o agente e a tela, ou duas tools) abririam duas.
fn abrindo() -> &'static tokio::sync::Mutex<()> {
    static A: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    A.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// As páginas da conversa, abrindo uma se ela não tem nenhuma.
pub(crate) async fn paginas_da_conversa(
    app: &tauri::AppHandle,
    project_path: &str,
    conv: &str,
) -> Result<Vec<RawPage>, String> {
    let todas = crate::browser_cdp::abas_do_projeto(app, project_path).await?;
    let decisao = com(|d| {
        d.podar(&todas);
        let g = garantia(d, conv, &todas);
        if let Garantia::Adota(id) = &g {
            d.tomar(id, conv);
        }
        g
    });
    match decisao {
        Garantia::Tem(_) | Garantia::Adota(_) => Ok(com(|d| d.da_conversa(conv, &todas))),
        Garantia::Abre => {
            let _vez = abrindo().lock().await;
            // Quem esperou a vez pode achar a página que a outra chamada abriu.
            let todas = crate::browser_cdp::abas_do_projeto(app, project_path).await?;
            let ja = com(|d| d.da_conversa(conv, &todas));
            if !ja.is_empty() {
                return Ok(ja);
            }
            let nova = crate::browser_cdp::nova_aba(app, project_path).await?;
            com(|d| d.tomar(&nova.id, conv));
            Ok(vec![nova])
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn aba(id: &str) -> RawPage {
        RawPage { id: id.into(), title: String::new(), url: String::new(), kind: "page".into(), websocket_url: Some(format!("ws://{id}")) }
    }

    #[test]
    fn cada_conversa_ve_so_as_proprias_paginas() {
        let mut d = Donos::default();
        let abas = [aba("A"), aba("B"), aba("C")];
        d.tomar("A", "c1");
        d.tomar("C", "c2");
        d.tomar("B", "c1");
        let ids = |v: Vec<RawPage>| v.into_iter().map(|p| p.id).collect::<Vec<_>>();
        assert_eq!(ids(d.da_conversa("c1", &abas)), ["A", "B"]);
        assert_eq!(ids(d.da_conversa("c2", &abas)), ["C"]);
        assert!(d.da_conversa("c3", &abas).is_empty());
    }

    #[test]
    fn conversa_sem_pagina_adota_uma_sem_dono_ou_abre_outra() {
        let mut d = Donos::default();
        let abas = [aba("A"), aba("B")];
        // o Chromium nasce com uma página: a primeira conversa fica com ela
        assert_eq!(garantia(&d, "c1", &abas), Garantia::Adota("A".into()));
        d.tomar("A", "c1");
        assert_eq!(garantia(&d, "c2", &abas), Garantia::Adota("B".into()));
        d.tomar("B", "c2");
        // e a terceira não toma a de ninguém: abre a própria
        assert_eq!(garantia(&d, "c3", &abas), Garantia::Abre);
        assert_eq!(garantia(&d, "c1", &abas), Garantia::Tem(vec!["A".into()]));
    }

    #[test]
    fn pagina_fechada_sai_da_posse_e_da_ultima() {
        let mut d = Donos::default();
        d.tomar("A", "c1");
        d.usar("c1", "A");
        d.podar(&[aba("B")]);
        assert!(d.da_conversa("c1", &[aba("A")]).is_empty());
        assert_eq!(d.ultima("c1"), None);
    }

    #[test]
    fn a_ultima_so_vale_para_pagina_da_propria_conversa() {
        let mut d = Donos::default();
        d.tomar("A", "c1");
        d.tomar("B", "c2");
        d.usar("c1", "B");
        assert_eq!(d.ultima("c1"), None, "a conversa não aponta para a página de outra");
        d.usar("c1", "A");
        assert_eq!(d.ultima("c1").as_deref(), Some("A"));
    }
}
