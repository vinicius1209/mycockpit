//! Tray e popover compacto do MyCockpit.
//!
//! Clique primário abre o instrumento compacto; clique secundário mantém um
//! menu nativo como fallback. O frontend publica um snapshot tipado, usado por
//! ambas as superfícies e pelas proteções de ciclo de vida.

use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::{Duration, Instant};
use tauri::{
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalPosition, Manager, PhysicalPosition, Runtime, State,
    WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

pub const TRAY_ID: &str = "mycockpit-tray";
pub const POPOVER_LABEL: &str = "tray-popover";
const DEFAULT_STATUS: &str = "Frota parada";

/// Tray clássica e presenter flutuante são duas portas para o mesmo snapshot.
/// A troca só acontece depois que o presenter de destino foi aplicado, então
/// uma falha preserva pelo menos uma porta alcançável.
pub(crate) fn set_icon_visible(app: &AppHandle, visible: bool) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Err(error) = tray.set_visible(visible) {
            log::warn!("não consegui alternar o ícone da barra de menus: {error}");
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrayActivity {
    pub conv_id: String,
    pub project_id: String,
    pub title: String,
    pub project_name: String,
    pub kind: String,
    pub started_at: Option<i64>,
    pub agent: String,
    pub model: Option<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TraySchedule {
    pub name: String,
    pub at: i64,
    pub relative: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrayLastRun {
    pub name: String,
    pub status: String,
    pub at: i64,
}

/// O último turno de CONVERSA. Vizinho do `TrayLastRun` e DIFERENTE dele: aquele
/// é a última AUTOMAÇÃO (tabela `schedules`). Os dois na mesma tela precisam de
/// copy que os separe — "última execução" com dois significados é ruído, não
/// informação.
///
/// `receipt` ausente é normal: recibo só existe para turno de background com o
/// helper respondendo a tempo (ADR-055). Quem desenha cai no desfecho.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrayLastTurn {
    pub title: String,
    pub receipt: Option<String>,
    pub ok: bool,
    pub at: i64,
}

/// Sessão EXTERNA de CLI (hooks-plan H1): o tray só OBSERVA — linha
/// informativa, sem ação (não somos donos da sessão).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrayExternalSession {
    pub agent: String,
    /// Projeto conhecido pelo cwd, ou o basename da pasta (resolvido no TS).
    pub place: String,
    /// "working" | "waiting" | "blocked" | "idle".
    pub status: String,
    pub last_seen: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TraySnapshot {
    pub running: u32,
    pub decisions: u32,
    /// Parte das decisões que é pedido bloqueante, não disputa. O frontend já
    /// publicava este campo; mantê-lo no contrato Rust evita perdê-lo no roundtrip.
    #[serde(default)]
    pub blocking: u32,
    pub activities: Vec<TrayActivity>,
    pub decision_conv_id: Option<String>,
    pub decision_project_id: Option<String>,
    pub next_schedule: Option<TraySchedule>,
    pub last_run: Option<TrayLastRun>,
    /// Último turno de conversa (≠ `last_run`, que é automação). `default` p/
    /// snapshots antigos.
    #[serde(default)]
    pub last_turn: Option<TrayLastTurn>,
    pub enabled_schedules: u32,
    /// Trabalhos DIFERIDOS do provider vivos (tool `Workflow`/background task,
    /// deferred-work-plan D1.4): morrem junto com o quit — o diálogo de saída
    /// avisa. `default` p/ snapshots antigos (campo ausente = 0).
    #[serde(default)]
    pub deferred: u32,
    /// Sessões externas observadas pelos hooks (H1). `default` p/ snapshots
    /// antigos (campo ausente = vazio).
    #[serde(default)]
    pub external: Vec<TrayExternalSession>,
}

pub struct TrayState {
    snapshot: Mutex<TraySnapshot>,
    keep_in_tray: AtomicBool,
    close_hint_shown: AtomicBool,
    /// Momento em que o popover foi escondido por BLUR. O clique no ícone da
    /// tray primeiro rouba o foco (mousedown → blur esconde) e só depois
    /// entrega o Click(Up) — sem esta marca o toggle veria "invisível" e
    /// reabriria na hora, e o ícone nunca conseguiria fechar o popover.
    popover_blur_hidden_at: Mutex<Option<Instant>>,
    /// Vibrancy nativa aplicada (uma vez). Aplicar no setup crasha (contentView
    /// ainda nil); adiamos pro 1º show, quando a janela já está realizada.
    vibrancy_applied: AtomicBool,
}

impl Default for TrayState {
    fn default() -> Self {
        Self {
            snapshot: Mutex::new(TraySnapshot::default()),
            keep_in_tray: AtomicBool::new(true),
            close_hint_shown: AtomicBool::new(false),
            popover_blur_hidden_at: Mutex::new(None),
            vibrancy_applied: AtomicBool::new(false),
        }
    }
}

/// Aplica a vibrancy NATIVA (NSVisualEffectView) UMA vez — o fundo vira blur
/// real do que está atrás da janela (backdrop-filter no CSS não alcança o
/// desktop). Chamado no 1º show: no setup a contentView ainda é nil e o
/// addSubview do cocoa faz null-deref (aborta o processo).
#[allow(unused_variables)]
pub(crate) fn ensure_vibrancy<R: Runtime>(app: &AppHandle<R>, win: &tauri::WebviewWindow<R>) {
    let state = app.state::<TrayState>();
    if state.vibrancy_applied.swap(true, Ordering::Relaxed) {
        return;
    }
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        // material Popover = o mesmo dos popovers nativos do macOS; raio
        // acompanha o rounded-[13px] do shell.
        if apply_vibrancy(
            win,
            NSVisualEffectMaterial::Popover,
            Some(NSVisualEffectState::Active),
            Some(13.0),
        )
        .is_err()
        {
            // falhou (deveria ser raro): re-arma pra tentar no próximo show.
            state.vibrancy_applied.store(false, Ordering::Relaxed);
        }
    }
}

/// Preferências do ciclo de vida persistidas em DISCO: o evento de fechar pode
/// chegar antes do React montar e sincronizar via IPC — sem o arquivo, o
/// default (true) ignoraria um keepInTrayOnClose=false salvo pelo usuário.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrayPrefs {
    keep_in_tray: bool,
    close_hint_shown: bool,
}

fn prefs_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("tray-prefs.json"))
}

fn load_tray_preferences(app: &AppHandle) {
    let Some(path) = prefs_path(app) else { return };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return;
    };
    let Ok(prefs) = serde_json::from_str::<TrayPrefs>(&raw) else {
        return;
    };
    let state = app.state::<TrayState>();
    state.keep_in_tray.store(prefs.keep_in_tray, Ordering::Relaxed);
    state
        .close_hint_shown
        .store(prefs.close_hint_shown, Ordering::Relaxed);
}

fn snapshot(state: &TrayState) -> TraySnapshot {
    state.snapshot.lock().map(|s| s.clone()).unwrap_or_default()
}

fn fleet_status(s: &TraySnapshot) -> String {
    let running = match s.running {
        0 => DEFAULT_STATUS.to_string(),
        1 => "1 tarefa em execução".to_string(),
        n => format!("{n} tarefas em execução"),
    };
    match s.decisions {
        0 => running,
        1 => format!("{running} · 1 decisão"),
        n => format!("{running} · {n} decisões"),
    }
}

/// Copy pt-BR do status de sessão externa (vocabulário fechado do
/// hook_sessions; desconhecido degrada pra "ociosa" — fail-open no render).
/// Espelha `statusLabel` em lib/externalSessions.ts.
fn external_status_pt(status: &str) -> &'static str {
    match status {
        "working" => "trabalhando",
        "waiting" | "blocked" => "esperando você",
        _ => "ociosa",
    }
}

/// Mensagem do diálogo de saída (deferred-work-plan, D1.4): morte CONSCIENTE.
/// Com trabalho em background do provider vivo, o aviso diz explicitamente que
/// ele morre junto e fica marcado como interrompido — nunca silêncio.
fn quit_warning(s: &TraySnapshot) -> String {
    let mut msg = String::from(
        "Os agents em voo serão interrompidos. Feche a janela se quiser \
         mantê-los rodando na tray.",
    );
    if s.deferred > 0 {
        let deferred = if s.deferred == 1 {
            "Há 1 trabalho em background do agent em andamento: ele morre \
             junto com o app e ficará marcado como interrompido."
                .to_string()
        } else {
            format!(
                "Há {} trabalhos em background do agent em andamento: eles \
                 morrem junto com o app e ficarão marcados como interrompidos.",
                s.deferred
            )
        };
        msg.push_str("\n\n");
        msg.push_str(&deferred);
    }
    msg
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, s: &TraySnapshot) -> tauri::Result<Menu<R>> {
    let mut items: Vec<Box<dyn IsMenuItem<R>>> = Vec::with_capacity(12);
    items.push(Box::new(MenuItem::with_id(
        app,
        "tray-status",
        fleet_status(s),
        false,
        None::<&str>,
    )?));
    if let Some(next) = &s.next_schedule {
        items.push(Box::new(MenuItem::with_id(
            app,
            "tray-next",
            format!("Próxima: {} · {}", next.name, next.relative),
            false,
            None::<&str>,
        )?));
    }
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    if s.decisions > 0 {
        items.push(Box::new(MenuItem::with_id(
            app,
            "tray-review",
            if s.decisions == 1 {
                "Revisar decisão".to_string()
            } else {
                format!("Revisar decisões ({})", s.decisions)
            },
            true,
            None::<&str>,
        )?));
    }
    if s.running > 0 {
        items.push(Box::new(MenuItem::with_id(
            app,
            "tray-running",
            "Ver tarefas em execução",
            true,
            None::<&str>,
        )?));
    }
    // Sessões EXTERNAS (hooks-plan H1): linhas INFORMATIVAS, desabilitadas de
    // propósito — o app observa, não dirige (nenhum controle que não temos).
    if !s.external.is_empty() {
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
        for (i, ext) in s.external.iter().take(4).enumerate() {
            items.push(Box::new(MenuItem::with_id(
                app,
                format!("tray-external-{i}"),
                format!(
                    "Terminal · {} em {} · {}",
                    ext.agent,
                    ext.place,
                    external_status_pt(&ext.status)
                ),
                false,
                None::<&str>,
            )?));
        }
        if s.external.len() > 4 {
            items.push(Box::new(MenuItem::with_id(
                app,
                "tray-external-more",
                format!("e mais {} sessões no terminal", s.external.len() - 4),
                false,
                None::<&str>,
            )?));
        }
    }
    items.push(Box::new(MenuItem::with_id(
        app,
        "tray-new-task",
        "Nova tarefa",
        true,
        None::<&str>,
    )?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "tray-schedules",
        "Automações",
        true,
        None::<&str>,
    )?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "tray-open",
        "Abrir Frota",
        true,
        None::<&str>,
    )?));
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

pub fn show_main_window(app: &AppHandle) {
    if let Some(popover) = app.get_webview_window(POPOVER_LABEL) {
        let _ = popover.hide();
    }
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

pub fn hide_main_window(window: &tauri::Window) {
    let _ = window.hide();
    #[cfg(target_os = "macos")]
    let _ = window
        .app_handle()
        .set_activation_policy(tauri::ActivationPolicy::Accessory);
}

pub fn should_keep_in_tray(app: &AppHandle) -> bool {
    app.state::<TrayState>()
        .keep_in_tray
        .load(Ordering::Relaxed)
}

pub fn notify_window_hidden(app: &AppHandle) {
    let state = app.state::<TrayState>();
    if !state.close_hint_shown.swap(true, Ordering::Relaxed) {
        let _ = app.emit("tray://first-hide", ());
    }
}

/// Registra que o popover acabou de ser escondido por blur (ver TrayState).
pub fn mark_popover_blur_hidden(app: &AppHandle) {
    if let Ok(mut t) = app.state::<TrayState>().popover_blur_hidden_at.lock() {
        *t = Some(Instant::now());
    }
}

fn emit_action(app: &AppHandle, action: &str, conv_id: Option<String>, project_id: Option<String>) {
    show_main_window(app);
    let _ = app.emit(
        "tray://action",
        serde_json::json!({
            "action": action,
            "convId": conv_id,
            "projectId": project_id,
        }),
    );
}

fn emit_background_action(
    app: &AppHandle,
    action: &str,
    conv_id: Option<String>,
    project_id: Option<String>,
) {
    if let Some(popover) = app.get_webview_window(POPOVER_LABEL) {
        let _ = popover.hide();
    }
    let _ = app.emit(
        "tray://action",
        serde_json::json!({
            "action": action,
            "convId": conv_id,
            "projectId": project_id,
        }),
    );
}

pub fn request_quit(app: &AppHandle) {
    let snap = snapshot(&app.state::<TrayState>());
    if snap.running == 0 && snap.deferred == 0 {
        app.exit(0);
        return;
    }
    // Confirmação NATIVA: não pode depender do webview responder — com o JS
    // travado/recarregando, um evento pro frontend deixaria o app impossível
    // de fechar pela tray. O callback roda fora da main thread do diálogo.
    let handle = app.clone();
    app.dialog()
        .message(quit_warning(&snap))
        .title("Sair com tarefas em execução?")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Interromper e sair".into(),
            "Cancelar".into(),
        ))
        .kind(MessageDialogKind::Warning)
        .show(move |ok| {
            if ok {
                handle.exit(0);
            }
        });
}

fn dispatch_native_action(app: &AppHandle, action: &str) {
    let s = snapshot(&app.state::<TrayState>());
    match action {
        "open" => show_main_window(app),
        "new-task" => emit_action(app, "new-task", None, None),
        "review" => emit_action(
            app,
            "review-decision",
            s.decision_conv_id,
            s.decision_project_id,
        ),
        "running" => emit_action(app, "show-running", None, None),
        "schedules" => emit_action(app, "open-schedules", None, None),
        "quit" => request_quit(app),
        _ => {}
    }
}

fn toggle_popover(app: &AppHandle, rect: tauri::Rect) {
    let Some(win) = app.get_webview_window(POPOVER_LABEL) else {
        return;
    };
    if crate::hud::is_floating(app) {
        let s = snapshot(&app.state::<TrayState>());
        let _ = app.emit_to(POPOVER_LABEL, "tray://snapshot", s);
        crate::hud::toggle_from_tray(app);
        return;
    }
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
        return;
    }
    // Escondido por blur há um instante = ESTE clique era pra fechar (o
    // mousedown já fechou); reabrir aqui faria o ícone nunca fechar o popover.
    if let Ok(mut t) = app.state::<TrayState>().popover_blur_hidden_at.lock() {
        if t
            .take()
            .is_some_and(|at| at.elapsed() < Duration::from_millis(400))
        {
            return;
        }
    }

    if let Ok(size) = win.outer_size() {
        let pop_scale = win.scale_factor().unwrap_or(1.0);
        let size_l = size.to_logical::<f64>(pop_scale);
        // O rect do tray-icon chega em pixels FÍSICOS escalados pelo monitor do
        // ÍCONE; a janela escondida vive no monitor primário, então a escala e o
        // current_monitor() dela erram tela/offset em setups multi-monitor ou
        // DPI misto. Resolve em coordenadas LÓGICAS (globais e uniformes no
        // macOS): acha o monitor cujo espaço lógico contém o ponto do clique.
        let mut placed = false;
        if let Ok(monitors) = app.available_monitors() {
            for monitor in &monitors {
                let ms = monitor.scale_factor();
                let pos_l = rect.position.to_logical::<f64>(ms);
                let mp = monitor.position().to_logical::<f64>(ms);
                let msz = monitor.size().to_logical::<f64>(ms);
                let inside = pos_l.x >= mp.x
                    && pos_l.x <= mp.x + msz.width
                    && pos_l.y >= mp.y
                    && pos_l.y <= mp.y + msz.height;
                if !inside {
                    continue;
                }
                let tray_l = rect.size.to_logical::<f64>(ms);
                let x = (pos_l.x + tray_l.width / 2.0 - size_l.width / 2.0)
                    .max(mp.x + 8.0)
                    .min(mp.x + msz.width - size_l.width - 8.0);
                let y = (pos_l.y + tray_l.height + 6.0)
                    .max(mp.y + 4.0)
                    .min(mp.y + msz.height - size_l.height - 8.0);
                let _ = win.set_position(LogicalPosition::new(x, y));
                placed = true;
                break;
            }
        }
        // Nenhum monitor contém o ponto (não deveria acontecer): caminho antigo.
        if !placed {
            let position = rect.position.to_physical::<f64>(pop_scale);
            let tray_size = rect.size.to_physical::<f64>(pop_scale);
            let mut x = position.x + tray_size.width / 2.0 - size.width as f64 / 2.0;
            let mut y = position.y + tray_size.height + 6.0;
            if let Ok(Some(monitor)) = win.current_monitor() {
                let mp = monitor.position();
                let ms = monitor.size();
                x = x
                    .max(mp.x as f64 + 8.0)
                    .min(mp.x as f64 + ms.width as f64 - size.width as f64 - 8.0);
                y = y
                    .max(mp.y as f64 + 4.0)
                    .min(mp.y as f64 + ms.height as f64 - size.height as f64 - 8.0);
            }
            let _ =
                win.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
        }
    }
    let s = snapshot(&app.state::<TrayState>());
    let _ = app.emit_to(POPOVER_LABEL, "tray://snapshot", s);
    ensure_vibrancy(app, &win); // agora a janela está realizada (contentView ok)
    let _ = win.show();
    let _ = win.set_focus();
}

pub fn create(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // Preferências persistidas ANTES de qualquer evento de janela: o fechar
    // pode chegar na janela de boot, antes do React sincronizar via IPC.
    load_tray_preferences(app);

    WebviewWindowBuilder::new(
        app,
        POPOVER_LABEL,
        // Entry próprio do instrumento, sem bootar o App inteiro.
        WebviewUrl::App("tray.html".into()),
    )
    .title("Frota")
    .inner_size(360.0, 430.0)
    .resizable(false)
    .decorations(false)
    // O app é distribuído por DMG (não Mac App Store); a feature do Tauri
    // permite recortar os cantos do instrumento como um popover nativo.
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(true)
    // Popover de menubar segue o usuário em qualquer Space/fullscreen; sem
    // isto o show() pode disparar troca de Space ou abrir no desktop errado.
    .visible_on_all_workspaces(true)
    .visible(false)
    .build()?;
    // A vibrancy é aplicada no 1º show (ensure_vibrancy) — aqui a contentView
    // ainda é nil e o addSubview do cocoa abortaria o processo.

    let initial = TraySnapshot::default();
    let menu = build_menu(app, &initial)?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template@2x.png"))?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        // o próprio status já carrega a marca ("Frota parada" / "N tarefas…")
        .tooltip(DEFAULT_STATUS)
        .menu(&menu)
        // O menu nativo fica no clique secundário; o primário abre o popover.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-open" => dispatch_native_action(app, "open"),
            "tray-new-task" => dispatch_native_action(app, "new-task"),
            "tray-review" => dispatch_native_action(app, "review"),
            "tray-running" => dispatch_native_action(app, "running"),
            "tray-schedules" => dispatch_native_action(app, "schedules"),
            "tray-quit" => dispatch_native_action(app, "quit"),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                toggle_popover(tray.app_handle(), rect);
            }
        })
        .build(app)?;
    Ok(())
}

#[tauri::command]
pub fn set_tray_snapshot(
    app: AppHandle,
    state: State<'_, TrayState>,
    snapshot: TraySnapshot,
) -> Result<(), String> {
    let prev = {
        let mut guard = state.snapshot.lock().map_err(|e| e.to_string())?;
        std::mem::replace(&mut *guard, snapshot.clone())
    };
    // Menu e tooltip só dependem de running/decisions/next_schedule/external.
    // Os deltas de atividade (a cada tool step de um run) NÃO podem
    // reconstruir o NSMenu na main thread várias vezes por minuto — pula
    // quando nada visível mudou. (`external` já chega coalescido do App.tsx
    // por chave semântica agent:sessão:status — não tica por evento.)
    let menu_changed = prev.running != snapshot.running
        || prev.decisions != snapshot.decisions
        || prev.next_schedule != snapshot.next_schedule
        || prev.external != snapshot.external;
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if menu_changed {
            if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                if let Ok(menu) = build_menu(&handle, &snapshot) {
                    let _ = tray.set_menu(Some(menu));
                }
                let _ = tray
                    .set_tooltip(Some(fleet_status(&snapshot)));
            }
        }
        // Popover escondido (estado comum) não recebe delta: toggle_popover
        // re-emite o snapshot fresco imediatamente antes do show().
        if let Some(pop) = handle.get_webview_window(POPOVER_LABEL) {
            if pop.is_visible().unwrap_or(false) {
                let _ = handle.emit_to(POPOVER_LABEL, "tray://snapshot", snapshot);
            }
        }
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_tray_snapshot(state: State<'_, TrayState>) -> TraySnapshot {
    snapshot(&state)
}

#[tauri::command]
pub fn set_tray_preferences(
    app: AppHandle,
    state: State<'_, TrayState>,
    keep_in_tray: bool,
    close_hint_shown: bool,
) {
    state.keep_in_tray.store(keep_in_tray, Ordering::Relaxed);
    state
        .close_hint_shown
        .store(close_hint_shown, Ordering::Relaxed);
    // Persiste pro próximo BOOT (ver load_tray_preferences). Best-effort.
    if let Some(path) = prefs_path(&app) {
        let prefs = TrayPrefs {
            keep_in_tray,
            close_hint_shown,
        };
        if let Ok(json) = serde_json::to_string(&prefs) {
            let _ = std::fs::write(path, json);
        }
    }
}

#[tauri::command]
pub fn tray_action(
    app: AppHandle,
    action: String,
    conv_id: Option<String>,
    project_id: Option<String>,
) {
    match action.as_str() {
        "quit" => request_quit(&app),
        "open" => show_main_window(&app),
        // Ações de fundo: não puxam a janela principal pra frente (o feedback
        // vira notificação nativa no frontend quando a janela está escondida).
        "stop-activity" | "pause-schedules" => {
            emit_background_action(&app, &action, conv_id, project_id)
        }
        _ => emit_action(&app, &action, conv_id, project_id),
    }
}

#[tauri::command]
pub fn force_quit(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// D1.4 (deferred-work-plan): sair com trabalho em background do provider
    /// vivo avisa que ele morre junto — nunca morte silenciosa.
    #[test]
    fn quit_warning_avisa_do_trabalho_em_background_que_morre_junto() {
        let base = quit_warning(&TraySnapshot {
            running: 1,
            ..Default::default()
        });
        assert!(!base.contains("background"));
        let um = quit_warning(&TraySnapshot {
            running: 1,
            deferred: 1,
            ..Default::default()
        });
        assert!(um.contains("1 trabalho em background"));
        assert!(um.contains("interrompido"));
        let dois = quit_warning(&TraySnapshot {
            running: 1,
            deferred: 2,
            ..Default::default()
        });
        assert!(dois.contains("2 trabalhos em background"));
    }

    /// H1 (hooks-plan): sessão externa no tray com copy honesta — espelho do
    /// `statusLabel` de lib/externalSessions.ts (mexeu num, mexa no outro).
    #[test]
    fn status_de_sessao_externa_vira_copy_honesta() {
        assert_eq!(external_status_pt("working"), "trabalhando");
        assert_eq!(external_status_pt("waiting"), "esperando você");
        assert_eq!(external_status_pt("blocked"), "esperando você");
        assert_eq!(external_status_pt("idle"), "ociosa");
        // desconhecido degrada, nunca crasha (fail-open no render).
        assert_eq!(external_status_pt("estado-novo"), "ociosa");
    }

    #[test]
    fn fleet_status_pluraliza_e_prioriza_atencao() {
        assert_eq!(fleet_status(&TraySnapshot::default()), "Frota parada");
        assert_eq!(
            fleet_status(&TraySnapshot {
                running: 1,
                decisions: 1,
                ..Default::default()
            }),
            "1 tarefa em execução · 1 decisão"
        );
        assert_eq!(
            fleet_status(&TraySnapshot {
                running: 3,
                decisions: 2,
                ..Default::default()
            }),
            "3 tarefas em execução · 2 decisões"
        );
    }
}
