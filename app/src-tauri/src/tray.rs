//! Tray do macOS (e demais desktops): mantém o app vivo com a janela fechada,
//! para as automações agendadas continuarem rodando. Só o "Sair" do tray (ou
//! Cmd+Q / menu nativo) encerra de verdade.
//!
//! O menu tem 2 itens de texto desabilitados (status da frota + próxima
//! agendada) que o front atualiza via comando `set_tray_status`. Como o muda
//! não expõe "esconder item", a atualização RECONSTRÓI o menu inteiro — barato
//! (7 itens) e deixa o item de agenda sumir quando não há nada agendado.

use tauri::{
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

/// Id fixo do tray: `set_tray_status` o reencontra via `tray_by_id`.
pub const TRAY_ID: &str = "mycockpit-tray";

/// Texto default do item de status enquanto o front não reportou nada.
const DEFAULT_STATUS: &str = "○ Frota parada";

/// Normaliza o texto de status vindo do front: trim; vazio cai no default
/// (item desabilitado nunca fica em branco no menu).
fn status_text(status: &str) -> String {
    let s = status.trim();
    if s.is_empty() {
        DEFAULT_STATUS.to_string()
    } else {
        s.to_string()
    }
}

/// Texto do item "próxima agendada": `None`/vazio = item some do menu.
fn next_text(next: Option<&str>) -> Option<String> {
    let s = next?.trim();
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

/// Monta o menu completo do tray para o par (status, próxima agendada).
/// Usado tanto na criação quanto em cada atualização (rebuild total).
fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
    status: &str,
    next: Option<&str>,
) -> tauri::Result<Menu<R>> {
    let mut items: Vec<Box<dyn IsMenuItem<R>>> = Vec::with_capacity(7);
    items.push(Box::new(MenuItem::with_id(
        app,
        "tray-status",
        status_text(status),
        false, // desabilitado: é só informativo
        None::<&str>,
    )?));
    if let Some(n) = next_text(next) {
        items.push(Box::new(MenuItem::with_id(
            app,
            "tray-next",
            n,
            false,
            None::<&str>,
        )?));
    }
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "tray-open",
        "Abrir MyCockpit",
        true,
        None::<&str>,
    )?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "tray-new-task",
        "Nova tarefa",
        true,
        None::<&str>,
    )?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "tray-quit",
        "Sair",
        true,
        None::<&str>,
    )?));

    let refs: Vec<&dyn IsMenuItem<R>> = items.iter().map(|i| i.as_ref()).collect();
    Menu::with_items(app, &refs)
}

/// Mostra + foca a janela principal. No macOS, volta a activation policy para
/// Regular (reaparece no Dock/Cmd-Tab) ANTES de mostrar — o inverso do hide.
pub fn show_main_window(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Esconde a janela principal mantendo o app vivo no tray. No macOS, muda a
/// activation policy para Accessory (some do Dock/Cmd-Tab enquanto escondido).
pub fn hide_main_window(window: &tauri::Window) {
    let _ = window.hide();
    #[cfg(target_os = "macos")]
    let _ = window
        .app_handle()
        .set_activation_policy(tauri::ActivationPolicy::Accessory);
}

/// Cria o tray no setup. Ícone: TEMPLATE monocromático (icons/tray-template
/// @2x.png — glifo "horizonte" da marca, preto + alpha): o macOS pinta
/// branco/preto conforme o tema da barra, como os ícones nativos. O app icon
/// colorido ficava um bloco opaco grosseiro no meio dos templates.
pub fn create(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let menu = build_menu(app, DEFAULT_STATUS, None)?;
    let icon =
        tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template@2x.png"))?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip("MyCockpit")
        .menu(&menu)
        // clique esquerdo mostra a janela; o menu fica no clique direito.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-open" => show_main_window(app),
            "tray-new-task" => {
                show_main_window(app);
                // o front escuta e foca o composer.
                let _ = app.emit("tray://new-task", ());
            }
            // Sair de verdade: cai no RunEvent::ExitRequested do lib.rs, que
            // mata os CLIs de agent em voo antes de encerrar.
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Front → tray: reconstrói o menu com o novo status/próxima agendada.
/// Rebuild roda no main thread (exigência do AppKit para menus no macOS).
#[tauri::command]
pub fn set_tray_status(
    app: AppHandle,
    status: String,
    next_schedule: Option<String>,
) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let Some(tray) = handle.tray_by_id(TRAY_ID) else {
            log::warn!("set_tray_status: tray {TRAY_ID} não encontrado");
            return;
        };
        match build_menu(&handle, &status, next_schedule.as_deref()) {
            Ok(menu) => {
                if let Err(e) = tray.set_menu(Some(menu)) {
                    log::warn!("set_tray_status: falha ao aplicar menu: {e}");
                }
            }
            Err(e) => log::warn!("set_tray_status: falha ao montar menu: {e}"),
        }
    })
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_text_usa_default_quando_vazio() {
        assert_eq!(status_text(""), DEFAULT_STATUS);
        assert_eq!(status_text("   "), DEFAULT_STATUS);
    }

    #[test]
    fn status_text_preserva_e_apara_texto() {
        assert_eq!(status_text("● 2 agentes rodando"), "● 2 agentes rodando");
        assert_eq!(status_text("  ● ativo  "), "● ativo");
    }

    #[test]
    fn next_text_some_quando_vazio_ou_none() {
        assert_eq!(next_text(None), None);
        assert_eq!(next_text(Some("")), None);
        assert_eq!(next_text(Some("   ")), None);
    }

    #[test]
    fn next_text_preserva_e_apara_texto() {
        assert_eq!(
            next_text(Some("Próxima: hoje 14:00")),
            Some("Próxima: hoje 14:00".to_string())
        );
        assert_eq!(next_text(Some("  amanhã 09:00 ")), Some("amanhã 09:00".to_string()));
    }
}
