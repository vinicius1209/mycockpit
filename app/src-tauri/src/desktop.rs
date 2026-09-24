//! Estado real das permissões necessárias para operar o desktop.
//!
//! Permissão do SO e materializador são fatos diferentes. Este módulo mede e
//! pede as permissões somente após gesto humano; o controller próprio por run
//! (`frota-desktop`, ADR-225) é disponibilizado quando as permissões do sistema
//! estiverem concedidas.

use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsPermissionView {
    pub supported: bool,
    pub granted: bool,
    pub can_request: bool,
    pub label: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCapabilityStatus {
    pub platform: String,
    pub screen_recording: OsPermissionView,
    pub accessibility: OsPermissionView,
    pub controller_available: bool,
    pub detail: String,
}

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> u8;
}

pub fn controller_ready() -> bool {
    #[cfg(target_os = "macos")]
    {
        let screen_recording = objc2_core_graphics::CGPreflightScreenCaptureAccess();
        let accessibility = unsafe { AXIsProcessTrusted() != 0 };
        screen_recording && accessibility
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[cfg(target_os = "macos")]
fn status() -> DesktopCapabilityStatus {
    let screen_recording = objc2_core_graphics::CGPreflightScreenCaptureAccess();
    let accessibility = unsafe { AXIsProcessTrusted() != 0 };
    let controller_available = screen_recording && accessibility;
    DesktopCapabilityStatus {
        platform: "macos".into(),
        screen_recording: OsPermissionView {
            supported: true,
            granted: screen_recording,
            can_request: true,
            label: "Gravação da tela".into(),
        },
        accessibility: OsPermissionView {
            supported: true,
            granted: accessibility,
            can_request: true,
            label: "Acessibilidade".into(),
        },
        controller_available,
        detail: if controller_available {
            "Permissões do macOS concedidas; o controller de desktop da Frota está pronto para atender os runs."
        } else {
            "Permissões incompletas; nenhuma integração recebe controle do Mac por inferência."
        }
        .into(),
    }
}

#[cfg(target_os = "linux")]
fn status() -> DesktopCapabilityStatus {
    DesktopCapabilityStatus {
        platform: "linux".into(),
        screen_recording: OsPermissionView {
            supported: false,
            granted: false,
            can_request: false,
            label: "Captura via portal".into(),
        },
        accessibility: OsPermissionView {
            supported: false,
            granted: false,
            can_request: false,
            label: "Input via portal".into(),
        },
        controller_available: false,
        detail: "O broker para portais Wayland/X11 ainda não foi materializado; controle do desktop permanece bloqueado."
            .into(),
    }
}

#[tauri::command]
pub fn desktop_capability_status() -> DesktopCapabilityStatus {
    status()
}

/// Gesto da pessoa no aviso de pedido. Só vale para run que pediu e está vivo.
#[tauri::command]
pub fn desktop_grant_run(app: tauri::AppHandle, run_id: String) -> Result<(), String> {
    use tauri::Manager;
    let broker = app.state::<std::sync::Arc<crate::desktop_broker::DesktopBroker>>();
    broker.grant_run(&run_id)?;
    crate::work_gateway::emit_work(
        &app,
        "desktop_state",
        serde_json::json!({ "runId": run_id, "granted": true }),
    );
    Ok(())
}

/// Revogar vale na hora: a posse sai do run, botões e modificadores são
/// soltos, e a ação longa em curso para no próximo passo. É também o "não" a um
/// pedido ainda sem resposta (fechar o aviso, ADR-242): quem espera o gesto
/// para agora, e um novo pedido nos próximos 30 s não reabre o aviso.
#[tauri::command]
pub fn desktop_revoke_run(app: tauri::AppHandle, run_id: String) -> Result<(), String> {
    use tauri::Manager;
    let broker = app.state::<std::sync::Arc<crate::desktop_broker::DesktopBroker>>();
    broker.revoke_run(&run_id);
    broker.recusar_pedido(&run_id);
    crate::work_gateway::emit_work(
        &app,
        "desktop_state",
        serde_json::json!({ "runId": run_id, "granted": false }),
    );
    Ok(())
}

/// Um controle do computador de terceiro no cadastro de um motor.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalDesktopController {
    pub name: String,
    pub enabled: bool,
    /// Vem do cadastro global que a Frota sabe alterar pelo CLI do motor.
    pub manageable: bool,
}

/// Controles do computador de terceiro que entram nos runs deste motor sem
/// passar pela Frota (ADR-225). Leitura de cache e registry, sem subprocesso:
/// a tela chama depois de reverificar o cadastro do motor.
#[tauri::command]
pub fn desktop_external_controllers(
    app: tauri::AppHandle,
    agent: String,
) -> Vec<ExternalDesktopController> {
    use crate::resource_broker::ResourceKind;
    let manageable = crate::work_mcp_setup::supports(&agent);
    let mut vistos: Vec<ExternalDesktopController> =
        crate::provider_mcp_inventory::externos_vistos_em_cache(&agent, ResourceKind::DesktopControl)
            .into_iter()
            .map(|(name, enabled)| ExternalDesktopController { name, enabled, manageable })
            .collect();
    for name in crate::mcp_control::externos_do_motor(&app, &agent, ResourceKind::DesktopControl) {
        if !vistos.iter().any(|v| v.name == name) {
            vistos.push(ExternalDesktopController { name, enabled: true, manageable: false });
        }
    }
    vistos.sort_by(|a, b| a.name.cmp(&b.name));
    vistos
}

#[tauri::command]
pub fn desktop_pilot_status(
    app: tauri::AppHandle,
) -> Result<crate::desktop_broker::DesktopPilotView, String> {
    use tauri::Manager;
    let broker = app.state::<std::sync::Arc<crate::desktop_broker::DesktopBroker>>();
    Ok(broker.status())
}

#[cfg(target_os = "macos")]
fn open_privacy_pane(kind: &str) -> Result<(), String> {
    let pane = match kind {
        "screen-recording" => "Privacy_ScreenCapture",
        "accessibility" => "Privacy_Accessibility",
        _ => return Err("permissão de desktop desconhecida".into()),
    };
    let result = std::process::Command::new("open")
        .arg(format!(
            "x-apple.systempreferences:com.apple.preference.security?{pane}"
        ))
        .status()
        .map_err(|error| format!("não consegui abrir Ajustes do Sistema: {error}"))?;
    if result.success() {
        Ok(())
    } else {
        Err("Ajustes do Sistema recusou a abertura da área de privacidade".into())
    }
}

#[tauri::command]
pub fn desktop_permission_request(kind: String) -> Result<DesktopCapabilityStatus, String> {
    #[cfg(target_os = "macos")]
    {
        match kind.as_str() {
            "screen-recording" => {
                if !objc2_core_graphics::CGRequestScreenCaptureAccess() {
                    open_privacy_pane(&kind)?;
                }
            }
            "accessibility" => open_privacy_pane(&kind)?,
            _ => return Err("permissão de desktop desconhecida".into()),
        }
        Ok(status())
    }
    #[cfg(target_os = "linux")]
    {
        let _ = kind;
        Err("o broker de permissões do desktop ainda não está disponível no Linux".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permissao_nao_finge_controller_materializado() {
        let measured = status();
        if !measured.screen_recording.granted || !measured.accessibility.granted {
            assert!(!measured.controller_available);
        }
        assert!(!measured.detail.is_empty());
    }

    #[test]
    fn permissao_mede_estado_real_das_capacidades() {
        let measured = status();
        assert_eq!(
            measured.controller_available,
            measured.screen_recording.granted && measured.accessibility.granted
        );
    }
}
