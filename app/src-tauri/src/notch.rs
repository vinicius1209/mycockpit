//! Geometria de telas para o instrumento flutuante.
//!
//! No macOS, a fonte de verdade é `NSScreen`: safe area e áreas auxiliares
//! dizem se existe um recorte físico. Resolução nunca é usada como heurística.
//! Nos demais sistemas, o Tauri fornece somente os retângulos dos monitores e
//! o contrato degrada explicitamente para uma tela sem notch.

use serde::{Deserialize, Serialize};

#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(target_os = "macos")]
static PRIMARY_TOP_BITS: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenGeometry {
    pub id: String,
    pub name: String,
    pub has_notch: bool,
    pub notch_width: f64,
    pub notch_height: f64,
    pub screen_width: f64,
    pub screen_height: f64,
    pub origin_x: f64,
    pub origin_y: f64,
    pub visible_x: f64,
    pub visible_y: f64,
    pub visible_width: f64,
    pub visible_height: f64,
    pub scale_factor: f64,
    pub safe_top: f64,
    pub active: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum HudPosition {
    Notch,
    Island,
    Left,
    Right,
    Bottom,
    Menubar,
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DesktopPoint {
    pub x: f64,
    pub y: f64,
}

impl Default for HudPosition {
    fn default() -> Self {
        Self::Menubar
    }
}

#[derive(Debug, Clone)]
struct NativeScreenSample {
    id: String,
    name: String,
    frame_x: f64,
    frame_y: f64,
    frame_width: f64,
    frame_height: f64,
    visible_x: f64,
    visible_y: f64,
    visible_width: f64,
    visible_height: f64,
    scale: f64,
    safe_top: f64,
    aux_left_max_x: Option<f64>,
    aux_right_min_x: Option<f64>,
    primary: bool,
    active: bool,
}

fn contains(sample: &NativeScreenSample, x: f64, y: f64) -> bool {
    x >= sample.frame_x
        && x < sample.frame_x + sample.frame_width
        && y >= sample.frame_y
        && y < sample.frame_y + sample.frame_height
}

fn calculate_screen_geometry(sample: NativeScreenSample, primary_top: f64) -> ScreenGeometry {
    let measured_gap = sample
        .aux_left_max_x
        .zip(sample.aux_right_min_x)
        .map(|(left, right)| right - left)
        .filter(|gap| *gap > 0.0 && *gap < sample.frame_width);
    let has_notch = sample.safe_top > 0.0 && measured_gap.is_some();
    ScreenGeometry {
        id: sample.id,
        name: sample.name,
        has_notch,
        notch_width: measured_gap.filter(|_| has_notch).unwrap_or(0.0),
        notch_height: if has_notch { sample.safe_top } else { 0.0 },
        screen_width: sample.frame_width,
        screen_height: sample.frame_height,
        origin_x: sample.frame_x,
        // AppKit mede Y de baixo para cima a partir da tela principal. Tao,
        // usado pelo Tauri, mede a partir do topo dessa mesma tela. Usar o
        // topo de todo o desktop deslocaria a principal se houvesse uma tela
        // acima dela.
        origin_y: primary_top - (sample.frame_y + sample.frame_height),
        visible_x: sample.visible_x,
        visible_y: primary_top - (sample.visible_y + sample.visible_height),
        visible_width: sample.visible_width,
        visible_height: sample.visible_height,
        scale_factor: sample.scale,
        safe_top: if has_notch { sample.safe_top } else { 0.0 },
        active: sample.active,
    }
}

fn geometries_from_samples(mut samples: Vec<NativeScreenSample>) -> Vec<ScreenGeometry> {
    if samples.is_empty() {
        return Vec::new();
    }
    if !samples.iter().any(|screen| screen.active) {
        samples[0].active = true;
    }
    let primary_top = samples
        .iter()
        .find(|screen| screen.primary)
        .or_else(|| samples.first())
        .map(|screen| screen.frame_y + screen.frame_height)
        .unwrap_or(0.0);
    #[cfg(target_os = "macos")]
    PRIMARY_TOP_BITS.store(primary_top.to_bits(), Ordering::Relaxed);
    samples
        .into_iter()
        .map(|sample| calculate_screen_geometry(sample, primary_top))
        .collect()
}

#[cfg(target_os = "macos")]
fn desktop_point_from_appkit(x: f64, y: f64, primary_top: f64) -> DesktopPoint {
    DesktopPoint {
        x,
        y: primary_top - y,
    }
}

#[cfg(target_os = "macos")]
fn native_samples() -> Result<Vec<NativeScreenSample>, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSEvent, NSScreen};

    let mtm = MainThreadMarker::new().ok_or("geometria de tela exige a thread principal")?;
    let cursor = NSEvent::mouseLocation();
    // A conversão de coordenadas do Tao usa o CGMainDisplayID, não a
    // `mainScreen` do AppKit (que pode mudar para a tela da janela com foco).
    let primary_id = objc2_core_graphics::CGMainDisplayID();
    let screens = NSScreen::screens(mtm);
    Ok(screens
        .iter()
        .map(|screen| {
            let frame = screen.frame();
            let visible = screen.visibleFrame();
            let safe = screen.safeAreaInsets();
            let left = screen.auxiliaryTopLeftArea();
            let right = screen.auxiliaryTopRightArea();
            let probe = NativeScreenSample {
                id: String::new(),
                name: String::new(),
                frame_x: frame.origin.x,
                frame_y: frame.origin.y,
                frame_width: frame.size.width,
                frame_height: frame.size.height,
                visible_x: 0.0,
                visible_y: 0.0,
                visible_width: 0.0,
                visible_height: 0.0,
                scale: 1.0,
                safe_top: 0.0,
                aux_left_max_x: None,
                aux_right_min_x: None,
                primary: false,
                active: false,
            };
            NativeScreenSample {
                id: screen.CGDirectDisplayID().to_string(),
                name: screen.localizedName().to_string(),
                frame_x: frame.origin.x,
                frame_y: frame.origin.y,
                frame_width: frame.size.width,
                frame_height: frame.size.height,
                visible_x: visible.origin.x,
                visible_y: visible.origin.y,
                visible_width: visible.size.width,
                visible_height: visible.size.height,
                scale: screen.backingScaleFactor(),
                safe_top: safe.top,
                aux_left_max_x: (left.size.width > 0.0).then_some(left.origin.x + left.size.width),
                aux_right_min_x: (right.size.width > 0.0).then_some(right.origin.x),
                primary: primary_id == screen.CGDirectDisplayID(),
                active: contains(&probe, cursor.x, cursor.y),
            }
        })
        .collect())
}

#[cfg(target_os = "macos")]
async fn platform_geometries(app: &tauri::AppHandle) -> Result<Vec<ScreenGeometry>, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = send.send(native_samples().map(geometries_from_samples));
    })
    .map_err(|error| error.to_string())?;
    receive
        .await
        .map_err(|_| "a leitura de telas foi interrompida".to_string())?
}

/// Posição global do ponteiro no mesmo espaço lógico usado por `ScreenGeometry`.
///
/// A altura da tela principal é atualizada junto da geometria, então a leitura
/// frequente do hover consulta somente `NSEvent`, sem enumerar monitores.
#[cfg(target_os = "macos")]
pub async fn cursor_position(app: &tauri::AppHandle) -> Result<DesktopPoint, String> {
    use objc2_app_kit::NSEvent;

    let primary_top = f64::from_bits(PRIMARY_TOP_BITS.load(Ordering::Relaxed));
    if primary_top <= 0.0 {
        return Err("referência da tela principal indisponível".to_string());
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let cursor = NSEvent::mouseLocation();
        let _ = send.send(desktop_point_from_appkit(cursor.x, cursor.y, primary_top));
    })
    .map_err(|error| error.to_string())?;
    receive
        .await
        .map_err(|_| "a leitura do ponteiro foi interrompida".to_string())
}

#[cfg(not(target_os = "macos"))]
async fn platform_geometries(app: &tauri::AppHandle) -> Result<Vec<ScreenGeometry>, String> {
    let cursor = app.cursor_position().ok();
    let monitors = app
        .available_monitors()
        .map_err(|error| error.to_string())?;
    Ok(monitors
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| {
            let scale = monitor.scale_factor();
            let position = monitor.position().to_logical::<f64>(scale);
            let size = monitor.size().to_logical::<f64>(scale);
            let work = monitor.work_area();
            let work_position = work.position.to_logical::<f64>(scale);
            let work_size = work.size.to_logical::<f64>(scale);
            let active = cursor.as_ref().is_some_and(|point| {
                point.x >= monitor.position().x as f64
                    && point.x < (monitor.position().x + monitor.size().width as i32) as f64
                    && point.y >= monitor.position().y as f64
                    && point.y < (monitor.position().y + monitor.size().height as i32) as f64
            });
            ScreenGeometry {
                id: format!("display-{index}"),
                name: monitor
                    .name()
                    .cloned()
                    .unwrap_or_else(|| format!("Tela {}", index + 1)),
                has_notch: false,
                notch_width: 0.0,
                notch_height: 0.0,
                screen_width: size.width,
                screen_height: size.height,
                origin_x: position.x,
                origin_y: position.y,
                visible_x: work_position.x,
                visible_y: work_position.y,
                visible_width: work_size.width,
                visible_height: work_size.height,
                scale_factor: scale,
                safe_top: 0.0,
                active,
            }
        })
        .collect())
}

pub async fn screen_geometries(app: &tauri::AppHandle) -> Result<Vec<ScreenGeometry>, String> {
    platform_geometries(app).await
}

#[tauri::command]
pub async fn get_screen_geometries(app: tauri::AppHandle) -> Result<Vec<ScreenGeometry>, String> {
    screen_geometries(&app).await
}

#[tauri::command]
pub async fn get_notch_geometry(app: tauri::AppHandle) -> Result<ScreenGeometry, String> {
    let screens = screen_geometries(&app).await?;
    screens
        .iter()
        .find(|screen| screen.active)
        .or_else(|| screens.first())
        .cloned()
        .ok_or_else(|| "nenhuma tela disponível".to_string())
}

#[cfg(target_os = "macos")]
pub fn install_screen_observer(app: &tauri::AppHandle) -> Result<(), String> {
    use block2::RcBlock;
    use objc2_app_kit::NSApplicationDidChangeScreenParametersNotification;
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSOperationQueue};
    use std::ptr::NonNull;

    let handle = app.clone();
    app.run_on_main_thread(move || {
        let callback = RcBlock::new(move |_notification: NonNull<NSNotification>| {
            let app = handle.clone();
            crate::hud::screen_parameters_changed(app);
        });
        let center = NSNotificationCenter::defaultCenter();
        let queue = NSOperationQueue::mainQueue();
        // O notification center mantém o token até o fim do app. Vazar a nossa
        // retenção evita que uma futura mudança de ownership da binding remova
        // o observer silenciosamente; o processo é o lifecycle correto aqui.
        let observer = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(NSApplicationDidChangeScreenParametersNotification),
                None,
                Some(&queue),
                &callback,
            )
        };
        std::mem::forget(observer);
    })
    .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn install_screen_observer(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tela_real_do_macbook() -> NativeScreenSample {
        // NSScreen real coletado nesta máquina em 30/08/2026:
        // frame 1512x982, safe top 32, aux esquerda até x=663 e direita em 848.
        NativeScreenSample {
            id: "1".into(),
            name: "Built-in Retina Display".into(),
            frame_x: 0.0,
            frame_y: 0.0,
            frame_width: 1512.0,
            frame_height: 982.0,
            visible_x: 0.0,
            visible_y: 0.0,
            visible_width: 1512.0,
            visible_height: 949.0,
            scale: 2.0,
            safe_top: 32.0,
            aux_left_max_x: Some(663.0),
            aux_right_min_x: Some(848.0),
            primary: true,
            active: true,
        }
    }

    #[test]
    fn mede_o_notch_pelas_areas_auxiliares_reais() {
        let geometry = geometries_from_samples(vec![tela_real_do_macbook()]);
        assert_eq!(geometry[0].notch_width, 185.0);
        assert_eq!(geometry[0].notch_height, 32.0);
        assert!(geometry[0].has_notch);
        assert!(geometry[0].active);
    }

    #[test]
    fn safe_area_sem_areas_auxiliares_nao_inventa_notch() {
        let mut sample = tela_real_do_macbook();
        sample.aux_left_max_x = None;
        sample.aux_right_min_x = None;
        let geometry = geometries_from_samples(vec![sample]);
        assert!(!geometry[0].has_notch);
        assert_eq!(geometry[0].notch_width, 0.0);
    }

    #[test]
    fn converte_coordenadas_appkit_a_partir_do_topo_da_tela_principal() {
        let mut principal = tela_real_do_macbook();
        principal.active = false;
        let mut acima = tela_real_do_macbook();
        acima.id = "2".into();
        acima.frame_y = 982.0;
        acima.primary = false;
        acima.active = true;
        let geometry = geometries_from_samples(vec![principal, acima]);
        assert_eq!(geometry[0].origin_y, 0.0);
        assert_eq!(geometry[1].origin_y, -982.0);
        assert!(geometry[1].active);
    }
}
