//! Persistência incremental do transcript.
//!
//! O frontend manda somente os itens cuja identidade mudou. Esta fronteira
//! abre uma transação SQLite própria para que linhas e marcador de contagem
//! sejam publicados juntos: crash antes do commit preserva a revisão anterior.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::Manager;

const MAX_CHANGE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationItemChange {
    position: u32,
    item_id: String,
    item_json: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationItemsSnapshot {
    revision: u64,
    items: Vec<String>,
}

fn database_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("mycockpit.db"))
        .map_err(|error| error.to_string())
}

fn save_changes(
    connection: &mut Connection,
    conversation_id: &str,
    changes: Vec<ConversationItemChange>,
    item_count: u32,
    replace_all: bool,
) -> Result<u64, String> {
    let tx = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let previous = tx
        .query_row(
            "SELECT revision FROM conversation_item_state WHERE conversation_id = ?1",
            [conversation_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or(0);
    let revision = previous.saturating_add(1);

    if replace_all {
        tx.execute(
            "DELETE FROM conversation_items WHERE conversation_id = ?1",
            [conversation_id],
        )
        .map_err(|error| error.to_string())?;
    }
    {
        let mut statement = tx
            .prepare(
                "INSERT INTO conversation_items (conversation_id, position, item_id, item_json, revision, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
                 ON CONFLICT(conversation_id, position) DO UPDATE SET \
                   item_id = excluded.item_id, item_json = excluded.item_json, \
                   revision = excluded.revision, updated_at = excluded.updated_at",
            )
            .map_err(|error| error.to_string())?;
        let now = crate::run_resources::epoch_ms() as i64;
        for change in changes {
            statement
                .execute(params![
                    conversation_id,
                    change.position,
                    change.item_id,
                    change.item_json,
                    revision,
                    now
                ])
                .map_err(|error| error.to_string())?;
        }
    }
    tx.execute(
        "DELETE FROM conversation_items WHERE conversation_id = ?1 AND position >= ?2",
        params![conversation_id, item_count],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "INSERT INTO conversation_item_state (conversation_id, revision, item_count, updated_at) \
         VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(conversation_id) DO UPDATE SET revision = excluded.revision, \
           item_count = excluded.item_count, updated_at = excluded.updated_at",
        params![
            conversation_id,
            revision,
            item_count,
            crate::run_resources::epoch_ms() as i64
        ],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(revision as u64)
}

fn load_snapshot(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Option<ConversationItemsSnapshot>, String> {
    let state = connection
        .query_row(
            "SELECT revision, item_count FROM conversation_item_state WHERE conversation_id = ?1",
            [conversation_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, u32>(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((revision, item_count)) = state else {
        return Ok(None);
    };
    let mut statement = connection
        .prepare(
            "SELECT position, item_id, item_json FROM conversation_items \
             WHERE conversation_id = ?1 AND position < ?2 ORDER BY position ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![conversation_id, item_count], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut items = Vec::with_capacity(item_count as usize);
    for (expected, row) in rows.enumerate() {
        let (position, item_id, item_json) = row.map_err(|error| error.to_string())?;
        if position as usize != expected {
            return Ok(None);
        }
        let parsed: serde_json::Value =
            serde_json::from_str(&item_json).map_err(|error| error.to_string())?;
        if parsed.get("id").and_then(serde_json::Value::as_str) != Some(item_id.as_str()) {
            return Ok(None);
        }
        items.push(item_json);
    }
    if items.len() != item_count as usize {
        return Ok(None);
    }
    Ok(Some(ConversationItemsSnapshot {
        revision: revision.max(0) as u64,
        items,
    }))
}

#[tauri::command]
pub async fn save_conversation_item_changes(
    app: tauri::AppHandle,
    conversation_id: String,
    changes: Vec<ConversationItemChange>,
    item_count: u32,
    replace_all: bool,
) -> Result<u64, String> {
    if conversation_id.trim().is_empty() {
        return Err("conversa inválida".into());
    }
    let bytes = changes
        .iter()
        .try_fold(0usize, |total, change| {
            total.checked_add(change.item_json.len() + change.item_id.len())
        })
        .ok_or("lote incremental grande demais")?;
    if bytes > MAX_CHANGE_BYTES {
        return Err("lote incremental excedeu 64 MiB".into());
    }
    if changes.iter().any(|change| change.position >= item_count) {
        return Err("posição de item fora da contagem declarada".into());
    }
    let path = database_path(&app)?;
    tokio::task::spawn_blocking(move || {
        let mut connection = Connection::open(path).map_err(|error| error.to_string())?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|error| error.to_string())?;
        save_changes(
            &mut connection,
            &conversation_id,
            changes,
            item_count,
            replace_all,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn load_conversation_items(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<Option<ConversationItemsSnapshot>, String> {
    let path = database_path(&app)?;
    tokio::task::spawn_blocking(move || {
        let connection = Connection::open(path).map_err(|error| error.to_string())?;
        load_snapshot(&connection, &conversation_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE conversations (id TEXT PRIMARY KEY); \
                 INSERT INTO conversations (id) VALUES ('c1'); \
                 CREATE TABLE conversation_items ( \
                   conversation_id TEXT NOT NULL, position INTEGER NOT NULL, \
                   item_id TEXT NOT NULL, item_json TEXT NOT NULL, revision INTEGER NOT NULL, \
                   updated_at INTEGER NOT NULL, PRIMARY KEY (conversation_id, position)); \
                 CREATE TABLE conversation_item_state ( \
                   conversation_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, \
                   item_count INTEGER NOT NULL, updated_at INTEGER NOT NULL);",
            )
            .unwrap();
        connection
    }

    fn change(position: u32, id: &str, text: &str) -> ConversationItemChange {
        ConversationItemChange {
            position,
            item_id: id.into(),
            item_json: serde_json::json!({ "kind": "text", "id": id, "text": text }).to_string(),
        }
    }

    #[test]
    fn bootstrap_e_delta_reconstroem_a_ordem_exata() {
        let mut connection = database();
        assert_eq!(
            save_changes(
                &mut connection,
                "c1",
                vec![change(0, "a", "um"), change(1, "b", "dois")],
                2,
                true,
            )
            .unwrap(),
            1
        );
        assert_eq!(
            save_changes(
                &mut connection,
                "c1",
                vec![change(1, "b", "dois atualizado")],
                2,
                false,
            )
            .unwrap(),
            2
        );
        let snapshot = load_snapshot(&connection, "c1").unwrap().unwrap();
        assert_eq!(snapshot.revision, 2);
        assert_eq!(snapshot.items.len(), 2);
        assert!(snapshot.items[0].contains("\"text\":\"um\""));
        assert!(snapshot.items[1].contains("dois atualizado"));
    }

    #[test]
    fn estado_incompleto_degrada_para_o_snapshot_legado() {
        let mut connection = database();
        save_changes(
            &mut connection,
            "c1",
            vec![change(0, "a", "um"), change(1, "b", "dois")],
            2,
            true,
        )
        .unwrap();
        connection
            .execute(
                "DELETE FROM conversation_items WHERE conversation_id = 'c1' AND position = 1",
                [],
            )
            .unwrap();
        assert!(load_snapshot(&connection, "c1").unwrap().is_none());
    }
}
