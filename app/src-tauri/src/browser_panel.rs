//! Janela própria do Navegador do projeto.
//!
//! O caminho do projeto não viaja na URL nem no label da janela. O backend
//! mantém o contexto efêmero e encerra o screencast quando a janela é destruída.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPanelContext {
    pub project_id: String,
    pub project_path: String,
}

#[derive(Default)]
pub struct BrowserPanelRegistry {
    contexts: Mutex<HashMap<String, BrowserPanelContext>>,
}

fn panel_label(project_id: &str) -> String {
    let hash = blake3::hash(project_id.as_bytes()).to_hex();
    format!("browser-panel-{}", &hash[..12])
}

#[tauri::command]
pub fn browser_panel_open(app: tauri::AppHandle, project_path: String) -> Result<(), String> {
    let project_id = crate::browser::project_id_of(&app, &project_path)?;
    let label = panel_label(&project_id);
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }
    app.state::<BrowserPanelRegistry>()
        .contexts
        .lock()
        .map_err(|_| "contexto do painel indisponível".to_string())?
        .insert(
            label.clone(),
            BrowserPanelContext {
                project_id,
                project_path,
            },
        );
    let built = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("browser.html".into()))
        .title("Navegador do projeto · Frota")
        .inner_size(1040.0, 720.0)
        .min_inner_size(760.0, 520.0)
        .center()
        .build();
    if let Err(error) = built {
        if let Ok(mut contexts) = app.state::<BrowserPanelRegistry>().contexts.lock() {
            contexts.remove(&label);
        }
        return Err(format!("não consegui abrir o painel do navegador: {error}"));
    }
    Ok(())
}

#[tauri::command]
pub fn browser_panel_context(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<BrowserPanelContext, String> {
    app.state::<BrowserPanelRegistry>()
        .contexts
        .lock()
        .map_err(|_| "contexto do painel indisponível".to_string())?
        .get(window.label())
        .cloned()
        .ok_or("esta janela não pertence a um painel de navegador".into())
}

pub fn close_panel(app: &tauri::AppHandle, label: &str) {
    let context = app
        .state::<BrowserPanelRegistry>()
        .contexts
        .lock()
        .ok()
        .and_then(|mut contexts| contexts.remove(label));
    if let Some(context) = context {
        app.state::<Arc<crate::browser_cdp::BrowserPreviewRegistry>>()
            .stop_project(&context.project_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_da_janela_nao_carrega_id_do_projeto() {
        let label = panel_label("/Users/alguem/projeto secreto");
        assert!(label.starts_with("browser-panel-"));
        assert!(!label.contains("Users"));
    }
}
