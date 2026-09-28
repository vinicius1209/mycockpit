//! "Quem alterou" do cartão de hover (docs/explorador-de-arquivos-prd.md, D2b):
//! as ações de tool de qualquer conversa do projeto que citam o caminho, cada
//! uma com o motor do TURNO que a fez. A régua de alteração × leitura é a do
//! fio e mora no front (`classificarAcao`); aqui só se acha e se atribui.
//!
//! O motor vem de três camadas, da mais forte para a mais fraca: o carimbo
//! `agent` do item; o custo do turno (a primeira linha de `turn_costs` da
//! conversa depois da ação e antes da próxima fala da pessoa); o turno vizinho,
//! se o de antes e o de depois concordam; e por fim o motor atual da conversa.

use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

/// Os mais recentes. O corpo de resultado nunca sai daqui (PRD, 5b).
const MAX_CANDIDATOS: usize = 80;
/// Texto de entrada maior que isto não é caminho: é conteúdo, e fica.
const MAX_CAMPO: usize = 512;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Candidato {
    pub conversa_id: String,
    pub titulo: Option<String>,
    pub motor: String,
    /// "carimbo" | "custo" | "vizinho" | "conversa"
    pub fonte: String,
    pub nome: String,
    /// A entrada da tool só com os campos curtos (os caminhos).
    pub entrada: Value,
    pub quando: i64,
    /// Quando a ação terminou (o último evento dela), se o fio registrou.
    pub terminou: Option<i64>,
}

/// A entrada sem o conteúdo: só os campos de texto curtos. Puro.
pub(crate) fn entrada_enxuta(entrada: &Value) -> Value {
    match entrada {
        Value::Object(campos) => Value::Object(
            campos
                .iter()
                .filter(|(_, v)| matches!(v, Value::String(s) if s.len() <= MAX_CAMPO))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        ),
        Value::String(s) if s.len() <= MAX_CAMPO => entrada.clone(),
        _ => Value::Object(Default::default()),
    }
}

/// O motor de uma ação. `turnos`: (motor, hora do result) da conversa, em
/// ordem; `limite`: a hora da próxima fala da pessoa depois da ação. Puro.
pub(crate) fn motor_da_acao(
    carimbo: Option<&str>,
    quando: i64,
    limite: Option<i64>,
    turnos: &[(String, i64)],
    da_conversa: &str,
) -> (String, &'static str) {
    if let Some(m) = carimbo.filter(|m| !m.is_empty()) {
        return (m.to_string(), "carimbo");
    }
    let depois = turnos.iter().find(|(_, t)| *t >= quando);
    if let Some((m, t)) = depois {
        if limite.is_none_or(|l| *t <= l) {
            return (m.clone(), "custo");
        }
    }
    let antes = turnos.iter().rev().find(|(_, t)| *t < quando);
    if let (Some((a, _)), Some((d, _))) = (antes, depois) {
        if a == d {
            return (a.clone(), "vizinho");
        }
    }
    (da_conversa.to_string(), "conversa")
}

/// A frase do FTS para um caminho: entre aspas, aspas internas dobradas.
fn frase(rel: &str) -> String {
    format!("\"{}\"", rel.replace('"', "\"\""))
}

struct Linha {
    conversa: String,
    posicao: i64,
    item: Value,
    titulo: Option<String>,
    motor_da_conversa: String,
}

pub(crate) fn consultar(conn: &Connection, projeto: &str, rel: &str) -> Result<Vec<Candidato>, String> {
    // O trigram não casa menos de 3 caracteres.
    if rel.chars().count() < 3 {
        return Ok(vec![]);
    }
    let mut stmt = conn
        .prepare(
            "SELECT i.conversation_id, i.position, i.item_json, c.title, c.agent \
             FROM conversation_item_fts f \
             JOIN conversation_items i ON i.rowid = f.rowid \
             JOIN conversations c ON c.id = i.conversation_id \
             WHERE conversation_item_fts MATCH ?1 AND c.project_id = ?2 \
               AND json_extract(i.item_json, '$.kind') = 'tool' \
             ORDER BY json_extract(i.item_json, '$.ts') DESC",
        )
        .map_err(|e| e.to_string())?;
    let linhas = stmt
        .query_map(params![frase(rel), projeto], |r| {
            let json: String = r.get(2)?;
            Ok(Linha {
                conversa: r.get(0)?,
                posicao: r.get(1)?,
                item: serde_json::from_str(&json).unwrap_or(Value::Null),
                titulo: r.get(3)?,
                motor_da_conversa: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut saida = Vec::new();
    let mut turnos: HashMap<String, Vec<(String, i64)>> = HashMap::new();
    let mut falas: HashMap<String, Vec<(i64, i64)>> = HashMap::new();
    for linha in linhas {
        let l = linha.map_err(|e| e.to_string())?;
        // O caminho tem que estar na entrada, não só no resultado (um `grep`
        // que listou o arquivo não é ação sobre ele).
        let entrada = entrada_enxuta(&l.item["input"]);
        if !entrada.to_string().contains(rel) {
            continue;
        }
        let quando = l.item["ts"].as_i64().unwrap_or(0);
        let t = turnos.entry(l.conversa.clone()).or_insert_with(|| turnos_da(conn, &l.conversa));
        let f = falas.entry(l.conversa.clone()).or_insert_with(|| falas_da(conn, &l.conversa));
        let limite = f.iter().find(|(p, _)| *p > l.posicao).map(|(_, ts)| *ts);
        let (motor, fonte) = motor_da_acao(l.item["agent"].as_str(), quando, limite, t, &l.motor_da_conversa);
        saida.push(Candidato {
            conversa_id: l.conversa,
            titulo: l.titulo,
            motor,
            fonte: fonte.into(),
            nome: l.item["name"].as_str().unwrap_or("").to_string(),
            entrada,
            quando,
            terminou: l.item["activityAt"].as_i64(),
        });
        if saida.len() >= MAX_CANDIDATOS {
            break;
        }
    }
    Ok(saida)
}

fn turnos_da(conn: &Connection, conversa: &str) -> Vec<(String, i64)> {
    conn.prepare("SELECT agent, created_at FROM turn_costs WHERE conv_id = ?1 ORDER BY created_at")
        .and_then(|mut s| {
            s.query_map(params![conversa], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<Result<Vec<_>, _>>()
        })
        .unwrap_or_default()
}

/// (posição, hora) das falas da pessoa na conversa.
fn falas_da(conn: &Connection, conversa: &str) -> Vec<(i64, i64)> {
    conn.prepare(
        "SELECT position, json_extract(item_json, '$.ts') FROM conversation_items \
         WHERE conversation_id = ?1 AND json_extract(item_json, '$.kind') = 'user' ORDER BY position",
    )
    .and_then(|mut s| {
        s.query_map(params![conversa], |r| Ok((r.get(0)?, r.get::<_, Option<i64>>(1)?.unwrap_or(0))))?
            .collect::<Result<Vec<_>, _>>()
    })
    .unwrap_or_default()
}

#[tauri::command]
pub async fn quem_alterou(app: tauri::AppHandle, projeto: String, rel: String) -> Result<Vec<Candidato>, String> {
    use tauri::Manager;
    let banco = app.path().app_data_dir().map_err(|e| e.to_string())?.join(crate::BANCO);
    tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open_with_flags(&banco, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
            .map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(2)).map_err(|e| e.to_string())?;
        consultar(&conn, &projeto, &rel)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "quem_alterou_tests.rs"]
mod tests;
