//! Presenter nativo do instrumento da barra de menus.
//!
//! Preferência, geometria efetiva e janela vivem no backend porque tamanho e
//! hit-testing não podem depender apenas do DOM. O frontend pede uma intenção;
//! este módulo mede a tela, aplica o fallback e só então publica o estado.

use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

#[cfg(not(target_os = "macos"))]
use tauri::{LogicalPosition, LogicalSize};

use crate::notch::{HudPosition, ScreenGeometry};

const COMPACT_ISLAND_WIDTH: f64 = 300.0;
const COMPACT_TOP_HEIGHT: f64 = 32.0;
const COMPACT_BOTTOM_HEIGHT: f64 = 36.0;
const NOTCH_HORIZONTAL_REVEAL: f64 = 64.0;
const EDGE_WIDTH: f64 = 36.0;
const EDGE_HEIGHT: f64 = 64.0;
const EXPANDED_WIDTH: f64 = 540.0;
const EXPANDED_HEIGHT: f64 = 320.0;
const SIZE_GUTTER: f64 = 8.0;
#[cfg(target_os = "macos")]
const HOVER_DWELL_MS: u64 = 90;
#[cfg(target_os = "macos")]
const HOVER_POLL_MS: u64 = 50;
#[cfg(target_os = "macos")]
const HOVER_IDLE_MS: u64 = 300;
#[cfg(target_os = "macos")]
const HOVER_LEAVE_MS: u64 = 260;
const SUPERSEDED_INTENT: &str = "intenção do HUD substituída";

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
    #[serde(default)]
    pub screen_id: Option<String>,
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
            screen_id: None,
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
    pub screen_id: Option<String>,
    pub expanded: bool,
    pub screen: Option<ScreenGeometry>,
    pub available_screens: Vec<ScreenGeometry>,
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
            screen_id: None,
            expanded: false,
            screen: None,
            available_screens: Vec::new(),
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
    auto_collapse: AtomicBool,
    /// Invalida expansões/focos já enfileirados quando outro gesto nativo
    /// assume a janela. Em especial, o Dock precisa vencer qualquer hover ou
    /// clique do HUD iniciado antes de restaurar `main`.
    presentation_epoch: AtomicU64,
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
#[derive(Debug, Clone, Copy, Default, PartialEq)]
enum HoverPhase {
    #[default]
    Inactive,
    Compact,
    Expanded,
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Copy, PartialEq)]
enum HoverAction {
    None,
    Expand,
    BeginCollapse,
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct HoverTracker {
    phase: HoverPhase,
    inside_last: bool,
    changed_at_ms: Option<u64>,
    collapse_requested: bool,
}

#[cfg(target_os = "macos")]
impl HoverTracker {
    fn observe(&mut self, phase: HoverPhase, inside: bool, now_ms: u64) -> HoverAction {
        if phase == HoverPhase::Inactive {
            *self = Self::default();
            return HoverAction::None;
        }
        if self.phase != phase {
            self.phase = phase;
            self.inside_last = inside;
            self.changed_at_ms = (phase == HoverPhase::Expanded && !inside).then_some(now_ms);
            if phase == HoverPhase::Compact && self.collapse_requested {
                if !inside {
                    self.collapse_requested = false;
                }
                return HoverAction::None;
            }
            self.collapse_requested = false;
            return HoverAction::None;
        }

        match phase {
            HoverPhase::Inactive => HoverAction::None,
            HoverPhase::Compact => {
                // Depois de iniciar o fechamento, o frame em animação pode
                // reaparecer sob um cursor parado. Só uma saída real rearma o
                // hover; essa amostra nunca conta como uma nova entrada.
                if self.collapse_requested {
                    if !inside {
                        self.inside_last = false;
                        self.changed_at_ms = None;
                        self.collapse_requested = false;
                    }
                    return HoverAction::None;
                }
                if !inside {
                    self.inside_last = false;
                    self.changed_at_ms = None;
                    return HoverAction::None;
                }
                if !self.inside_last {
                    self.inside_last = true;
                    self.changed_at_ms = Some(now_ms);
                    return HoverAction::None;
                }
                let ready = self
                    .changed_at_ms
                    .is_some_and(|entered| now_ms.saturating_sub(entered) >= HOVER_DWELL_MS);
                if ready {
                    self.changed_at_ms = None;
                    HoverAction::Expand
                } else {
                    HoverAction::None
                }
            }
            HoverPhase::Expanded => {
                if inside {
                    self.inside_last = true;
                    self.changed_at_ms = None;
                    return HoverAction::None;
                }
                if self.inside_last {
                    self.inside_last = false;
                    self.changed_at_ms = Some(now_ms);
                    return HoverAction::None;
                }
                let ready = self
                    .changed_at_ms
                    .is_some_and(|left| now_ms.saturating_sub(left) >= HOVER_LEAVE_MS);
                if ready && !self.collapse_requested {
                    self.collapse_requested = true;
                    HoverAction::BeginCollapse
                } else {
                    HoverAction::None
                }
            }
        }
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

fn automatic_screen(screens: &[ScreenGeometry]) -> Option<ScreenGeometry> {
    screens
        .iter()
        .find(|screen| screen.active)
        .or_else(|| screens.first())
        .cloned()
}

fn pick_screen(
    screens: &[ScreenGeometry],
    screen_id: Option<&str>,
    follow_active_screen: bool,
) -> (Option<ScreenGeometry>, Option<String>) {
    if let Some(screen_id) = screen_id {
        if let Some(screen) = screens.iter().find(|screen| screen.id == screen_id) {
            return (Some(screen.clone()), None);
        }
        let fallback = automatic_screen(screens);
        let reason = fallback.as_ref().map(|screen| {
            format!(
                "A tela escolhida não está disponível; usando {} temporariamente.",
                screen.name
            )
        });
        return (fallback, reason);
    }
    if follow_active_screen {
        (automatic_screen(screens), None)
    } else {
        // Compatibilidade com a preferência antiga: antes da escolha nominal,
        // desligar "seguir" significava manter a primeira tela enumerada.
        (screens.first().cloned(), None)
    }
}

fn combine_reasons(first: Option<String>, second: Option<String>) -> Option<String> {
    match (first, second) {
        (Some(first), Some(second)) => Some(format!("{first} {second}")),
        (Some(reason), None) | (None, Some(reason)) => Some(reason),
        (None, None) => None,
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
    wanted.min((available - SIZE_GUTTER * 2.0).max(160.0))
}

fn compact_top_height(screen: &ScreenGeometry) -> f64 {
    // `visibleFrame` já incorpora barra, escala e arranjo desta tela. Quando o
    // macOS reserva uma faixa superior, o casco não ultrapassa essa faixa.
    let reserved = screen.visible_y - screen.origin_y;
    if reserved > 0.0 {
        reserved.min(COMPACT_TOP_HEIGHT)
    } else {
        COMPACT_TOP_HEIGHT
    }
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
            HudPosition::Island => compact_top_height(screen),
            HudPosition::Left | HudPosition::Right => EDGE_HEIGHT,
            HudPosition::Bottom => COMPACT_BOTTOM_HEIGHT,
            HudPosition::Menubar => unreachable!(),
        }
    };
    let frame_right = screen.origin_x + screen.screen_width;
    let frame_bottom = screen.origin_y + screen.screen_height;
    let (x, y) = match position {
        HudPosition::Notch => (
            screen.origin_x + (screen.screen_width - width) / 2.0,
            screen.origin_y,
        ),
        HudPosition::Island => (
            screen.origin_x + (screen.screen_width - width) / 2.0,
            screen.origin_y,
        ),
        HudPosition::Left => (
            screen.origin_x,
            screen.origin_y + (screen.screen_height - height) / 2.0,
        ),
        HudPosition::Right => (
            frame_right - width,
            screen.origin_y + (screen.screen_height - height) / 2.0,
        ),
        HudPosition::Bottom => (
            screen.origin_x + (screen.screen_width - width) / 2.0,
            frame_bottom - height,
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
fn screen_at_point(
    screens: &[ScreenGeometry],
    point: crate::notch::DesktopPoint,
) -> Option<&ScreenGeometry> {
    screens.iter().find(|screen| {
        point.x >= screen.origin_x
            && point.x < screen.origin_x + screen.screen_width
            && point.y >= screen.origin_y
            && point.y < screen.origin_y + screen.screen_height
    })
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

fn next_presentation_epoch(app: &AppHandle) -> u64 {
    app.state::<HudState>()
        .presentation_epoch
        .fetch_add(1, Ordering::AcqRel)
        .wrapping_add(1)
}

fn current_presentation_epoch(app: &AppHandle) -> u64 {
    app.state::<HudState>()
        .presentation_epoch
        .load(Ordering::Acquire)
}

fn is_current_intent(current: u64, expected: Option<u64>) -> bool {
    expected.is_none_or(|expected| current == expected)
}

fn ensure_current_intent(app: &AppHandle, expected_epoch: Option<u64>) -> Result<(), String> {
    if !is_current_intent(current_presentation_epoch(app), expected_epoch) {
        Err(SUPERSEDED_INTENT.into())
    } else {
        Ok(())
    }
}

fn warn_recompute(context: &str, error: &str) {
    if error != SUPERSEDED_INTENT {
        log::warn!("{context}: {error}");
    }
}

async fn recompute(
    app: &AppHandle,
    expanded: Option<bool>,
    expected_epoch: Option<u64>,
) -> Result<HudRuntimeView, String> {
    // Reposicionamentos sem gesto próprio herdam a intenção vigente. Assim,
    // uma medição de tela iniciada antes do Dock também é descartada se ele
    // assumir a janela enquanto `screen_geometries` espera a main thread.
    let expected_epoch = expected_epoch.or_else(|| Some(current_presentation_epoch(app)));
    let state = app.state::<HudState>();
    if expanded == Some(false) {
        state.auto_collapse.store(false, Ordering::Release);
    }
    let preferences = state
        .preferences
        .lock()
        .map_err(|_| "preferências do HUD indisponíveis".to_string())?
        .clone();
    let screens = crate::notch::screen_geometries(app).await?;
    let (screen, screen_reason) = pick_screen(
        &screens,
        preferences.screen_id.as_deref(),
        preferences.follow_active_screen,
    );
    let (effective_position, position_reason) = resolve_position(&preferences, screen.as_ref());
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
        screen_id: preferences.screen_id,
        expanded: expanded.unwrap_or(current_expanded)
            && effective_position != HudPosition::Menubar,
        screen,
        available_screens: screens,
        fallback_reason: combine_reasons(screen_reason, position_reason),
        supported_positions: supported_positions(),
    };
    // `screen_geometries` cruza a main thread. O Dock pode assumir o foco
    // enquanto esperamos; uma expansão anterior não pode ganhar depois.
    ensure_current_intent(app, expected_epoch)?;
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
            let auto_collapse = handle
                .state::<HudState>()
                .auto_collapse
                .load(Ordering::Acquire);
            let phase = if runtime.enabled
                && runtime.effective_position != HudPosition::Menubar
                && runtime.hover_expand
            {
                if runtime.expanded && auto_collapse {
                    HoverPhase::Expanded
                } else if !runtime.expanded {
                    HoverPhase::Compact
                } else {
                    HoverPhase::Inactive
                }
            } else {
                HoverPhase::Inactive
            };
            let follows_pointer = runtime.enabled
                && runtime.effective_position != HudPosition::Menubar
                && runtime.follow_active_screen
                && runtime.screen_id.is_none()
                && !runtime.expanded;
            let cursor = if follows_pointer || phase != HoverPhase::Inactive {
                crate::notch::cursor_position(&handle).await.ok()
            } else {
                None
            };
            let moved_to_another_screen = follows_pointer
                && cursor
                    .and_then(|point| screen_at_point(&runtime.available_screens, point))
                    .is_some_and(|target| {
                        runtime.screen.as_ref().map(|screen| screen.id.as_str())
                            != Some(target.id.as_str())
                    });
            if moved_to_another_screen {
                tracker.observe(HoverPhase::Inactive, false, 0);
                if let Err(error) = recompute(&handle, None, None).await {
                    warn_recompute("não consegui acompanhar a tela sob o ponteiro", &error);
                }
                tokio::time::sleep(std::time::Duration::from_millis(HOVER_POLL_MS)).await;
                continue;
            }
            if phase == HoverPhase::Inactive {
                tracker.observe(HoverPhase::Inactive, false, 0);
                tokio::time::sleep(std::time::Duration::from_millis(HOVER_IDLE_MS)).await;
                continue;
            }
            let inside = match runtime.screen.as_ref().and_then(|screen| {
                layout_for(
                    screen,
                    runtime.effective_position,
                    phase == HoverPhase::Expanded,
                )
            }) {
                Some(layout) => cursor
                    .map(|point| contains_point(layout, point))
                    .unwrap_or(false),
                None => false,
            };
            let now_ms = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
            match tracker.observe(phase, inside, now_ms) {
                HoverAction::Expand => {
                    let epoch = next_presentation_epoch(&handle);
                    handle
                        .state::<HudState>()
                        .auto_collapse
                        .store(true, Ordering::Release);
                    if let Err(error) = recompute(&handle, Some(true), Some(epoch)).await {
                        handle
                            .state::<HudState>()
                            .auto_collapse
                            .store(false, Ordering::Release);
                        warn_recompute("não consegui expandir o HUD ao apontar", &error);
                    }
                }
                HoverAction::BeginCollapse => {
                    let _ = handle.emit_to(crate::tray::POPOVER_LABEL, "hud://hover-leave", ());
                }
                HoverAction::None => {}
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
        if let Err(error) = recompute(&handle, Some(false), None).await {
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
            if let Err(error) = recompute(&app, None, None).await {
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

/// Entrega o foco à janela principal sem desmontar o instrumento. O popover
/// clássico fecha; o HUD flutuante volta ao frame compacto, permanece visível
/// e deixa de participar do key loop. O incremento invalida qualquer expansão
/// assíncrona iniciada antes do gesto do Dock ou de `Abrir Frota`.
pub fn prepare_for_main_window(app: &AppHandle) -> Result<(), String> {
    next_presentation_epoch(app);
    let state = app.state::<HudState>();
    state.auto_collapse.store(false, Ordering::Release);
    let mut compact = state
        .runtime
        .lock()
        .map_err(|_| "estado do HUD indisponível".to_string())?
        .clone();
    compact.expanded = false;
    apply_window(app, &compact)?;
    *state
        .runtime
        .lock()
        .map_err(|_| "estado do HUD indisponível".to_string())? = compact.clone();
    app.emit_to(crate::tray::POPOVER_LABEL, "hud://state", &compact)
        .map_err(|error| error.to_string())?;
    app.emit("hud://state", compact)
        .map_err(|error| error.to_string())
}

pub fn collapse_after_blur(app: &AppHandle) {
    if !is_floating(app) {
        if let Some(window) = app.get_webview_window(crate::tray::POPOVER_LABEL) {
            if let Err(error) = window.hide() {
                log::warn!("não consegui fechar o popover após perder foco: {error}");
            }
        }
        return;
    }
    let epoch = next_presentation_epoch(app);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = recompute(&handle, Some(false), Some(epoch)).await {
            warn_recompute("não consegui recolher o HUD após perder foco", &error);
        }
    });
}

pub fn toggle_from_tray(app: &AppHandle) {
    let epoch = next_presentation_epoch(app);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let current = handle
            .state::<HudState>()
            .runtime
            .lock()
            .ok()
            .map(|runtime| runtime.expanded)
            .unwrap_or(false);
        match recompute(&handle, Some(!current), Some(epoch)).await {
            Ok(runtime) if runtime.expanded && current_presentation_epoch(&handle) == epoch => {
                if let Some(window) = handle.get_webview_window(crate::tray::POPOVER_LABEL) {
                    if let Err(error) = window.set_focus() {
                        log::warn!("não consegui focar o HUD aberto pela tray: {error}");
                    }
                }
            }
            Ok(_) => {}
            Err(error) => warn_recompute("não consegui alternar o HUD pela tray", &error),
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
    let epoch = next_presentation_epoch(&app);
    *app.state::<HudState>()
        .preferences
        .lock()
        .map_err(|_| "preferências do HUD indisponíveis".to_string())? = preferences;
    recompute(&app, Some(false), Some(epoch)).await
}

#[tauri::command]
pub async fn set_hud_expanded(
    app: AppHandle,
    expanded: bool,
    focus: Option<bool>,
    auto_collapse: Option<bool>,
) -> Result<HudRuntimeView, String> {
    let epoch = next_presentation_epoch(&app);
    let transient = expanded && auto_collapse.unwrap_or(false);
    app.state::<HudState>()
        .auto_collapse
        .store(transient, Ordering::Release);
    let runtime = match recompute(&app, Some(expanded), Some(epoch)).await {
        Ok(runtime) => runtime,
        Err(error) => {
            if transient {
                app.state::<HudState>()
                    .auto_collapse
                    .store(false, Ordering::Release);
            }
            return Err(error);
        }
    };
    if runtime.expanded && focus.unwrap_or(false) && current_presentation_epoch(&app) == epoch {
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
    fn gesto_novo_invalida_recalculo_da_intencao_anterior() {
        assert!(is_current_intent(7, Some(7)));
        assert!(!is_current_intent(8, Some(7)));
        assert!(is_current_intent(8, None));
    }

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
        assert_eq!(
            hover.observe(HoverPhase::Compact, false, 0),
            HoverAction::None
        );
        assert_eq!(
            hover.observe(HoverPhase::Compact, true, 10),
            HoverAction::None
        );
        assert_eq!(
            hover.observe(HoverPhase::Compact, true, 99),
            HoverAction::None
        );
        assert_eq!(
            hover.observe(HoverPhase::Compact, true, 100),
            HoverAction::Expand
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn hud_que_recolhe_sob_o_ponteiro_nao_reabre_sem_nova_entrada() {
        let mut hover = HoverTracker::default();
        assert_eq!(
            hover.observe(HoverPhase::Inactive, true, 0),
            HoverAction::None
        );
        assert_eq!(
            hover.observe(HoverPhase::Compact, true, 500),
            HoverAction::None
        );
        assert_eq!(
            hover.observe(HoverPhase::Compact, true, 1_000),
            HoverAction::None
        );
        assert_eq!(
            hover.observe(HoverPhase::Compact, false, 1_001),
            HoverAction::None
        );
        assert_eq!(
            hover.observe(HoverPhase::Compact, true, 1_010),
            HoverAction::None
        );
        assert_eq!(
            hover.observe(HoverPhase::Compact, true, 1_100),
            HoverAction::Expand
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn expansao_transitoria_so_rearma_depois_de_sair_do_compacto() {
        let mut hover = HoverTracker::default();
        assert_eq!(
            hover.observe(HoverPhase::Expanded, true, 100),
            HoverAction::None
        );
        assert_eq!(
            hover.observe(HoverPhase::Expanded, false, 101),
            HoverAction::None
        );
        assert_eq!(
            hover.observe(HoverPhase::Expanded, false, 360),
            HoverAction::None
        );
        assert_eq!(
            hover.observe(HoverPhase::Expanded, false, 361),
            HoverAction::BeginCollapse
        );
        assert_eq!(
            hover.observe(HoverPhase::Expanded, false, 400),
            HoverAction::None
        );
        assert_eq!(
            hover.observe(HoverPhase::Expanded, true, 410),
            HoverAction::None
        );
        assert_eq!(
            hover.observe(HoverPhase::Compact, true, 500),
            HoverAction::None
        );
        assert_eq!(
            hover.observe(HoverPhase::Compact, true, 800),
            HoverAction::None
        );
        assert_eq!(
            hover.observe(HoverPhase::Compact, false, 801),
            HoverAction::None
        );
        assert_eq!(
            hover.observe(HoverPhase::Compact, true, 810),
            HoverAction::None
        );
        assert_eq!(
            hover.observe(HoverPhase::Compact, true, 900),
            HoverAction::Expand
        );
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

    fn duas_telas() -> Vec<ScreenGeometry> {
        let mut interna = tela_com_notch();
        interna.active = false;
        let mut externa = interna.clone();
        externa.id = "display-externo".into();
        externa.name = "DELL E2225HSM".into();
        externa.has_notch = false;
        externa.active = true;
        vec![interna, externa]
    }

    #[test]
    fn escolha_nominal_vence_a_tela_ativa() {
        let screens = duas_telas();
        let (screen, reason) = pick_screen(&screens, Some("1"), true);
        assert_eq!(screen.unwrap().id, "1");
        assert_eq!(reason, None);
    }

    #[test]
    fn tela_escolhida_ausente_cai_na_ativa_sem_apagar_a_preferencia() {
        let screens = duas_telas();
        let (screen, reason) = pick_screen(&screens, Some("desconectada"), false);
        assert_eq!(screen.unwrap().id, "display-externo");
        assert!(reason.unwrap().contains("não está disponível"));
    }

    #[test]
    fn modo_automatico_escolhe_a_tela_ativa() {
        let screens = duas_telas();
        let (screen, reason) = pick_screen(&screens, None, true);
        assert_eq!(screen.unwrap().id, "display-externo");
        assert_eq!(reason, None);
    }

    #[test]
    fn ponteiro_resolve_o_frame_real_mesmo_com_origem_negativa() {
        let mut screens = duas_telas();
        screens[0].origin_x = -1_512.0;
        screens[1].origin_x = 0.0;
        let point = crate::notch::DesktopPoint {
            x: -400.0,
            y: 120.0,
        };
        assert_eq!(screen_at_point(&screens, point).unwrap().id, "1");
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
    fn posicoes_recolhidas_encostam_no_frame_fisico() {
        let mut screen = tela_com_notch();
        screen.origin_x = -1_920.0;
        screen.origin_y = 140.0;
        screen.screen_width = 1_920.0;
        screen.screen_height = 1_080.0;
        screen.visible_x = -1_920.0;
        screen.visible_y = 165.0;
        screen.visible_width = 1_920.0;
        screen.visible_height = 1_015.0;

        let island = layout_for(&screen, HudPosition::Island, false).unwrap();
        assert_eq!(island.x, -1_110.0);
        assert_eq!(island.y, screen.origin_y);
        assert_eq!(island.height, 25.0);

        let left = layout_for(&screen, HudPosition::Left, false).unwrap();
        assert_eq!(left.x, screen.origin_x);
        assert_eq!(left.y, 648.0);
        assert_eq!((left.width, left.height), (36.0, 64.0));

        let right = layout_for(&screen, HudPosition::Right, false).unwrap();
        assert_eq!(right.x + right.width, screen.origin_x + screen.screen_width);
        assert_eq!(right.y, left.y);

        let bottom = layout_for(&screen, HudPosition::Bottom, false).unwrap();
        assert_eq!(bottom.x, island.x);
        assert_eq!(
            bottom.y + bottom.height,
            screen.origin_y + screen.screen_height
        );
    }

    #[test]
    fn ilha_respeita_a_faixa_superior_medida_em_qualquer_tela() {
        let mut screen = tela_com_notch();
        screen.id = "display-arbitrario".into();
        screen.name = "Qualquer fabricante".into();
        screen.has_notch = false;
        screen.origin_y = -900.0;
        screen.visible_y = -873.5;
        screen.scale_factor = 1.25;

        let island = layout_for(&screen, HudPosition::Island, false).unwrap();
        assert_eq!(island.y, -900.0);
        assert_eq!(island.height, 26.5);
    }

    #[test]
    fn painel_expandido_preserva_a_aresta_da_posicao() {
        let screen = tela_com_notch();
        let right = layout_for(&screen, HudPosition::Right, true).unwrap();
        assert_eq!(right.x + right.width, screen.origin_x + screen.screen_width);
        let bottom = layout_for(&screen, HudPosition::Bottom, true).unwrap();
        assert_eq!(
            bottom.y + bottom.height,
            screen.origin_y + screen.screen_height
        );
    }
}
