//! Presenter nativo do instrumento da barra de menus.
//!
//! Preferência, geometria efetiva e janela vivem no backend porque tamanho e
//! hit-testing não podem depender apenas do DOM. O frontend pede uma intenção;
//! este módulo mede a tela, aplica o fallback e só então publica o estado.

use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::sync::atomic::Ordering;
use std::sync::{atomic::AtomicBool, Mutex};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

#[cfg(not(target_os = "macos"))]
use tauri::{LogicalPosition, LogicalSize};

use crate::notch::{HudPosition, ScreenGeometry};

const COMPACT_ISLAND_WIDTH: f64 = 300.0;
const COMPACT_HEIGHT: f64 = 36.0;
const NOTCH_HORIZONTAL_REVEAL: f64 = 64.0;
const EDGE_WIDTH: f64 = 28.0;
const EDGE_HEIGHT: f64 = 128.0;
const EXPANDED_WIDTH: f64 = 540.0;
const EXPANDED_HEIGHT: f64 = 320.0;
const SCREEN_MARGIN: f64 = 8.0;
#[cfg(target_os = "macos")]
const HOVER_DWELL_MS: u64 = 90;
#[cfg(target_os = "macos")]
const HOVER_POLL_MS: u64 = 50;
#[cfg(target_os = "macos")]
const HOVER_IDLE_MS: u64 = 300;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HudPreferences {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub position: HudPosition,
    #[serde(default = "default_true")]
    pub hover_expand: bool,
    #[serde(default = "default_true")]
    pub follow_active_screen: bool,
}

fn default_true() -> bool {
    true
}

impl Default for HudPreferences {
    fn default() -> Self {
        Self {
            enabled: false,
            position: HudPosition::Notch,
            hover_expand: true,
            follow_active_screen: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HudRuntimeView {
    pub enabled: bool,
    pub requested_position: HudPosition,
    pub effective_position: HudPosition,
    pub hover_expand: bool,
    pub follow_active_screen: bool,
    pub expanded: bool,
    pub screen: Option<ScreenGeometry>,
    pub fallback_reason: Option<String>,
    pub supported_positions: Vec<HudPosition>,
}

impl Default for HudRuntimeView {
    fn default() -> Self {
        Self {
            enabled: false,
            requested_position: HudPosition::Notch,
            effective_position: HudPosition::Menubar,
            hover_expand: true,
            follow_active_screen: true,
            expanded: false,
            screen: None,
            fallback_reason: None,
            supported_positions: supported_positions(),
        }
    }
}

#[derive(Default)]
pub struct HudState {
    preferences: Mutex<HudPreferences>,
    runtime: Mutex<HudRuntimeView>,
    screen_changes: Mutex<ScreenChangeQueue>,
    hover_worker_started: AtomicBool,
}

#[derive(Default)]
struct ScreenChangeQueue {
    generation: u64,
    worker_running: bool,
}

impl ScreenChangeQueue {
    /// `true` significa que esta chamada deve criar o único worker.
    fn request(&mut self) -> bool {
        self.generation = self.generation.wrapping_add(1);
        if self.worker_running {
            false
        } else {
            self.worker_running = true;
            true
        }
    }

    fn current_generation(&self) -> u64 {
        self.generation
    }

    /// `true` pede outra passada porque uma notificação chegou durante o
    /// recálculo. Caso contrário, libera a criação do próximo worker.
    fn finish_pass(&mut self, processed_generation: u64) -> bool {
        if self.generation == processed_generation {
            self.worker_running = false;
            false
        } else {
            true
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct HudLayout {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct HoverTracker {
    initialized: bool,
    inside_last: bool,
    entered_at_ms: Option<u64>,
}

#[cfg(target_os = "macos")]
impl HoverTracker {
    fn observe(&mut self, active: bool, inside: bool, now_ms: u64) -> bool {
        if !active {
            *self = Self::default();
            return false;
        }
        if !self.initialized {
            self.initialized = true;
            self.inside_last = inside;
            return false;
        }
        if !inside {
            self.inside_last = false;
            self.entered_at_ms = None;
            return false;
        }
        if !self.inside_last {
            self.inside_last = true;
            self.entered_at_ms = Some(now_ms);
            return false;
        }
        let ready = self
            .entered_at_ms
            .is_some_and(|entered| now_ms.saturating_sub(entered) >= HOVER_DWELL_MS);
        if ready {
            self.entered_at_ms = None;
        }
        ready
    }
}

fn supported_positions() -> Vec<HudPosition> {
    vec![
        HudPosition::Notch,
        HudPosition::Island,
        HudPosition::Left,
        HudPosition::Right,
        HudPosition::Bottom,
        HudPosition::Menubar,
    ]
}

fn pick_screen(screens: &[ScreenGeometry], follow_active_screen: bool) -> Option<ScreenGeometry> {
    if follow_active_screen {
        screens
            .iter()
            .find(|screen| screen.active)
            .or_else(|| screens.first())
            .cloned()
    } else {
        screens.first().cloned()
    }
}

fn resolve_position(
    preferences: &HudPreferences,
    screen: Option<&ScreenGeometry>,
) -> (HudPosition, Option<String>) {
    if !preferences.enabled || preferences.position == HudPosition::Menubar {
        return (HudPosition::Menubar, None);
    }
    if preferences.position == HudPosition::Notch
        && !screen.is_some_and(|geometry| geometry.has_notch)
    {
        return (
            HudPosition::Island,
            Some("Esta tela não informou um notch físico; usando Ilha no topo.".into()),
        );
    }
    (preferences.position, None)
}

fn clamp_size(wanted: f64, available: f64) -> f64 {
    wanted.min((available - SCREEN_MARGIN * 2.0).max(160.0))
}

fn layout_for(screen: &ScreenGeometry, position: HudPosition, expanded: bool) -> Option<HudLayout> {
    if position == HudPosition::Menubar {
        return None;
    }
    let width = if expanded {
        clamp_size(EXPANDED_WIDTH, screen.visible_width)
    } else {
        match position {
            // O recorte cobre a parte central da janela. Os 64 pontos extras
            // deixam uma faixa útil ao redor sem transformar o compacto num
            // popover solto.
            HudPosition::Notch => (screen.notch_width + NOTCH_HORIZONTAL_REVEAL).max(240.0),
            HudPosition::Island | HudPosition::Bottom => {
                clamp_size(COMPACT_ISLAND_WIDTH, screen.visible_width)
            }
            HudPosition::Left | HudPosition::Right => EDGE_WIDTH,
            HudPosition::Menubar => unreachable!(),
        }
    };
    let height = if expanded {
        clamp_size(EXPANDED_HEIGHT, screen.visible_height)
    } else {
        match position {
            // O compacto ocupa a própria faixa do recorte. Somar outra linha
            // abaixo faria o hardware parecer duas vezes mais alto.
            HudPosition::Notch => screen.safe_top.max(28.0),
            HudPosition::Left | HudPosition::Right => EDGE_HEIGHT,
            _ => COMPACT_HEIGHT,
        }
    };
    let visible_right = screen.visible_x + screen.visible_width;
    let visible_bottom = screen.visible_y + screen.visible_height;
    let (x, y) = match position {
        HudPosition::Notch => (
            screen.origin_x + (screen.screen_width - width) / 2.0,
            screen.origin_y,
        ),
        HudPosition::Island => (
            screen.visible_x + (screen.visible_width - width) / 2.0,
            screen.visible_y + SCREEN_MARGIN,
        ),
        HudPosition::Left => (
            screen.visible_x,
            screen.visible_y + (screen.visible_height - height) / 2.0,
        ),
        HudPosition::Right => (
            visible_right - width,
            screen.visible_y + (screen.visible_height - height) / 2.0,
        ),
        HudPosition::Bottom => (
            screen.visible_x + (screen.visible_width - width) / 2.0,
            visible_bottom - height - SCREEN_MARGIN,
        ),
        HudPosition::Menubar => unreachable!(),
    };
    Some(HudLayout {
        x,
        y,
        width,
        height,
    })
}

#[cfg(target_os = "macos")]
fn contains_point(layout: HudLayout, point: crate::notch::DesktopPoint) -> bool {
    point.x >= layout.x
        && point.x < layout.x + layout.width
        && point.y >= layout.y
        && point.y < layout.y + layout.height
}

#[cfg(target_os = "macos")]
fn configure_native_layer(window: &WebviewWindow, floating: bool) -> Result<(), String> {
    use objc2_app_kit::{
        NSFloatingWindowLevel, NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior,
    };

    window
        .with_webview(move |webview| unsafe {
            let native: &NSWindow = &*webview.ns_window().cast();
            native.setLevel(if floating {
                NSStatusWindowLevel
            } else {
                NSFloatingWindowLevel
            });
            native.setCollectionBehavior(
                NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::Stationary
                    | NSWindowCollectionBehavior::IgnoresCycle
                    | NSWindowCollectionBehavior::FullScreenAuxiliary,
            );
            native.setHidesOnDeactivate(false);
            native.setMovable(false);
            native.setMovableByWindowBackground(false);
            // Mantém eventos locais disponíveis para o frontend expandido. O
            // compacto não depende deles: o worker nativo acompanha o frame.
            native.setAcceptsMouseMovedEvents(true);
            native.setIgnoresMouseEvents(false);
            native.setHasShadow(!floating);
        })
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn configure_native_layer(_window: &WebviewWindow, _floating: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn apply_layout(window: &WebviewWindow, layout: HudLayout, animate: bool) -> Result<(), String> {
    use objc2_app_kit::NSWindow;
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let current_top_left = window
        .outer_position()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    window
        .with_webview(move |webview| unsafe {
            let native: &NSWindow = &*webview.ns_window().cast();
            let current = native.frame();
            let target_top =
                current.origin.y + current.size.height - (layout.y - current_top_left.y);
            let target = NSRect::new(
                NSPoint::new(
                    current.origin.x + (layout.x - current_top_left.x),
                    target_top - layout.height,
                ),
                NSSize::new(layout.width, layout.height),
            );
            native.setFrame_display_animate(target, true, animate);
        })
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn apply_layout(window: &WebviewWindow, layout: HudLayout, _animate: bool) -> Result<(), String> {
    window
        .set_size(LogicalSize::new(layout.width, layout.height))
        .map_err(|error| error.to_string())?;
    window
        .set_position(LogicalPosition::new(layout.x, layout.y))
        .map_err(|error| error.to_string())
}

fn apply_window(app: &AppHandle, runtime: &HudRuntimeView) -> Result<(), String> {
    let window = app
        .get_webview_window(crate::tray::POPOVER_LABEL)
        .ok_or("janela do instrumento indisponível")?;
    let floating = runtime.enabled && runtime.effective_position != HudPosition::Menubar;
    configure_native_layer(&window, floating)?;
    window
        .set_shadow(!floating)
        .map_err(|error| error.to_string())?;
    if !floating {
        window
            .set_focusable(true)
            .map_err(|error| error.to_string())?;
        window.hide().map_err(|error| error.to_string())?;
        crate::tray::set_icon_visible(app, true);
        return Ok(());
    }
    let screen = runtime.screen.as_ref().ok_or("nenhuma tela disponível")?;
    let layout = layout_for(screen, runtime.effective_position, runtime.expanded)
        .ok_or("posição do HUD sem layout")?;
    let was_focused = window.is_focused().unwrap_or(false);
    if !runtime.expanded && was_focused {
        // No macOS, uma janela já focada não deixa de ser focável sem sair do
        // key loop. Esconder antes evita roubar teclado quando volta compacta.
        let _ = window.hide();
    }
    apply_layout(&window, layout, window.is_visible().unwrap_or(false))?;
    window
        .set_focusable(runtime.expanded)
        .map_err(|error| error.to_string())?;
    crate::tray::ensure_vibrancy(app, &window);
    window.show().map_err(|error| error.to_string())?;
    crate::tray::set_icon_visible(app, false);
    Ok(())
}

async fn recompute(app: &AppHandle, expanded: Option<bool>) -> Result<HudRuntimeView, String> {
    let state = app.state::<HudState>();
    let preferences = state
        .preferences
        .lock()
        .map_err(|_| "preferências do HUD indisponíveis".to_string())?
        .clone();
    let screens = crate::notch::screen_geometries(app).await?;
    let screen = pick_screen(&screens, preferences.follow_active_screen);
    let (effective_position, fallback_reason) = resolve_position(&preferences, screen.as_ref());
    let current_expanded = state
        .runtime
        .lock()
        .ok()
        .map(|runtime| runtime.expanded)
        .unwrap_or(false);
    let runtime = HudRuntimeView {
        enabled: preferences.enabled,
        requested_position: preferences.position,
        effective_position,
        hover_expand: preferences.hover_expand,
        follow_active_screen: preferences.follow_active_screen,
        expanded: expanded.unwrap_or(current_expanded)
            && effective_position != HudPosition::Menubar,
        screen,
        fallback_reason,
        supported_positions: supported_positions(),
    };
    apply_window(app, &runtime)?;
    if let Ok(mut stored) = state.runtime.lock() {
        *stored = runtime.clone();
    }
    let _ = app.emit_to(crate::tray::POPOVER_LABEL, "hud://state", &runtime);
    let _ = app.emit("hud://state", &runtime);
    Ok(runtime)
}

#[cfg(target_os = "macos")]
fn install_hover_observer(app: &AppHandle) {
    let state = app.state::<HudState>();
    if state
        .hover_worker_started
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let started = std::time::Instant::now();
        let mut tracker = HoverTracker::default();
        loop {
            let runtime = handle
                .state::<HudState>()
                .runtime
                .lock()
                .ok()
                .map(|runtime| runtime.clone())
                .unwrap_or_default();
            let active = runtime.enabled
                && runtime.effective_position != HudPosition::Menubar
                && runtime.hover_expand
                && !runtime.expanded;
            if !active {
                tracker.observe(false, false, 0);
                tokio::time::sleep(std::time::Duration::from_millis(HOVER_IDLE_MS)).await;
                continue;
            }
            let inside = match runtime
                .screen
                .as_ref()
                .and_then(|screen| layout_for(screen, runtime.effective_position, false))
            {
                Some(layout) => crate::notch::cursor_position(&handle)
                    .await
                    .map(|point| contains_point(layout, point))
                    .unwrap_or(false),
                None => false,
            };
            let now_ms = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
            if tracker.observe(true, inside, now_ms) {
                if let Err(error) = recompute(&handle, Some(true)).await {
                    log::warn!("não consegui expandir o HUD ao apontar: {error}");
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(HOVER_POLL_MS)).await;
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn install_hover_observer(_app: &AppHandle) {}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    // Preferência persiste na fonte única de settings do frontend. O backend
    // nasce desligado (sem flash/surpresa) e recebe a intenção após a hidratação.
    crate::notch::install_screen_observer(app)?;
    install_hover_observer(app);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = recompute(&handle, Some(false)).await {
            log::warn!("HUD indisponível no boot: {error}");
        }
    });
    Ok(())
}

pub fn screen_parameters_changed(app: AppHandle) {
    let should_spawn = app
        .state::<HudState>()
        .screen_changes
        .lock()
        .map(|mut queue| queue.request())
        .unwrap_or(false);
    if !should_spawn {
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            // AppKit publica rajadas durante hotplug, rotação e mudança de DPI.
            // Uma janela curta agrega a rajada sem atrasar um gesto perceptível.
            tokio::time::sleep(std::time::Duration::from_millis(75)).await;
            let generation = app
                .state::<HudState>()
                .screen_changes
                .lock()
                .map(|queue| queue.current_generation())
                .unwrap_or_default();
            if let Err(error) = recompute(&app, None).await {
                log::warn!("não consegui reposicionar o HUD após mudança de tela: {error}");
            }
            let repeat = app
                .state::<HudState>()
                .screen_changes
                .lock()
                .map(|mut queue| queue.finish_pass(generation))
                .unwrap_or(false);
            if !repeat {
                break;
            }
        }
    });
}

pub fn is_floating(app: &AppHandle) -> bool {
    app.state::<HudState>()
        .runtime
        .lock()
        .ok()
        .is_some_and(|runtime| {
            runtime.enabled && runtime.effective_position != HudPosition::Menubar
        })
}

pub fn collapse_after_blur(app: &AppHandle) {
    if !is_floating(app) {
        if let Some(window) = app.get_webview_window(crate::tray::POPOVER_LABEL) {
            let _ = window.hide();
        }
        return;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = recompute(&handle, Some(false)).await;
    });
}

pub fn toggle_from_tray(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let current = handle
            .state::<HudState>()
            .runtime
            .lock()
            .ok()
            .map(|runtime| runtime.expanded)
            .unwrap_or(false);
        if let Ok(runtime) = recompute(&handle, Some(!current)).await {
            if runtime.expanded {
                if let Some(window) = handle.get_webview_window(crate::tray::POPOVER_LABEL) {
                    let _ = window.set_focus();
                }
            }
        }
    });
}

#[tauri::command]
pub fn hud_status(app: AppHandle) -> Result<HudRuntimeView, String> {
    app.state::<HudState>()
        .runtime
        .lock()
        .map(|runtime| runtime.clone())
        .map_err(|_| "estado do HUD indisponível".to_string())
}

#[tauri::command]
pub async fn set_hud_preferences(
    app: AppHandle,
    preferences: HudPreferences,
) -> Result<HudRuntimeView, String> {
    *app.state::<HudState>()
        .preferences
        .lock()
        .map_err(|_| "preferências do HUD indisponíveis".to_string())? = preferences;
    recompute(&app, Some(false)).await
}

#[tauri::command]
pub async fn set_hud_expanded(
    app: AppHandle,
    expanded: bool,
    focus: Option<bool>,
) -> Result<HudRuntimeView, String> {
    let runtime = recompute(&app, Some(expanded)).await?;
    if runtime.expanded && focus.unwrap_or(false) {
        if let Some(window) = app.get_webview_window(crate::tray::POPOVER_LABEL) {
            window.set_focus().map_err(|error| error.to_string())?;
        }
    }
    Ok(runtime)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rajada_de_telas_cria_um_worker_e_uma_passada_final() {
        let mut queue = ScreenChangeQueue::default();
        assert!(queue.request());
        assert!(!queue.request());
        let generation = queue.current_generation();
        assert!(!queue.finish_pass(generation));
        assert!(
            queue.request(),
            "depois da passada um evento novo cria worker"
        );
    }

    #[test]
    fn evento_durante_recalculo_exige_so_mais_uma_passada() {
        let mut queue = ScreenChangeQueue::default();
        assert!(queue.request());
        let first = queue.current_generation();
        assert!(!queue.request());
        assert!(queue.finish_pass(first));
        let second = queue.current_generation();
        assert!(!queue.finish_pass(second));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn hover_exige_entrada_real_e_permanencia_curta() {
        let mut hover = HoverTracker::default();
        assert!(!hover.observe(true, false, 0));
        assert!(!hover.observe(true, true, 10));
        assert!(!hover.observe(true, true, 99));
        assert!(hover.observe(true, true, 100));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn hud_que_recolhe_sob_o_ponteiro_nao_reabre_sem_nova_entrada() {
        let mut hover = HoverTracker::default();
        assert!(!hover.observe(false, true, 0));
        assert!(!hover.observe(true, true, 500));
        assert!(!hover.observe(true, true, 1_000));
        assert!(!hover.observe(true, false, 1_001));
        assert!(!hover.observe(true, true, 1_010));
        assert!(hover.observe(true, true, 1_100));
    }

    fn tela_com_notch() -> ScreenGeometry {
        ScreenGeometry {
            id: "1".into(),
            name: "Built-in Retina Display".into(),
            has_notch: true,
            notch_width: 185.0,
            notch_height: 32.0,
            screen_width: 1512.0,
            screen_height: 982.0,
            origin_x: 0.0,
            origin_y: 0.0,
            visible_x: 0.0,
            visible_y: 33.0,
            visible_width: 1512.0,
            visible_height: 949.0,
            scale_factor: 2.0,
            safe_top: 32.0,
            active: true,
        }
    }

    #[test]
    fn notch_compacto_usa_a_medicao_e_nao_a_resolucao() {
        let layout = layout_for(&tela_com_notch(), HudPosition::Notch, false).unwrap();
        assert_eq!(layout.width, 249.0);
        assert_eq!(layout.height, 32.0);
        assert_eq!(layout.x, 631.5);
        assert_eq!(layout.y, 0.0);
    }

    #[test]
    fn tela_sem_notch_degrada_para_ilha_com_motivo() {
        let mut screen = tela_com_notch();
        screen.has_notch = false;
        let prefs = HudPreferences {
            enabled: true,
            position: HudPosition::Notch,
            ..Default::default()
        };
        let (position, reason) = resolve_position(&prefs, Some(&screen));
        assert_eq!(position, HudPosition::Island);
        assert!(reason.unwrap().contains("não informou um notch"));
    }

    #[test]
    fn bordas_expandem_sem_sair_da_area_visivel() {
        let screen = tela_com_notch();
        let right = layout_for(&screen, HudPosition::Right, true).unwrap();
        assert_eq!(
            right.x + right.width,
            screen.visible_x + screen.visible_width
        );
        let bottom = layout_for(&screen, HudPosition::Bottom, true).unwrap();
        assert!(bottom.y + bottom.height <= screen.visible_y + screen.visible_height);
    }
}
