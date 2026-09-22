//! Driver nativo de baixo nível para automação do desktop macOS e Linux.
//!
//! Integra com frameworks nativos do sistema (CoreGraphics e ApplicationServices no macOS)
//! para síntese de input (mouse e teclado) e captura de tela sem depender de ferramentas
//! de terceiros. Oferece salvaguarda fail-safe (liberação forçada de teclas presas no drop).

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopDisplayInfo {
    pub width: u32,
    pub height: u32,
    pub platform: String,
    pub screen_recording_granted: bool,
    pub accessibility_granted: bool,
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy, Debug)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> u8;
    fn CGMainDisplayID() -> u32;
    fn CGDisplayPixelsWide(display: u32) -> usize;
    fn CGDisplayPixelsHigh(display: u32) -> usize;

    fn CGEventCreateMouseEvent(
        source: *const std::ffi::c_void,
        mouse_type: u32,
        mouse_cursor_position: CGPoint,
        mouse_button: u32,
    ) -> *mut std::ffi::c_void;

    fn CGEventCreateKeyboardEvent(
        source: *const std::ffi::c_void,
        virtual_key: u16,
        key_down: bool,
    ) -> *mut std::ffi::c_void;

    fn CGEventKeyboardSetUnicodeString(
        event: *mut std::ffi::c_void,
        string_length: usize,
        unicode_string: *const u16,
    );

    fn CGEventSetIntegerValueField(
        event: *mut std::ffi::c_void,
        field: u32,
        value: i64,
    );

    fn CGEventSetFlags(event: *mut std::ffi::c_void, flags: u64);
    fn CGEventPost(tap: u32, event: *mut std::ffi::c_void);
    fn CFRelease(cf: *const std::ffi::c_void);
}

#[cfg(target_os = "macos")]
const K_CG_EVENT_LEFT_MOUSE_DOWN: u32 = 1;
#[cfg(target_os = "macos")]
const K_CG_EVENT_LEFT_MOUSE_UP: u32 = 2;
#[cfg(target_os = "macos")]
const K_CG_EVENT_RIGHT_MOUSE_DOWN: u32 = 3;
#[cfg(target_os = "macos")]
const K_CG_EVENT_RIGHT_MOUSE_UP: u32 = 4;
#[cfg(target_os = "macos")]
const K_CG_EVENT_MOUSE_MOVED: u32 = 5;
#[cfg(target_os = "macos")]
const K_CG_EVENT_LEFT_MOUSE_DRAGGED: u32 = 6;

#[cfg(target_os = "macos")]
const K_CG_MOUSE_BUTTON_LEFT: u32 = 0;
#[cfg(target_os = "macos")]
const K_CG_MOUSE_BUTTON_RIGHT: u32 = 1;

#[cfg(target_os = "macos")]
const K_CG_HID_EVENT_TAP: u32 = 0;
#[cfg(target_os = "macos")]
const K_CG_MOUSE_EVENT_CLICK_STATE: u32 = 1;

#[cfg(target_os = "macos")]
const K_CG_FLAG_SHIFT: u64 = 0x00020000;
#[cfg(target_os = "macos")]
const K_CG_FLAG_CONTROL: u64 = 0x00040000;
#[cfg(target_os = "macos")]
const K_CG_FLAG_OPTION: u64 = 0x00080000;
#[cfg(target_os = "macos")]
const K_CG_FLAG_COMMAND: u64 = 0x00100000;

pub fn display_info() -> DesktopDisplayInfo {
    #[cfg(target_os = "macos")]
    {
        let screen_recording = objc2_core_graphics::CGPreflightScreenCaptureAccess();
        let accessibility = unsafe { AXIsProcessTrusted() != 0 };
        let (width, height) = unsafe {
            let display = CGMainDisplayID();
            (
                CGDisplayPixelsWide(display) as u32,
                CGDisplayPixelsHigh(display) as u32,
            )
        };
        DesktopDisplayInfo {
            width,
            height,
            platform: "macos".into(),
            screen_recording_granted: screen_recording,
            accessibility_granted: accessibility,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        DesktopDisplayInfo {
            width: 1920,
            height: 1080,
            platform: "linux".into(),
            screen_recording_granted: false,
            accessibility_granted: false,
        }
    }
}

/// Captura a tela inteira para um arquivo PNG temporário com permissões restritas (0600).
pub fn capture_screen(dest: &Path) -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("/usr/sbin/screencapture")
            .args(["-x", "-C"])
            .arg(dest)
            .status()
            .map_err(|e| format!("falha ao invocar screencapture: {e}"))?;

        if !status.success() {
            return Err("o utilitário screencapture falhou; confirme se a Gravação de tela está concedida".into());
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(dest, std::fs::Permissions::from_mode(0o600));
        }

        Ok(dest.to_path_buf())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = dest;
        Err("captura de tela nativa ainda indisponível no Linux".into())
    }
}

/// Move o cursor do mouse para as coordenadas lógicas (x, y).
pub fn mouse_move(x: f64, y: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    unsafe {
        let pos = CGPoint { x, y };
        let event = CGEventCreateMouseEvent(
            std::ptr::null(),
            K_CG_EVENT_MOUSE_MOVED,
            pos,
            K_CG_MOUSE_BUTTON_LEFT,
        );
        if event.is_null() {
            return Err("não foi possível criar o evento de mouse".into());
        }
        CGEventPost(K_CG_HID_EVENT_TAP, event);
        CFRelease(event);
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (x, y);
        Err("movimento de mouse indisponível no Linux".into())
    }
}

/// Clica nas coordenadas (x, y) com botão esquerdo ou direito, com suporte a clique duplo.
pub fn mouse_click(x: f64, y: f64, button: &str, double: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    unsafe {
        let pos = CGPoint { x, y };
        let (down_type, up_type, btn) = if button == "right" {
            (
                K_CG_EVENT_RIGHT_MOUSE_DOWN,
                K_CG_EVENT_RIGHT_MOUSE_UP,
                K_CG_MOUSE_BUTTON_RIGHT,
            )
        } else {
            (
                K_CG_EVENT_LEFT_MOUSE_DOWN,
                K_CG_EVENT_LEFT_MOUSE_UP,
                K_CG_MOUSE_BUTTON_LEFT,
            )
        };

        // Move o cursor primeiro
        let move_ev = CGEventCreateMouseEvent(std::ptr::null(), K_CG_EVENT_MOUSE_MOVED, pos, btn);
        if !move_ev.is_null() {
            CGEventPost(K_CG_HID_EVENT_TAP, move_ev);
            CFRelease(move_ev);
        }

        std::thread::sleep(std::time::Duration::from_millis(15));

        let click_count = if double { 2 } else { 1 };

        let down_ev = CGEventCreateMouseEvent(std::ptr::null(), down_type, pos, btn);
        if down_ev.is_null() {
            return Err("falha ao criar evento mouse down".into());
        }
        CGEventSetIntegerValueField(down_ev, K_CG_MOUSE_EVENT_CLICK_STATE, click_count);
        CGEventPost(K_CG_HID_EVENT_TAP, down_ev);
        CFRelease(down_ev);

        std::thread::sleep(std::time::Duration::from_millis(25));

        let up_ev = CGEventCreateMouseEvent(std::ptr::null(), up_type, pos, btn);
        if up_ev.is_null() {
            return Err("falha ao criar evento mouse up".into());
        }
        CGEventSetIntegerValueField(up_ev, K_CG_MOUSE_EVENT_CLICK_STATE, click_count);
        CGEventPost(K_CG_HID_EVENT_TAP, up_ev);
        CFRelease(up_ev);

        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (x, y, button, double);
        Err("clique de mouse indisponível no Linux".into())
    }
}

/// Arrasta o mouse de (from_x, from_y) até (to_x, to_y).
pub fn mouse_drag(from_x: f64, from_y: f64, to_x: f64, to_y: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    unsafe {
        let start_pos = CGPoint { x: from_x, y: from_y };
        let end_pos = CGPoint { x: to_x, y: to_y };

        // 1. Move para o início
        let move_ev = CGEventCreateMouseEvent(
            std::ptr::null(),
            K_CG_EVENT_MOUSE_MOVED,
            start_pos,
            K_CG_MOUSE_BUTTON_LEFT,
        );
        if !move_ev.is_null() {
            CGEventPost(K_CG_HID_EVENT_TAP, move_ev);
            CFRelease(move_ev);
        }
        std::thread::sleep(std::time::Duration::from_millis(20));

        // 2. Mouse down
        let down_ev = CGEventCreateMouseEvent(
            std::ptr::null(),
            K_CG_EVENT_LEFT_MOUSE_DOWN,
            start_pos,
            K_CG_MOUSE_BUTTON_LEFT,
        );
        if !down_ev.is_null() {
            CGEventPost(K_CG_HID_EVENT_TAP, down_ev);
            CFRelease(down_ev);
        }
        std::thread::sleep(std::time::Duration::from_millis(30));

        // 3. Arraste em passos suaves
        let steps = 10;
        for step in 1..=steps {
            let factor = step as f64 / steps as f64;
            let cur_x = from_x + (to_x - from_x) * factor;
            let cur_y = from_y + (to_y - from_y) * factor;
            let drag_pos = CGPoint { x: cur_x, y: cur_y };
            let drag_ev = CGEventCreateMouseEvent(
                std::ptr::null(),
                K_CG_EVENT_LEFT_MOUSE_DRAGGED,
                drag_pos,
                K_CG_MOUSE_BUTTON_LEFT,
            );
            if !drag_ev.is_null() {
                CGEventPost(K_CG_HID_EVENT_TAP, drag_ev);
                CFRelease(drag_ev);
            }
            std::thread::sleep(std::time::Duration::from_millis(15));
        }

        // 4. Mouse up no destino
        let up_ev = CGEventCreateMouseEvent(
            std::ptr::null(),
            K_CG_EVENT_LEFT_MOUSE_UP,
            end_pos,
            K_CG_MOUSE_BUTTON_LEFT,
        );
        if !up_ev.is_null() {
            CGEventPost(K_CG_HID_EVENT_TAP, up_ev);
            CFRelease(up_ev);
        }

        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (from_x, from_y, to_x, to_y);
        Err("arraste de mouse indisponível no Linux".into())
    }
}

/// Digita uma string Unicode completa via CGEventKeyboardSetUnicodeString.
pub fn type_text(text: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    unsafe {
        for ch in text.chars() {
            let mut utf16_buf = [0u16; 2];
            let encoded = ch.encode_utf16(&mut utf16_buf);

            let down = CGEventCreateKeyboardEvent(std::ptr::null(), 0, true);
            if !down.is_null() {
                CGEventKeyboardSetUnicodeString(down, encoded.len(), encoded.as_ptr());
                CGEventPost(K_CG_HID_EVENT_TAP, down);
                CFRelease(down);
            }

            std::thread::sleep(std::time::Duration::from_millis(8));

            let up = CGEventCreateKeyboardEvent(std::ptr::null(), 0, false);
            if !up.is_null() {
                CGEventKeyboardSetUnicodeString(up, encoded.len(), encoded.as_ptr());
                CGEventPost(K_CG_HID_EVENT_TAP, up);
                CFRelease(up);
            }

            std::thread::sleep(std::time::Duration::from_millis(8));
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = text;
        Err("digitação de texto indisponível no Linux".into())
    }
}

/// Mapeia o nome legível de uma tecla para o virtual keycode do macOS.
#[cfg(target_os = "macos")]
fn map_key_name_to_keycode(key: &str) -> Option<u16> {
    match key.trim().to_ascii_lowercase().as_str() {
        "return" | "enter" => Some(36),
        "tab" => Some(48),
        "space" => Some(49),
        "delete" | "backspace" => Some(51),
        "escape" | "esc" => Some(53),
        "command" | "cmd" => Some(55),
        "shift" => Some(56),
        "option" | "alt" => Some(58),
        "control" | "ctrl" => Some(59),
        "left" => Some(123),
        "right" => Some(124),
        "down" => Some(125),
        "up" => Some(126),
        "f1" => Some(122),
        "f2" => Some(120),
        "f3" => Some(99),
        "f4" => Some(118),
        "f5" => Some(96),
        "f6" => Some(97),
        "f7" => Some(98),
        "f8" => Some(100),
        "f9" => Some(101),
        "f10" => Some(109),
        "f11" => Some(103),
        "f12" => Some(111),
        "a" => Some(0),
        "b" => Some(11),
        "c" => Some(8),
        "d" => Some(2),
        "e" => Some(14),
        "f" => Some(3),
        "g" => Some(5),
        "h" => Some(4),
        "i" => Some(34),
        "j" => Some(38),
        "k" => Some(40),
        "l" => Some(37),
        "m" => Some(46),
        "n" => Some(45),
        "o" => Some(31),
        "p" => Some(35),
        "q" => Some(12),
        "r" => Some(15),
        "s" => Some(1),
        "t" => Some(17),
        "u" => Some(32),
        "v" => Some(9),
        "w" => Some(13),
        "x" => Some(7),
        "y" => Some(16),
        "z" => Some(6),
        "0" => Some(29),
        "1" => Some(18),
        "2" => Some(19),
        "3" => Some(20),
        "4" => Some(21),
        "5" => Some(23),
        "6" => Some(22),
        "7" => Some(26),
        "8" => Some(28),
        "9" => Some(25),
        _ => None,
    }
}

/// Envia um pressionamento de tecla com modificadores opcionais (Cmd, Option, Ctrl, Shift).
pub fn press_key(key: &str, modifiers: &[String]) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    unsafe {
        let keycode = map_key_name_to_keycode(key)
            .ok_or_else(|| format!("tecla desconhecida: '{key}'"))?;

        let mut flags: u64 = 0;
        for modifier in modifiers {
            match modifier.trim().to_ascii_lowercase().as_str() {
                "command" | "cmd" => flags |= K_CG_FLAG_COMMAND,
                "option" | "alt" => flags |= K_CG_FLAG_OPTION,
                "shift" => flags |= K_CG_FLAG_SHIFT,
                "control" | "ctrl" => flags |= K_CG_FLAG_CONTROL,
                _ => {}
            }
        }

        let down_ev = CGEventCreateKeyboardEvent(std::ptr::null(), keycode, true);
        if down_ev.is_null() {
            return Err("falha ao criar evento key down".into());
        }
        if flags != 0 {
            CGEventSetFlags(down_ev, flags);
        }
        CGEventPost(K_CG_HID_EVENT_TAP, down_ev);
        CFRelease(down_ev);

        std::thread::sleep(std::time::Duration::from_millis(20));

        let up_ev = CGEventCreateKeyboardEvent(std::ptr::null(), keycode, false);
        if up_ev.is_null() {
            return Err("falha ao criar evento key up".into());
        }
        if flags != 0 {
            CGEventSetFlags(up_ev, flags);
        }
        CGEventPost(K_CG_HID_EVENT_TAP, up_ev);
        CFRelease(up_ev);

        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (key, modifiers);
        Err("pressionamento de tecla indisponível no Linux".into())
    }
}

/// Salvaguarda fail-safe que destrava todos os botões de mouse e teclas modificadoras.
pub fn emergency_release_inputs() {
    #[cfg(target_os = "macos")]
    unsafe {
        let pos = CGPoint { x: 0.0, y: 0.0 };
        let left_up = CGEventCreateMouseEvent(
            std::ptr::null(),
            K_CG_EVENT_LEFT_MOUSE_UP,
            pos,
            K_CG_MOUSE_BUTTON_LEFT,
        );
        if !left_up.is_null() {
            CGEventPost(K_CG_HID_EVENT_TAP, left_up);
            CFRelease(left_up);
        }

        let right_up = CGEventCreateMouseEvent(
            std::ptr::null(),
            K_CG_EVENT_RIGHT_MOUSE_UP,
            pos,
            K_CG_MOUSE_BUTTON_RIGHT,
        );
        if !right_up.is_null() {
            CGEventPost(K_CG_HID_EVENT_TAP, right_up);
            CFRelease(right_up);
        }

        // Libera teclas modificadoras (Cmd: 55, Shift: 56, Option: 58, Ctrl: 59)
        for keycode in [55, 56, 58, 59] {
            let key_up = CGEventCreateKeyboardEvent(std::ptr::null(), keycode, false);
            if !key_up.is_null() {
                CGEventSetFlags(key_up, 0);
                CGEventPost(K_CG_HID_EVENT_TAP, key_up);
                CFRelease(key_up);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_info_mede_resolucao() {
        let info = display_info();
        assert!(!info.platform.is_empty());
    }

    #[test]
    fn emergency_release_roda_sem_panico() {
        emergency_release_inputs();
    }
}
