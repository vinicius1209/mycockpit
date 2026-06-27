use tauri::Manager;
use tauri_plugin_decorum::WebviewWindowExt;
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

mod adapters;
mod agent;
mod context;
mod mycockpit;
mod pricing;
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
        // Split em 5 migrações de 1 statement — tauri-plugin-sql roda 1 por vez.
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
            let main_window = app.get_webview_window("main").unwrap();
            main_window.create_overlay_titlebar().unwrap();
            #[cfg(target_os = "macos")]
            main_window.set_traffic_lights_inset(16.0, 17.0).unwrap();

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:mycockpit.db", migrations)
                .build(),
        )
        .manage(agent::RunRegistry::default())
        .invoke_handler(tauri::generate_handler![
            agent::run_agent,
            agent::cancel_agent,
            agent::suggest,
            context::read_project_context,
            mycockpit::read_mycockpit_config,
            mycockpit::write_mycockpit_config,
            sources::read_project_sources,
            sources::read_text_file,
            sources::read_project_commands,
            sources::list_project_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
