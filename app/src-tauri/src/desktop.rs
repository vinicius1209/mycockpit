//! Estado real das permissões necessárias para operar o desktop.
//!
//! Permissão do SO e materializador são fatos diferentes. Este módulo mede e
//! pede as permissões somente após gesto humano; enquanto a Frota não tiver um
//! controller próprio por run, `controller_available` permanece falso.

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

#[cfg(target_os = "macos")]
fn status() -> DesktopCapabilityStatus {
    let screen_recording = objc2_core_graphics::CGPreflightScreenCaptureAccess();
    let accessibility = unsafe { AXIsProcessTrusted() != 0 };
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
        controller_available: false,
        detail: if screen_recording && accessibility {
            "Permissões do macOS concedidas; a Frota ainda não entrega um controller de desktop próprio aos runs."
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
        assert!(!measured.controller_available);
        assert!(!measured.detail.is_empty());
    }
}
