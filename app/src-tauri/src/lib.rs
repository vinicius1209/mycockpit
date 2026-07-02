use tauri::Manager;
use tauri_plugin_decorum::WebviewWindowExt;
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

mod adapters;
mod agent;
mod attachments;
mod context;
mod git;
mod mycockpit;
mod pricing;
mod sdd;
mod sources;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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

            // Titlebar overlay (decorum): visual unificado + traffic lights encaixados +
            // drag funcionando (sem o bug do Overlay nativo).
            let main_window = app
                .get_webview_window("main")
                .ok_or("janela main ausente")?;
            main_window.create_overlay_titlebar()?;
            #[cfg(target_os = "macos")]
            main_window.set_traffic_lights_inset(16.0, 17.0)?;

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:mycockpit.db", migrations)
                .build(),
        )
        .manage(agent::RunRegistry::default())
        .manage(attachments::ActiveConvs::default())
        .invoke_handler(tauri::generate_handler![
            agent::run_agent,
            agent::cancel_agent,
            agent::suggest,
            agent::judge,
            context::read_project_context,
            mycockpit::read_mycockpit_config,
            mycockpit::write_mycockpit_config,
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
            git::git_diff,
            git::create_worktree,
            git::remove_worktree,
            git::git_commit,
            git::git_create_pr,
            git::pr_context,
            attachments::save_attachment,
            attachments::attach_path,
            attachments::delete_attachment,
            attachments::read_attachment,
            attachments::gc_attachments,
            attachments::wipe_conv_attachments
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
