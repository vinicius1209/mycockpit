//! O menu da janela no macOS: ⌘W fecha a aba de arquivo, não a janela
//! (ADR-243, decisão da pessoa em 24/09/2026).
//!
//! No menu padrão do Tauri, "Close Window" leva o ⌘W, e o macOS entrega o
//! atalho ao menu ANTES da página: um `keydown` no WebView nunca o via. Então o
//! menu troca "Close Window" por dois itens nossos: "Fechar aba" (⌘W), que só
//! avisa a tela, e "Fechar janela" (⌘⇧W), que faz o que o item antigo fazia.
//! Na Conversa, que não fecha, o ⌘W não faz nada: fechar a janela segue no
//! menu, no ⌘⇧W e no ⌘Q.
//!
//! Linux não tem menu na janela: lá o Ctrl+W chega à página como tecla, e quem
//! o trata é `components/layout/atalhosDasAbas.ts`.

use tauri::menu::MenuEvent;
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const FECHAR_ABA: &str = "frota-fechar-aba";
pub const FECHAR_JANELA: &str = "frota-fechar-janela";
/// O que a tela ouve para fechar o arquivo à vista.
pub const EVENTO_FECHAR_ABA: &str = "frota://fechar-aba";
/// O rótulo que o Tauri dá ao item predefinido que sai.
const FECHAR_JANELA_DO_TAURI: &str = "Close Window";

#[derive(Debug, PartialEq, Eq)]
pub enum Destino {
    /// Avisa a janela principal: ela fecha o arquivo à vista, se houver.
    Aba,
    /// Fecha a janela em foco, como o item padrão fazia.
    Janela,
    Nada,
}

/// Para onde vai o gesto do menu, pela janela em foco. Puro.
///
/// O ⌘W fora da janela principal (o popover da barra de menu, um painel do
/// navegador) continua fechando aquela janela: cada uma já trata o próprio
/// `CloseRequested`, e é o que o ⌘W fazia antes.
pub fn destino(item: &str, janela_em_foco: &str) -> Destino {
    match item {
        FECHAR_ABA if janela_em_foco == "main" => Destino::Aba,
        FECHAR_ABA | FECHAR_JANELA => Destino::Janela,
        _ => Destino::Nada,
    }
}

/// Troca o menu padrão pelo nosso. Falha deixa o padrão (⌘W volta a fechar
/// a janela) e fica no log; o boot segue.
pub fn instalar<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    if let Err(e) = montar(app).and_then(|menu| app.set_menu(menu).map(|_| ())) {
        log::warn!("menu da janela: fiquei com o padrão ({e})");
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(target_os = "macos")]
fn montar<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};
    let menu = Menu::default(app)?;
    let mut colocados = false;
    for item in menu.items()? {
        let MenuItemKind::Submenu(sub) = item else { continue };
        let filhos = sub.items()?;
        // De trás para a frente: remover não desloca os que faltam ver.
        let mut primeira = None;
        for (i, filho) in filhos.iter().enumerate().rev() {
            if let MenuItemKind::Predefined(p) = filho {
                if p.text()? == FECHAR_JANELA_DO_TAURI {
                    sub.remove_at(i)?;
                    primeira = Some(i);
                }
            }
        }
        // Os nossos entram no primeiro submenu que tinha o item (o "File").
        if let (Some(i), false) = (primeira, colocados) {
            let janela = MenuItem::with_id(app, FECHAR_JANELA, "Fechar janela", true, Some("CmdOrCtrl+Shift+W"))?;
            let aba = MenuItem::with_id(app, FECHAR_ABA, "Fechar aba", true, Some("CmdOrCtrl+W"))?;
            sub.insert(&janela, i)?;
            sub.insert(&aba, i)?;
            colocados = true;
        }
    }
    if !colocados {
        log::warn!("menu da janela: não achei \"{FECHAR_JANELA_DO_TAURI}\"; ⌘W segue fechando a janela");
    }
    Ok(menu)
}

/// O manipulador registrado no `Builder`. Recebe todo evento de menu do app e
/// só age nos dois itens daqui.
pub fn ao_escolher<R: Runtime>(app: &AppHandle<R>, evento: MenuEvent) {
    let item = evento.id().as_ref();
    if destino(item, "") == Destino::Nada {
        return;
    }
    let Some(janela) = app
        .webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
    else {
        return;
    };
    match destino(item, janela.label()) {
        Destino::Aba => {
            if let Err(e) = janela.emit_to(janela.label(), EVENTO_FECHAR_ABA, ()) {
                log::warn!("menu da janela: não consegui avisar a aba ({e})");
            }
        }
        Destino::Janela => {
            if let Err(e) = janela.close() {
                log::warn!("menu da janela: não consegui fechar a janela ({e})");
            }
        }
        Destino::Nada => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cmd_w_na_janela_principal_fecha_a_aba_e_nas_outras_fecha_a_janela() {
        assert_eq!(destino(FECHAR_ABA, "main"), Destino::Aba);
        assert_eq!(destino(FECHAR_ABA, "tray-popover"), Destino::Janela, "o popover recolhe como antes");
        assert_eq!(destino(FECHAR_ABA, "browser-panel-1"), Destino::Janela);
        assert_eq!(destino(FECHAR_JANELA, "main"), Destino::Janela);
    }

    #[test]
    fn itens_de_outros_menus_nao_sao_daqui() {
        assert_eq!(destino("tray-quit", "main"), Destino::Nada);
        assert_eq!(destino("", ""), Destino::Nada);
    }
}
