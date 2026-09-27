//! Os eventos de janela do app, fora do `lib.rs` (que está no teto congelado
//! da ADR-232). O conteúdo é o mesmo fecho que morava no `Builder`.

use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri_plugin_decorum::WebviewWindowExt;

use crate::{browser_panel, hud, quit, tray};

/// Fechar a janela = esconder (app segue vivo no tray). Cmd+Q / "Sair" do tray
/// NÃO passam por aqui (viram ExitRequested) e encerram normal.
pub(crate) fn ao_evento(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() == "main" {
        // Reaplica o inset dos semáforos DEPOIS do decorum (que reseta
        // pra y=16 no resize dele): resize/move/foco durante o boot ou
        // pelo usuário reposicionavam os botões pro topo, desalinhando.
        #[cfg(target_os = "macos")]
        if matches!(
            event,
            tauri::WindowEvent::Resized(_)
                | tauri::WindowEvent::Moved(_)
                | tauri::WindowEvent::Focused(true)
        ) {
            if let Some(w) = window.app_handle().get_webview_window("main") {
                let _ = w.set_traffic_lights_inset(18.0, crate::TRAFFIC_LIGHTS_Y);
            }
        }
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if tray::should_keep_in_tray(window.app_handle()) {
                if let Err(error) = tray::hide_main_window(window) {
                    log::warn!("não consegui manter a janela em background: {error}");
                }
                tray::notify_window_hidden(window.app_handle());
            } else {
                quit::request_quit(window.app_handle(), quit::QuitOrigin::CloseWindow);
            }
        }
    } else if window.label() == tray::POPOVER_LABEL {
        match event {
            tauri::WindowEvent::Focused(false) => {
                tray::mark_popover_blur_hidden(window.app_handle());
                hud::collapse_after_blur(window.app_handle());
            }
            // Cmd+W (menu padrão do macOS) DESTRUIRIA o webview e o
            // popover nunca é recriado (create só roda no setup).
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                hud::collapse_after_blur(window.app_handle());
            }
            _ => {}
        }
    } else if window.label().starts_with("browser-panel-") {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            browser_panel::close_panel(window.app_handle(), window.label());
        }
    }
}
