//! Conversas citadas com `@` (ADR-287): a porta do MCP de contexto para outra
//! conversa do MESMO projeto, aberta só no envio que a citou.
//!
//! A concessão chega pelo ambiente do servidor, como a conversa do turno, e é
//! exatamente o que a moldura do prompt disse ao agente que ele pode ler. Sem
//! citação, nada muda: a busca e a leitura continuam presas à conversa do
//! turno. "Todas as conversas deste projeto" (D13) só existe quando a pessoa
//! a menciona.

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};
use std::path::Path;

pub const CITADAS_ENV: &str = "FROTA_CONTEXT_CITADAS";
pub const TODAS_ENV: &str = "FROTA_CONTEXT_TODAS";
pub const TODAS: &str = "todas";

/// O que este envio pode ler além da própria conversa.
#[derive(Clone, Debug, Default, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Concessao {
    #[serde(default)]
    pub ids: Vec<String>,
    #[serde(default)]
    pub todas: bool,
}

impl Concessao {
    /// O par de variáveis que o servidor lê. Ids inválidos não viajam.
    pub fn ambiente(&self) -> [(&'static str, String); 2] {
        let ids: Vec<&str> = self.ids.iter().map(String::as_str).filter(|id| super::safe_conv_id(id).is_ok()).collect();
        [(CITADAS_ENV, ids.join(",")), (TODAS_ENV, if self.todas { "1".into() } else { String::new() })]
    }

    pub fn da_env() -> Concessao {
        let ids = std::env::var(CITADAS_ENV)
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|id| super::safe_conv_id(id).is_ok())
            .map(str::to_string)
            .collect();
        Concessao { ids, todas: std::env::var(TODAS_ENV).is_ok_and(|v| v == "1") }
    }
}

fn abrir(db: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| format!("SQLite indisponível: {e}"))
}

fn projeto_de(conn: &Connection, conv: &str) -> Option<String> {
    conn.query_row("SELECT project_id FROM conversations WHERE id = ?1", [conv], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

fn titulo_de(conn: &Connection, conv: &str) -> Option<String> {
    conn.query_row("SELECT title FROM conversations WHERE id = ?1", [conv], |r| r.get::<_, Option<String>>(0))
        .optional()
        .ok()
        .flatten()
        .flatten()
}

/// A conversa `pedida` pode ser lida neste envio? A do turno sempre; outra só
/// se foi citada, ou se "todas" foi citado e ela é do mesmo projeto.
pub fn permitir(conn: &Connection, atual: &str, pedida: &str, c: &Concessao) -> Result<(), String> {
    super::safe_conv_id(pedida)?;
    if pedida == atual {
        return Ok(());
    }
    let mesmo_projeto = || projeto_de(conn, pedida).is_some_and(|p| Some(p) == projeto_de(conn, atual));
    if c.ids.iter().any(|id| id == pedida) && mesmo_projeto() {
        return Ok(());
    }
    if c.todas && mesmo_projeto() {
        return Ok(());
    }
    Err("esta conversa não foi citada neste envio; peça à pessoa que a mencione com @ no composer".into())
}

/// As conversas que a busca varre: a pedida, ou todas as do projeto.
fn alvos(conn: &Connection, atual: &str, pedida: &str, c: &Concessao) -> Result<Vec<String>, String> {
    if pedida != TODAS {
        permitir(conn, atual, pedida, c)?;
        return Ok(vec![pedida.to_string()]);
    }
    if !c.todas {
        return Err("buscar em todas as conversas só vale quando a pessoa cita \"todas as conversas deste projeto\"".into());
    }
    let projeto = projeto_de(conn, atual).ok_or("não achei o projeto desta conversa")?;
    let mut st = conn
        .prepare("SELECT id FROM conversations WHERE project_id = ?1 AND id != ?2")
        .map_err(|e| e.to_string())?;
    let ids = st
        .query_map([projeto.as_str(), atual], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(ids)
}

/// `context_search` com `conversation`: a mesma busca, com o `ref` dizendo de
/// qual conversa é o item.
pub fn buscar(db: &Path, atual: &str, pedida: &str, query: &str, limit: usize, c: &Concessao) -> Result<String, String> {
    let conn = abrir(db)?;
    let mut juntos: Vec<(f64, Value)> = Vec::new();
    for id in alvos(&conn, atual, pedida, c)? {
        let titulo = titulo_de(&conn, &id);
        for mut hit in super::search_conversation(db, &id, query, limit)? {
            let pos = hit["ref"].as_str().and_then(|r| r.strip_prefix("conversation:item:")).unwrap_or("0").to_string();
            hit["ref"] = json!(format!("conversation:{id}:item:{pos}"));
            hit["conversation"] = json!({ "id": id, "title": titulo });
            juntos.push((hit["score"].as_f64().unwrap_or(0.0), hit));
        }
    }
    serde_json::to_string_pretty(&json!({
        "query": query,
        "conversation": pedida,
        "results": super::ordenar_e_cortar(juntos, limit),
        "hint": "Expanda com context_read(ref), usando o ref como veio."
    }))
    .map_err(|e| e.to_string())
}

/// `conversation:<id>:item:N` no `context_read`. `None` quando o ref é de
/// outro formato (a leitura segue o caminho de sempre).
pub fn ler(db: Option<&Path>, atual: &str, referencia: &str, max_chars: usize, c: &Concessao) -> Option<Result<String, String>> {
    let resto = referencia.strip_prefix("conversation:")?;
    let (id, pos) = resto.split_once(":item:")?;
    Some((|| {
        let db = db.ok_or("SQLite da Frota indisponível neste run")?;
        let index = pos.parse::<usize>().map_err(|_| "referência de conversa inválida".to_string())?;
        permitir(&abrir(db)?, atual, id, c)?;
        super::read_conversation_item(db, id, index, max_chars)
    })())
}

/// A frase da busca que diz ao agente o que está aberto neste envio.
pub fn aviso_da_busca(c: &Concessao) -> String {
    match (c.ids.len(), c.todas) {
        (0, false) => String::new(),
        (_, true) => " Neste envio a pessoa citou conversas deste projeto: passe conversation com o id citado, ou \"todas\" para buscar em todas as do projeto.".into(),
        _ => format!(" Neste envio a pessoa citou {} conversa(s) deste projeto: passe conversation com o id citado ({}).", c.ids.len(), c.ids.join(", ")),
    }
}

#[cfg(test)]
#[path = "context_citadas_tests.rs"]
mod tests;
