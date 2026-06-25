use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
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
    }];

    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:mycockpit.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
