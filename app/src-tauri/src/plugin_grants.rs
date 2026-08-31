//! Grants renováveis de plugins.
//!
//! Descobrir um pacote não muda estado. O único caminho que o torna elegível
//! grava a combinação exata `(plugin_key, fingerprint, capabilities)`. Mudança
//! de manifesto ou de qualquer arquivo do pacote invalida o grant sem executar
//! byte algum do pacote.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::plugin_manifest::PluginPackage;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum GrantStatus {
    Pending,
    Approved,
    Stale,
    Disabled,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GrantView {
    pub(crate) status: GrantStatus,
    /// Só é true quando o grant continua atual e está ligado.
    pub(crate) enabled: bool,
    pub(crate) reviewed_at: Option<i64>,
}

impl GrantView {
    pub(crate) fn pending() -> Self {
        Self {
            status: GrantStatus::Pending,
            enabled: false,
            reviewed_at: None,
        }
    }
}

#[derive(Clone, Debug)]
struct GrantRow {
    fingerprint: String,
    capabilities_json: String,
    enabled: bool,
    reviewed_at: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginAuditEvent {
    pub(crate) event: String,
    pub(crate) outcome: String,
    pub(crate) detail: Option<String>,
    pub(crate) created_at: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn canonical_capabilities(package: &PluginPackage) -> String {
    serde_json::to_string(&package.manifest.capability_names()).unwrap_or_else(|_| "[]".into())
}

fn row(conn: &Connection, plugin_key: &str) -> Result<Option<GrantRow>, String> {
    conn.query_row(
        "SELECT fingerprint, capabilities_json, enabled, reviewed_at
           FROM plugin_grants WHERE plugin_key = ?1",
        [plugin_key],
        |row| {
            Ok(GrantRow {
                fingerprint: row.get(0)?,
                capabilities_json: row.get(1)?,
                enabled: row.get::<_, i64>(2)? != 0,
                reviewed_at: row.get(3)?,
            })
        },
    )
    .optional()
    .map_err(|error| error.to_string())
}

pub(crate) fn view(conn: &Connection, package: &PluginPackage) -> Result<GrantView, String> {
    let Some(grant) = row(conn, &package.key())? else {
        return Ok(GrantView::pending());
    };
    let current = grant.fingerprint == package.fingerprint
        && grant.capabilities_json == canonical_capabilities(package);
    let status = if !current {
        GrantStatus::Stale
    } else if grant.enabled {
        GrantStatus::Approved
    } else {
        GrantStatus::Disabled
    };
    Ok(GrantView {
        status,
        enabled: current && grant.enabled,
        reviewed_at: Some(grant.reviewed_at),
    })
}

pub(crate) fn is_enabled(conn: &Connection, package: &PluginPackage) -> Result<bool, String> {
    view(conn, package).map(|grant| grant.status == GrantStatus::Approved && grant.enabled)
}

pub(crate) fn approve(
    conn: &Connection,
    package: &PluginPackage,
    reviewed_fingerprint: &str,
) -> Result<(), String> {
    if package.fingerprint != reviewed_fingerprint {
        return Err("o plugin mudou desde a revisão; atualize e revise novamente".into());
    }
    let transaction = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let now = now_ms();
    transaction
        .execute(
            "INSERT INTO plugin_grants
           (plugin_key, fingerprint, capabilities_json, enabled, reviewed_at, updated_at)
         VALUES (?1, ?2, ?3, 1, ?4, ?4)
         ON CONFLICT(plugin_key) DO UPDATE SET
           fingerprint=excluded.fingerprint,
           capabilities_json=excluded.capabilities_json,
           enabled=1,
           reviewed_at=excluded.reviewed_at,
           updated_at=excluded.updated_at",
            params![
                package.key(),
                package.fingerprint,
                canonical_capabilities(package),
                now
            ],
        )
        .map_err(|error| error.to_string())?;
    audit(
        &transaction,
        &package.key(),
        "grant",
        "approved",
        None,
        Some(&package.fingerprint),
    )?;
    transaction.commit().map_err(|error| error.to_string())
}

pub(crate) fn set_enabled(
    conn: &Connection,
    package: &PluginPackage,
    enabled: bool,
) -> Result<(), String> {
    let grant = view(conn, package)?;
    if enabled && !matches!(grant.status, GrantStatus::Approved | GrantStatus::Disabled) {
        return Err("revise as permissões atuais antes de habilitar este plugin".into());
    }
    let transaction = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let changed = transaction
        .execute(
            "UPDATE plugin_grants SET enabled = ?1, updated_at = ?2
             WHERE plugin_key = ?3 AND fingerprint = ?4 AND capabilities_json = ?5",
            params![
                enabled as i64,
                now_ms(),
                package.key(),
                package.fingerprint,
                canonical_capabilities(package)
            ],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("o grant atual não existe; revise as permissões novamente".into());
    }
    audit(
        &transaction,
        &package.key(),
        "enablement",
        if enabled { "enabled" } else { "disabled" },
        None,
        Some(&package.fingerprint),
    )?;
    transaction.commit().map_err(|error| error.to_string())
}

pub(crate) fn revoke(conn: &Connection, plugin_key: &str) -> Result<(), String> {
    let transaction = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM plugin_grants WHERE plugin_key = ?1",
            [plugin_key],
        )
        .map_err(|error| error.to_string())?;
    audit(&transaction, plugin_key, "grant", "revoked", None, None)?;
    transaction.commit().map_err(|error| error.to_string())
}

fn capped_detail(detail: Option<&str>) -> Option<String> {
    detail.map(|value| value.chars().take(800).collect())
}

pub(crate) fn audit(
    conn: &Connection,
    plugin_key: &str,
    event: &str,
    outcome: &str,
    detail: Option<&str>,
    fingerprint: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO plugin_audit_events
           (plugin_key, event, outcome, detail, fingerprint, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            plugin_key,
            event,
            outcome,
            capped_detail(detail),
            fingerprint,
            now_ms()
        ],
    )
    .map_err(|error| error.to_string())?;
    // Limite global simples. A trilha explica incidentes recentes sem virar um
    // segundo transcript nem crescer indefinidamente.
    conn.execute(
        "DELETE FROM plugin_audit_events WHERE id NOT IN
           (SELECT id FROM plugin_audit_events ORDER BY id DESC LIMIT 2000)",
        [],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn recent(
    conn: &Connection,
    plugin_key: &str,
    limit: usize,
) -> Result<Vec<PluginAuditEvent>, String> {
    let mut statement = conn
        .prepare(
            "SELECT event, outcome, detail, created_at
               FROM plugin_audit_events WHERE plugin_key = ?1
              ORDER BY id DESC LIMIT ?2",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![plugin_key, limit.min(20) as i64], |row| {
            Ok(PluginAuditEvent {
                event: row.get(0)?,
                outcome: row.get(1)?,
                detail: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub(crate) fn grant_keys(conn: &Connection) -> Result<Vec<String>, String> {
    let mut statement = conn
        .prepare("SELECT plugin_key FROM plugin_grants ORDER BY plugin_key")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_manifest::{PluginContributions, PluginEngines, PluginManifest};
    use std::path::PathBuf;

    fn schema(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE plugin_grants (
               plugin_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
               capabilities_json TEXT NOT NULL, enabled INTEGER NOT NULL,
               reviewed_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
             );
             CREATE TABLE plugin_audit_events (
               id INTEGER PRIMARY KEY AUTOINCREMENT, plugin_key TEXT NOT NULL,
               event TEXT NOT NULL, outcome TEXT NOT NULL, detail TEXT,
               fingerprint TEXT, created_at INTEGER NOT NULL
             );",
        )
        .unwrap();
    }

    fn package(fingerprint: &str) -> PluginPackage {
        PluginPackage {
            root: PathBuf::from("/plugin"),
            fingerprint: fingerprint.into(),
            manifest: PluginManifest {
                schema: None,
                manifest_version: 1,
                plugin_api: 1,
                publisher: "acme".into(),
                id: "quality".into(),
                name: "Quality".into(),
                version: "1.0.0".into(),
                description: None,
                engines: PluginEngines {
                    frota: ">=0.1.0".into(),
                },
                main: None,
                capabilities: vec![],
                contributes: PluginContributions::default(),
            },
        }
    }

    #[test]
    fn grant_so_aprova_o_fingerprint_revisado_e_muda_vira_stale() {
        let conn = Connection::open_in_memory().unwrap();
        schema(&conn);
        let first = package("hash-1");
        approve(&conn, &first, "hash-1").unwrap();
        assert_eq!(view(&conn, &first).unwrap().status, GrantStatus::Approved);

        let changed = package("hash-2");
        assert_eq!(view(&conn, &changed).unwrap().status, GrantStatus::Stale);
        assert!(!is_enabled(&conn, &changed).unwrap());
        assert!(approve(&conn, &changed, "hash-1").is_err());
    }

    #[test]
    fn desabilitar_preserva_consentimento_e_revogar_apaga() {
        let conn = Connection::open_in_memory().unwrap();
        schema(&conn);
        let plugin = package("hash");
        approve(&conn, &plugin, "hash").unwrap();
        set_enabled(&conn, &plugin, false).unwrap();
        assert_eq!(view(&conn, &plugin).unwrap().status, GrantStatus::Disabled);
        revoke(&conn, &plugin.key()).unwrap();
        assert_eq!(view(&conn, &plugin).unwrap().status, GrantStatus::Pending);
    }

    #[test]
    fn falha_na_auditoria_reverte_a_mudanca_do_grant() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE plugin_grants (
               plugin_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
               capabilities_json TEXT NOT NULL, enabled INTEGER NOT NULL,
               reviewed_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
             );",
        )
        .unwrap();
        let plugin = package("hash");
        assert!(approve(&conn, &plugin, "hash").is_err());
        assert!(row(&conn, &plugin.key()).unwrap().is_none());
    }
}
