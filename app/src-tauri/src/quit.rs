//! Coordenador único da saída definitiva do Frota (ADR-164).
//!
//! A primeira passagem de `ExitRequested` é sempre interceptada. Só este
//! módulo pode confirmar a intenção, fechar a admissão, drenar recursos e
//! autorizar a segunda passagem que encerra o processo.

use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum QuitOrigin {
    Native,
    Tray,
    CloseWindow,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum QuitPhase {
    #[default]
    Idle,
    Requested,
    Draining,
    Committed,
}

#[derive(Default)]
pub(crate) struct QuitCoordinator {
    phase: Mutex<QuitPhase>,
}

impl QuitCoordinator {
    fn request(&self) -> bool {
        let Ok(mut phase) = self.phase.lock() else {
            return false;
        };
        if *phase != QuitPhase::Idle {
            return false;
        }
        *phase = QuitPhase::Requested;
        true
    }

    fn cancel(&self) {
        if let Ok(mut phase) = self.phase.lock() {
            if *phase == QuitPhase::Requested {
                *phase = QuitPhase::Idle;
            }
        }
    }

    fn begin_draining(&self) -> bool {
        let Ok(mut phase) = self.phase.lock() else {
            return false;
        };
        if *phase != QuitPhase::Requested {
            return false;
        }
        *phase = QuitPhase::Draining;
        true
    }

    fn commit(&self) {
        if let Ok(mut phase) = self.phase.lock() {
            if *phase == QuitPhase::Draining {
                *phase = QuitPhase::Committed;
            }
        }
    }

    fn is_draining(&self) -> bool {
        self.phase
            .lock()
            .is_ok_and(|phase| matches!(*phase, QuitPhase::Draining | QuitPhase::Committed))
    }

    fn is_committed(&self) -> bool {
        self.phase
            .lock()
            .is_ok_and(|phase| *phase == QuitPhase::Committed)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuitInventory {
    runs: usize,
    deferred: usize,
    managed_processes: usize,
    plugin_workers: usize,
    dictations: usize,
    utility_attempts: usize,
    updates: usize,
    companion_actions: usize,
    enabled_schedules: usize,
    external_sessions: usize,
    instrument_visible: bool,
}

impl QuitInventory {
    fn interrupts_work(&self) -> bool {
        self.runs
            + self.deferred
            + self.managed_processes
            + self.plugin_workers
            + self.dictations
            + self.utility_attempts
            + self.updates
            + self.companion_actions
            > 0
    }

    fn needs_confirmation(&self) -> bool {
        self.interrupts_work() || self.enabled_schedules > 0
    }

    fn action_label(&self) -> &'static str {
        if self.interrupts_work() {
            "Interromper e sair"
        } else {
            "Sair"
        }
    }

    fn message(&self) -> String {
        let mut lines = Vec::new();
        push_count(
            &mut lines,
            self.runs,
            "1 tarefa em execução será interrompida.",
            |count| format!("{count} tarefas em execução serão interrompidas."),
        );
        push_count(
            &mut lines,
            self.deferred,
            "1 trabalho em segundo plano será interrompido.",
            |count| format!("{count} trabalhos em segundo plano serão interrompidos."),
        );
        let owned_processes = self.managed_processes + self.plugin_workers;
        push_count(
            &mut lines,
            owned_processes,
            "1 processo iniciado pelo Frota será encerrado.",
            |count| format!("{count} processos iniciados pelo Frota serão encerrados."),
        );
        if self.dictations > 0 {
            lines.push("O ditado atual será descartado.".into());
        }
        push_count(
            &mut lines,
            self.utility_attempts,
            "1 análise local será interrompida.",
            |count| format!("{count} análises locais serão interrompidas."),
        );
        push_count(
            &mut lines,
            self.updates,
            "1 atualização em andamento será encerrada com segurança.",
            |count| format!("{count} atualizações em andamento serão encerradas com segurança."),
        );
        push_count(
            &mut lines,
            self.companion_actions,
            "1 ação aceita pelo Companion ainda está sendo processada.",
            |count| format!("{count} ações aceitas pelo Companion ainda estão sendo processadas."),
        );
        push_count(
            &mut lines,
            self.enabled_schedules,
            "1 automação não executará enquanto o Frota estiver fechado.",
            |count| format!("{count} automações não executarão enquanto o Frota estiver fechado."),
        );
        if self.instrument_visible && self.interrupts_work() {
            lines.push("O instrumento fecha junto com o app.".into());
        }
        push_count(
            &mut lines,
            self.external_sessions,
            "1 sessão aberta no Terminal não pertence ao Frota e continuará rodando.",
            |count| {
                format!(
                    "{count} sessões abertas no Terminal não pertencem ao Frota e continuarão rodando."
                )
            },
        );
        lines.join("\n")
    }
}

fn push_count(
    lines: &mut Vec<String>,
    count: usize,
    singular: &str,
    plural: impl FnOnce(usize) -> String,
) {
    match count {
        0 => {}
        1 => lines.push(singular.into()),
        count => lines.push(plural(count)),
    }
}

async fn inventory(app: &AppHandle) -> QuitInventory {
    let tray = crate::tray::current_snapshot(&app.state::<crate::tray::TrayState>());
    let backend_runs = app.state::<crate::agent::RunRegistry>().ativos();
    // O snapshot React pode ainda estar em zero nos primeiros segundos do
    // boot. Agendamento é dado persistido, então a leitura nativa vence essa
    // janela e o snapshot permanece apenas como fallback conservador.
    let persisted_schedules = match persisted_enabled_schedules(app) {
        Ok(count) => count,
        Err(error) => {
            log::warn!("não consegui inventariar automações na saída: {error}");
            0
        }
    };
    QuitInventory {
        runs: backend_runs.max(tray.running as usize),
        deferred: tray.deferred as usize,
        managed_processes: app
            .state::<std::sync::Arc<crate::work_gateway::ProcessRegistry>>()
            .active_count(),
        plugin_workers: app
            .state::<std::sync::Arc<crate::plugin_runtime::PluginRuntimeRegistry>>()
            .active_count(),
        dictations: app.state::<crate::stt::SttSession>().active_count().await,
        utility_attempts: app
            .state::<std::sync::Arc<crate::utility::UtilityState>>()
            .active_count(),
        updates: app
            .state::<std::sync::Arc<crate::update::UpdateJobs>>()
            .active_count(),
        companion_actions: app
            .state::<crate::companion::CompanionState>()
            .pending_action_count(),
        enabled_schedules: persisted_schedules.max(tray.enabled_schedules as usize),
        external_sessions: tray.external.len(),
        instrument_visible: crate::hud::is_floating(app),
    }
}

fn persisted_enabled_schedules(app: &AppHandle) -> Result<usize, String> {
    use rusqlite::OpenFlags;
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("mycockpit.db");
    let connection = rusqlite::Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| error.to_string())?;
    connection
        .busy_timeout(Duration::from_secs(1))
        .map_err(|error| error.to_string())?;
    query_enabled_schedules(&connection)
}

fn query_enabled_schedules(connection: &rusqlite::Connection) -> Result<usize, String> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM schedules WHERE enabled = 1",
            [],
            |row| row.get::<_, usize>(0),
        )
        .map_err(|error| error.to_string())
}

pub(crate) fn is_draining(app: &AppHandle) -> bool {
    app.state::<QuitCoordinator>().is_draining()
}

pub(crate) fn allows_exit(app: &AppHandle) -> bool {
    app.state::<QuitCoordinator>().is_committed()
}

pub(crate) fn request_quit(app: &AppHandle, origin: QuitOrigin) {
    if !app.state::<QuitCoordinator>().request() {
        return;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let inventory = inventory(&handle).await;
        log::info!(
            "saída solicitada: origem={origin:?} confirmação={} recursos={}",
            inventory.needs_confirmation(),
            inventory.runs
                + inventory.deferred
                + inventory.managed_processes
                + inventory.plugin_workers
                + inventory.dictations
                + inventory.utility_attempts
                + inventory.updates
                + inventory.companion_actions
        );
        if inventory.needs_confirmation() {
            show_confirmation(&handle, origin, inventory);
        } else {
            start_teardown(handle, origin, inventory);
        }
    });
}

#[cfg(target_os = "macos")]
fn show_confirmation(app: &AppHandle, origin: QuitOrigin, inventory: QuitInventory) {
    let handle = app.clone();
    let scheduled = app.run_on_main_thread(move || {
        use objc2::MainThreadMarker;
        use objc2_app_kit::{NSAlert, NSAlertSecondButtonReturn, NSAlertStyle};
        use objc2_foundation::NSString;

        let Some(main_thread) = MainThreadMarker::new() else {
            handle.state::<QuitCoordinator>().cancel();
            log::error!("não consegui abrir a confirmação de saída fora da thread principal");
            return;
        };
        let alert = NSAlert::new(main_thread);
        alert.setMessageText(&NSString::from_str("Sair do Frota?"));
        alert.setInformativeText(&NSString::from_str(&inventory.message()));
        alert.setAlertStyle(NSAlertStyle::Warning);
        alert.addButtonWithTitle(&NSString::from_str("Continuar no Frota"));
        let destructive = alert.addButtonWithTitle(&NSString::from_str(inventory.action_label()));
        destructive.setHasDestructiveAction(true);
        if alert.runModal() == NSAlertSecondButtonReturn {
            start_teardown(handle, origin, inventory);
        } else {
            handle.state::<QuitCoordinator>().cancel();
            log::info!("saída cancelada: origem={origin:?}");
        }
    });
    if let Err(error) = scheduled {
        app.state::<QuitCoordinator>().cancel();
        log::error!("não consegui abrir a confirmação de saída: {error}");
    }
}

#[cfg(not(target_os = "macos"))]
fn show_confirmation(app: &AppHandle, origin: QuitOrigin, inventory: QuitInventory) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let handle = app.clone();
    app.dialog()
        .message(inventory.message())
        .title("Sair do Frota?")
        .buttons(MessageDialogButtons::OkCancelCustom(
            inventory.action_label().into(),
            "Continuar no Frota".into(),
        ))
        .kind(MessageDialogKind::Warning)
        .show(move |confirmed| {
            if confirmed {
                start_teardown(handle, origin, inventory);
            } else {
                handle.state::<QuitCoordinator>().cancel();
            }
        });
}

fn start_teardown(app: AppHandle, origin: QuitOrigin, inventory: QuitInventory) {
    if !app.state::<QuitCoordinator>().begin_draining() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        let _ = app.emit("quit://draining", origin);
        crate::hud::prepare_for_quit(&app);

        let runs = app.state::<crate::agent::RunRegistry>();
        runs.begin_shutdown();
        runs.request_cancel_all();

        let processes = app
            .state::<std::sync::Arc<crate::work_gateway::ProcessRegistry>>()
            .inner()
            .clone();
        processes.begin_shutdown();
        processes.stop_all(&app);

        let plugins = app
            .state::<std::sync::Arc<crate::plugin_runtime::PluginRuntimeRegistry>>()
            .inner()
            .clone();
        plugins.begin_shutdown();
        plugins.stop_all();

        let utility = app
            .state::<std::sync::Arc<crate::utility::UtilityState>>()
            .inner()
            .clone();
        utility.begin_shutdown();
        utility.cancel_all();

        let updates = app
            .state::<std::sync::Arc<crate::update::UpdateJobs>>()
            .inner()
            .clone();
        updates.begin_shutdown();
        updates.request_shutdown_all();

        app.state::<crate::stt::SttSession>().shutdown_all().await;
        crate::companion::shutdown_on_exit(&app);
        app.state::<std::sync::Arc<crate::resource_broker::ResourceLeaseRegistry>>()
            .release_all();

        tokio::time::sleep(Duration::from_millis(750)).await;
        runs.kill_all();
        runs.2.solta();
        processes.kill_all();
        plugins.kill_all();

        if inventory.updates > 0 {
            tokio::time::sleep(Duration::from_millis(4_250)).await;
            updates.kill_all();
        }

        write_receipt(&app, &inventory, started.elapsed());
        app.state::<QuitCoordinator>().commit();
        log::info!(
            "saída comprometida: origem={origin:?} duração_ms={}",
            started.elapsed().as_millis()
        );
        app.exit(0);
    });
}

fn write_receipt(app: &AppHandle, inventory: &QuitInventory, elapsed: Duration) {
    let Ok(directory) = app.path().app_data_dir() else {
        return;
    };
    let receipt = serde_json::json!({
        "version": app.package_info().version.to_string(),
        "at": SystemTime::now().duration_since(UNIX_EPOCH).map(|time| time.as_secs()).unwrap_or(0),
        "durationMs": elapsed.as_millis().min(u128::from(u64::MAX)) as u64,
        "inventory": inventory,
        "result": "committed",
    });
    if let Err(error) = std::fs::create_dir_all(&directory)
        .and_then(|_| std::fs::write(directory.join("quit-receipt.json"), receipt.to_string()))
    {
        log::warn!("não consegui registrar o recibo de saída: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saida_ociosa_nao_confirma() {
        assert!(!QuitInventory::default().needs_confirmation());
    }

    #[test]
    fn automacao_confirma_sem_chamar_de_interrupcao() {
        let inventory = QuitInventory {
            enabled_schedules: 3,
            ..Default::default()
        };
        assert!(inventory.needs_confirmation());
        assert_eq!(inventory.action_label(), "Sair");
        assert_eq!(
            inventory.message(),
            "3 automações não executarão enquanto o Frota estiver fechado."
        );
    }

    #[test]
    fn sessao_externa_sozinha_nao_bloqueia_a_saida() {
        let inventory = QuitInventory {
            external_sessions: 2,
            ..Default::default()
        };
        assert!(!inventory.needs_confirmation());
        assert!(inventory.message().contains("continuarão rodando"));
    }

    #[test]
    fn automacoes_vem_do_sqlite_antes_do_snapshot_do_frontend() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE schedules (enabled INTEGER NOT NULL);\
                 INSERT INTO schedules VALUES (1), (0), (1);",
            )
            .unwrap();
        assert_eq!(query_enabled_schedules(&connection), Ok(2));
    }

    #[test]
    fn trabalho_real_pluraliza_e_externo_permanece() {
        let inventory = QuitInventory {
            runs: 1,
            managed_processes: 2,
            dictations: 1,
            external_sessions: 2,
            instrument_visible: true,
            ..Default::default()
        };
        let message = inventory.message();
        assert!(message.contains("1 tarefa em execução será interrompida."));
        assert!(message.contains("2 processos iniciados pelo Frota serão encerrados."));
        assert!(message.contains("O ditado atual será descartado."));
        assert!(message.contains("O instrumento fecha junto com o app."));
        assert!(message.contains("2 sessões abertas no Terminal"));
        assert_eq!(inventory.action_label(), "Interromper e sair");
    }

    #[test]
    fn latch_nao_duplica_pedido_e_cancelar_reabre_a_porta() {
        let coordinator = QuitCoordinator::default();
        assert!(coordinator.request());
        assert!(!coordinator.request());
        coordinator.cancel();
        assert!(coordinator.request());
    }

    #[test]
    fn segunda_passagem_so_e_permitida_depois_do_commit() {
        let coordinator = QuitCoordinator::default();
        assert!(coordinator.request());
        assert!(!coordinator.is_committed());
        assert!(coordinator.begin_draining());
        assert!(!coordinator.is_committed());
        coordinator.commit();
        assert!(coordinator.is_committed());
    }

    #[tokio::test]
    async fn fechar_admissao_e_idempotente_em_todos_os_donos() {
        let runs = crate::agent::RunRegistry::default();
        runs.begin_shutdown();
        runs.begin_shutdown();
        assert!(runs.ensure_accepting().is_err());

        let processes = crate::work_gateway::ProcessRegistry::default();
        processes.begin_shutdown();
        processes.begin_shutdown();
        assert!(processes.ensure_accepting().is_err());

        let plugins = crate::plugin_runtime::PluginRuntimeRegistry::default();
        plugins.begin_shutdown();
        plugins.begin_shutdown();
        assert!(plugins.ensure_accepting().is_err());

        let utility = crate::utility::UtilityState::default();
        utility.begin_shutdown();
        utility.begin_shutdown();
        assert!(utility.ensure_accepting().is_err());

        let updates = crate::update::UpdateJobs::default();
        updates.begin_shutdown();
        updates.begin_shutdown();
        assert!(updates.ensure_accepting().is_err());

        let companion = crate::companion::CompanionState::default();
        companion.begin_shutdown();
        companion.begin_shutdown();
        assert!(companion.ensure_accepting().is_err());

        let dictation = crate::stt::SttSession::default();
        dictation.shutdown_all().await;
        dictation.shutdown_all().await;
        assert!(dictation.ensure_accepting().is_err());
    }
}
