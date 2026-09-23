//! "O agente pode ligar o navegador deste projeto" (ADR-228).
//!
//! Ligar o navegador do projeto é gesto da pessoa (ADR-224 §1, ADR-147): é um
//! Chromium com o perfil do projeto, sessões e logins. Esta é a forma de a
//! pessoa dar esse gesto UMA vez, por projeto, visível em Configurações e
//! revogável a qualquer momento. Sem a linha, nada muda: o agente pede e
//! espera. Com ela, o agente liga e a tela diz que foi ele.

use rusqlite::OptionalExtension;

/// A pessoa autorizou o agente a ligar o navegador deste projeto? Falha de
/// leitura (banco indisponível, tabela ainda não migrada) é "não": sem prova
/// da autorização, o agente pede.
pub fn pode_ligar(app: &tauri::AppHandle, project_id: &str) -> bool {
    let Ok(conn) = crate::mcp_control::db(app) else {
        return false;
    };
    conn.query_row(
        "SELECT 1 FROM browser_agent_start WHERE project_id = ?1",
        [project_id],
        |_| Ok(()),
    )
    .optional()
    .ok()
    .flatten()
    .is_some()
}

#[tauri::command]
pub fn browser_agente_pode_ligar(app: tauri::AppHandle, project_path: String) -> Result<bool, String> {
    let project_id = crate::browser::project_id_of(&app, &project_path)?;
    Ok(pode_ligar(&app, &project_id))
}

#[tauri::command]
pub fn set_browser_agente_pode_ligar(
    app: tauri::AppHandle,
    project_path: String,
    permitido: bool,
) -> Result<bool, String> {
    let project_id = crate::browser::project_id_of(&app, &project_path)?;
    let conn = crate::mcp_control::db(&app)?;
    if permitido {
        let agora = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        conn.execute(
            "INSERT OR REPLACE INTO browser_agent_start (project_id, granted_at) VALUES (?1, ?2)",
            rusqlite::params![project_id, agora],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute("DELETE FROM browser_agent_start WHERE project_id = ?1", [&project_id])
            .map_err(|e| e.to_string())?;
    }
    Ok(pode_ligar(&app, &project_id))
}
