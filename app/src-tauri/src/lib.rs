use tauri::Manager;
use tauri_plugin_decorum::WebviewWindowExt;
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

/// Inset Y dos semáforos p/ centrá-los no header de 56px (h-14). Calibrado por
/// medição no app real (o inset do decorum não é o centro geométrico do botão).
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHTS_Y: f32 = 37.0;

mod adapters;
mod agent;
mod approval;
mod attachments;
mod catalog;
mod companion;
mod context;
mod detect;
mod fsx;
mod git;
mod github;
mod mycockpit;
mod path;
mod proc;
mod pricing;
mod sdd;
mod skills;
mod sources;
mod stt;
mod tray;

/// Ponto de entrada do subcomando `approval-server`: ESTE binário rodando como
/// MCP server stdio quando o `claude -p` o spawna (aprovação granular inline).
/// Chamado pelo `main.rs` ANTES do Tauri subir; nunca retorna ao app normal.
pub fn run_approval_server() {
    approval::run_mcp_server();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Backup rotativo do banco no boot (rede de segurança contra perda de dados).
/// Copia db + WAL + SHM (snapshot consistente: roda antes do plugin SQL abrir)
/// para app_data_dir/backups/mycockpit-{1..3}.db, no máx. 1x a cada ~20h.
fn backup_database(app: &tauri::AppHandle) -> Result<(), String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("sem app_data_dir: {e}"))?;
    let db = data.join("mycockpit.db");
    if !db.exists() {
        return Ok(()); // primeira execução: nada a proteger ainda
    }
    let dir = data.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // já tem backup fresco (<20h)? então não gira (1 backup por dia de uso).
    let newest = dir.join("mycockpit-1.db");
    if let Ok(meta) = std::fs::metadata(&newest) {
        if let Ok(modified) = meta.modified() {
            if let Ok(age) = std::time::SystemTime::now().duration_since(modified) {
                if age < std::time::Duration::from_secs(20 * 60 * 60) {
                    return Ok(());
                }
            }
        }
    }

    // rotação 2→3, 1→2 (o 3 mais antigo cai), depois copia o atual pro 1.
    for (from, to) in [(2u8, 3u8), (1, 2)] {
        for ext in ["db", "db-wal", "db-shm"] {
            let src = dir.join(format!("mycockpit-{from}.{ext}"));
            if src.exists() {
                let _ = std::fs::rename(&src, dir.join(format!("mycockpit-{to}.{ext}")));
            }
        }
    }
    for ext in ["db", "db-wal", "db-shm"] {
        let src = data.join(format!("mycockpit.{ext}"));
        let dst = dir.join(format!("mycockpit-1.{ext}"));
        if src.exists() {
            std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
        } else {
            let _ = std::fs::remove_file(&dst); // não deixa WAL órfão de outra era
        }
    }
    log::info!("backup do banco atualizado em {}", dir.display());
    Ok(())
}

pub fn run() {
    // ANTES de tudo: hidrata o PATH (apps GUI do macOS herdam um PATH mínimo e
    // não acham claude/codex/agy). Precisa rodar antes de qualquer spawn de CLI.
    path::hydrate_path();

    let migrations = vec![
        Migration {
            version: 1,
            description: "create_projects",
            sql: "CREATE TABLE IF NOT EXISTS projects ( \
                    id TEXT PRIMARY KEY, \
                    name TEXT NOT NULL, \
                    path TEXT NOT NULL UNIQUE, \
                    created_at INTEGER NOT NULL, \
                    has_claude_md INTEGER NOT NULL DEFAULT 0, \
                    has_agents_md INTEGER NOT NULL DEFAULT 0 \
                  );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_conversations",
            sql: "CREATE TABLE IF NOT EXISTS conversations ( \
                    project_id TEXT PRIMARY KEY, \
                    session_id TEXT, \
                    items TEXT NOT NULL, \
                    updated_at INTEGER NOT NULL \
                  );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "projects_permission_mode",
            sql: "ALTER TABLE projects ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'padrao';",
            kind: MigrationKind::Up,
        },
        // Multi-conversa (Sprint 2): conversa vira entidade com id próprio.
        // Split em 5 migrações de 1 statement, tauri-plugin-sql roda 1 por vez.
        Migration {
            version: 4,
            description: "conversations_v2_create",
            sql: "CREATE TABLE conversations_new ( \
                    id TEXT PRIMARY KEY, \
                    project_id TEXT NOT NULL, \
                    title TEXT, \
                    session_id TEXT, \
                    items TEXT NOT NULL, \
                    created_at INTEGER NOT NULL, \
                    updated_at INTEGER NOT NULL \
                  );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "conversations_v2_migrate",
            sql: "INSERT INTO conversations_new (id, project_id, title, session_id, items, created_at, updated_at) \
                  SELECT lower(hex(randomblob(16))), project_id, NULL, session_id, items, updated_at, updated_at \
                  FROM conversations;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "conversations_v2_drop_old",
            sql: "DROP TABLE conversations;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "conversations_v2_rename",
            sql: "ALTER TABLE conversations_new RENAME TO conversations;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "conversations_project_idx",
            sql: "CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "conversations_suggestions",
            sql: "ALTER TABLE conversations ADD COLUMN suggestions TEXT NOT NULL DEFAULT '[]';",
            kind: MigrationKind::Up,
        },
        // v0.2.x, persiste o agent + modelo + effort por conversa (cross-restart),
        // p/ o resume usar o CLI certo e a UI refletir o que travou no 1º run.
        Migration {
            version: 10,
            description: "conversations_agent",
            sql: "ALTER TABLE conversations ADD COLUMN agent TEXT NOT NULL DEFAULT 'claude-code';",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "conversations_req_model",
            sql: "ALTER TABLE conversations ADD COLUMN req_model TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "conversations_effort",
            sql: "ALTER TABLE conversations ADD COLUMN effort TEXT;",
            kind: MigrationKind::Up,
        },
        // Conserta conversas legadas (pré-persistência de agent): a v10 jogou
        // 'claude-code' em TODAS, inclusive as do Codex. Sessão uuid-v7 (15ª
        // char='7') = Codex; uuid-v4 ('4') = Claude. Reetiqueta só as v7 ainda
        // marcadas claude-code, senão o resume usa o CLI errado.
        Migration {
            version: 13,
            description: "fix_legacy_codex_agent",
            sql: "UPDATE conversations SET agent = 'codex' WHERE agent = 'claude-code' AND substr(session_id, 15, 1) = '7';",
            kind: MigrationKind::Up,
        },
        // v0.3 Fusion, arquiva cada disputa (auditável pós-restart; alimenta "ver disputa").
        Migration {
            version: 14,
            description: "fusion_runs",
            sql: "CREATE TABLE IF NOT EXISTS fusion_runs (id TEXT PRIMARY KEY, conv_id TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);",
            kind: MigrationKind::Up,
        },
        // v15, `pending`=1 marca uma disputa esperando DECISÃO (caso 2): sobrevive
        // ao restart até o usuário escolher o vencedor. Confirmar/descartar zera.
        Migration {
            version: 15,
            description: "fusion_runs_pending",
            sql: "ALTER TABLE fusion_runs ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;",
            kind: MigrationKind::Up,
        },
        // v16, soft delete de projeto (deleted_at NULL = ativo): restaurar + métricas.
        Migration {
            version: 16,
            description: "projects_deleted_at",
            sql: "ALTER TABLE projects ADD COLUMN deleted_at INTEGER;",
            kind: MigrationKind::Up,
        },
        // v17/v18, rótulo de cor (hex ou NULL) por conversa e por projeto.
        Migration {
            version: 17,
            description: "conversations_color",
            sql: "ALTER TABLE conversations ADD COLUMN color TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "projects_color",
            sql: "ALTER TABLE projects ADD COLUMN color TEXT;",
            kind: MigrationKind::Up,
        },
        // v19, worktree isolado por conversa (NULL = compartilha a pasta do projeto).
        Migration {
            version: 19,
            description: "conversations_worktree_path",
            sql: "ALTER TABLE conversations ADD COLUMN worktree_path TEXT;",
            kind: MigrationKind::Up,
        },
        // v20/21, custo por ENTREGA: cada etapa SDD dirigida pelo cockpit vira
        // uma linha (o join com o manifest responde "quanto custou a feature").
        Migration {
            version: 20,
            description: "stage_runs",
            sql: "CREATE TABLE IF NOT EXISTS stage_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL, skill TEXT NOT NULL, agent TEXT NOT NULL, model TEXT, ok INTEGER NOT NULL, cost_usd REAL, cost_source TEXT, duration_ms INTEGER, created_at INTEGER NOT NULL);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "stage_runs_idx",
            sql: "CREATE INDEX IF NOT EXISTS idx_stage_runs_plan ON stage_runs(project_id, slug);",
            kind: MigrationKind::Up,
        },
        // v22, ledger de custo POR TURNO de chat linear (o gasto real que o strip
        // "hoje/7d" não via — só missões gravavam deliveries). run_id como PK:
        // o CLI emite results parciais na mesma invocação; o REPLACE por run_id
        // colapsa nos totais finais do turno (mesmo racional do reducer do chat).
        Migration {
            version: 22,
            description: "turn_costs",
            sql: "CREATE TABLE IF NOT EXISTS turn_costs (run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, conv_id TEXT NOT NULL, agent TEXT NOT NULL, model TEXT, cost_usd REAL, cost_source TEXT, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cache_tokens INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "turn_costs_time_idx",
            sql: "CREATE INDEX IF NOT EXISTS idx_turn_costs_time ON turn_costs(created_at);",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_decorum::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Backup rotativo do banco ANTES de qualquer escrita da sessão (o
            // plugin SQL só abre depois, então db+wal+shm estão quiescentes).
            // Rede de segurança contra corrupção/perda: nunca bloqueia o boot.
            if let Err(e) = backup_database(app.handle()) {
                log::warn!("backup do banco falhou (seguindo sem): {e}");
            }

            // Catálogo de preços (models.dev): registra onde fica o cache em
            // disco p/ o pricing achar preços dinâmicos já na 1ª consulta.
            catalog::init(app.handle());

            // Titlebar overlay (decorum): visual unificado + traffic lights encaixados +
            // drag funcionando (sem o bug do Overlay nativo).
            let main_window = app
                .get_webview_window("main")
                .ok_or("janela main ausente")?;
            main_window.create_overlay_titlebar()?;
            // Semáforos centrados no header de 56px (h-14). Valor calibrado por
            // medição no app (o inset do decorum NÃO é o centro do botão).
            // O decorum reaplica a CONSTANTE (y=16) no observer de resize dele →
            // reaplicamos o nosso a cada evento de janela (ver on_window_event),
            // que roda DEPOIS (o delegate do decorum chama super = Tauri).
            #[cfg(target_os = "macos")]
            main_window.set_traffic_lights_inset(18.0, TRAFFIC_LIGHTS_Y)?;

            // Tray: o app vive na barra de menu com a janela fechada (as
            // automações agendadas continuam); só "Sair" encerra de verdade.
            tray::create(app.handle())?;

            Ok(())
        })
        // Fechar a janela = esconder (app segue vivo no tray). Cmd+Q / "Sair"
        // do tray NÃO passam por aqui (viram ExitRequested) e encerram normal.
        .on_window_event(|window, event| {
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
                        let _ = w.set_traffic_lights_inset(18.0, TRAFFIC_LIGHTS_Y);
                    }
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if tray::should_keep_in_tray(window.app_handle()) {
                        tray::hide_main_window(window);
                        tray::notify_window_hidden(window.app_handle());
                    } else {
                        // Mesma proteção do "Sair" da tray: com agents em voo,
                        // confirma antes do exit(0) matar os runs (kill_all).
                        tray::request_quit(window.app_handle());
                    }
                }
            } else if window.label() == tray::POPOVER_LABEL {
                match event {
                    tauri::WindowEvent::Focused(false) => {
                        tray::mark_popover_blur_hidden(window.app_handle());
                        let _ = window.hide();
                    }
                    // Cmd+W (menu padrão do macOS) DESTRUIRIA o webview e o
                    // popover nunca é recriado (create só roda no setup).
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    _ => {}
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:mycockpit.db", migrations)
                .build(),
        )
        .manage(agent::RunRegistry::default())
        .manage(tray::TrayState::default())
        .manage(attachments::ActiveConvs::default())
        .manage(stt::SttSession::default())
        .manage(companion::CompanionState::default())
        // aprovação granular inline: registro compartilhado (listener por-run +
        // comando answer_approval) dos pedidos pendentes. Arc: o mesmo mapa é lido
        // pelas conexões do socket e pelo comando que entrega a decisão do usuário.
        .manage(std::sync::Arc::new(approval::PendingApprovals::default()))
        .invoke_handler(tauri::generate_handler![
            agent::run_agent,
            agent::cancel_agent,
            approval::answer_interaction,
            approval::answer_approval,
            agent::suggest,
            agent::judge,
            context::read_project_context,
            detect::detect_agents,
            detect::list_agy_models,
            catalog::refresh_models_catalog,
            catalog::get_models_catalog,
            mycockpit::read_mycockpit_config,
            mycockpit::write_mycockpit_config,
            mycockpit::export_conv_context,
            sources::read_project_sources,
            sources::read_text_file,
            sources::read_project_commands,
            sources::list_project_files,
            sdd::read_sdd_plans,
            sdd::pr_info,
            sdd::sdd_ready,
            sdd::seed_sdd,
            sdd::approve_prd,
            sdd::create_plan,
            sdd::set_plan_stage,
            skills::write_skill,
            git::git_diff,
            git::create_worktree,
            git::remove_worktree,
            git::git_commit,
            git::git_create_pr,
            git::pr_context,
            github::gh_pr_view,
            github::gh_pr_merge,
            tray::set_tray_snapshot,
            tray::get_tray_snapshot,
            tray::set_tray_preferences,
            tray::tray_action,
            tray::force_quit,
            stt::stt_start,
            stt::stt_stop,
            stt::stt_cancel,
            attachments::save_attachment,
            attachments::attach_path,
            attachments::delete_attachment,
            attachments::read_attachment,
            attachments::gc_attachments,
            attachments::wipe_conv_attachments,
            companion::companion_start,
            companion::companion_stop,
            companion::companion_status,
            companion::companion_revoke_token,
            companion::set_companion_snapshot,
            companion::companion_conv_updated
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Saída do app com run em voo: mata os CLIs de agent (senão ficam
            // órfãos rodando headless, editando repo e gastando, sem UI).
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                app_handle.state::<agent::RunRegistry>().kill_all();
            }
        });
}
