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

/// Migração 57 (`drop_conversation_item_fts_unicode61`). Migração é história: NÃO edite.
/// Os TRIGGERS sobrevivem: eles citam a tabela pelo nome e são resolvidos na
/// execução, então recriar com o mesmo nome e as mesmas colunas basta.
pub const FTS_DROP_UNICODE61: &str = "DROP TABLE IF EXISTS conversation_item_fts;";

/// Migração 58 (`create_conversation_item_fts_trigram`). Migração é história: NÃO edite.
///
/// `trigram` e não `unicode61` porque o corpus é CÓDIGO. O tokenizador quebra
/// em palavras e o prefixo é ancorado no início do token, então `useWatchdog`
/// vira o token `usewatchdog` e a busca por "watchdog" não acha — medido no
/// banco real: 11 de 33 itens perdidos em "interval", 59 de 195 em
/// "Conversations". O trigram casa SUBSTRING, que é exatamente a semântica do
/// `searchable_text` + `contains` da varredura, e devolve os mesmos itens.
///
/// Preço: o índice vai de 17,6MB para 41MB no corpus de referência. É o preço
/// de a busca achar identificador em camelCase, que é o caso de uso principal.
pub const FTS_CRIAR_TRIGRAM: &str = "CREATE VIRTUAL TABLE IF NOT EXISTS conversation_item_fts USING fts5( \
                    conversation_id UNINDEXED, item_id UNINDEXED, position UNINDEXED, \
                    text, tokenize='trigram remove_diacritics 1' \
                  );";

/// Migração 52 (`create_conversation_item_fts`). Migração é história: NÃO edite esta string.
/// Vive aqui, e não solta em `lib.rs`, para que os testes exercitem a SQL
/// EXATA que roda no banco da pessoa — gêmea que ninguém leu é gêmea que derivou.
pub const FTS_CRIAR_TABELA: &str = "CREATE VIRTUAL TABLE IF NOT EXISTS conversation_item_fts USING fts5( \
                    conversation_id UNINDEXED, item_id UNINDEXED, position UNINDEXED, \
                    text, tokenize='unicode61 remove_diacritics 2' \
                  );";

/// Migração 53 (`conversation_item_fts_ai`). Migração é história: NÃO edite esta string.
/// Vive aqui, e não solta em `lib.rs`, para que os testes exercitem a SQL
/// EXATA que roda no banco da pessoa — gêmea que ninguém leu é gêmea que derivou.
pub const FTS_TRIGGER_INSERT: &str = "CREATE TRIGGER IF NOT EXISTS conversation_item_fts_ai \
                  AFTER INSERT ON conversation_items BEGIN \
                    INSERT INTO conversation_item_fts(rowid, conversation_id, item_id, position, text) \
                    SELECT new.rowid, new.conversation_id, new.item_id, new.position, \
                  CASE json_extract(new.item_json,'$.kind') WHEN 'user' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'text' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'advice' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'result' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'error' THEN \
                  json_extract(new.item_json,'$.message') WHEN 'notice' THEN \
                  json_extract(new.item_json,'$.message') WHEN 'limit' THEN \
                  json_extract(new.item_json,'$.message') WHEN 'tool' THEN \
                  coalesce(json_extract(new.item_json,'$.name'),'tool') || ' ' || (CASE \
                  json_type(new.item_json,'$.input') WHEN 'text' THEN \
                  json_quote(json_extract(new.item_json,'$.input')) WHEN 'integer' THEN \
                  json_extract(new.item_json,'$.input') WHEN 'real' THEN \
                  json_extract(new.item_json,'$.input') WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' \
                  ELSE coalesce(json_extract(new.item_json,'$.input'),'null') END) || ' ' || (CASE \
                  json_type(new.item_json,'$.result.text') WHEN 'text' THEN \
                  json_extract(new.item_json,'$.result.text') ELSE '' END) ELSE NULL END \
                    WHERE CASE json_extract(new.item_json,'$.kind') WHEN 'user' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'text' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'advice' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'result' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'error' THEN \
                  json_extract(new.item_json,'$.message') WHEN 'notice' THEN \
                  json_extract(new.item_json,'$.message') WHEN 'limit' THEN \
                  json_extract(new.item_json,'$.message') WHEN 'tool' THEN \
                  coalesce(json_extract(new.item_json,'$.name'),'tool') || ' ' || (CASE \
                  json_type(new.item_json,'$.input') WHEN 'text' THEN \
                  json_quote(json_extract(new.item_json,'$.input')) WHEN 'integer' THEN \
                  json_extract(new.item_json,'$.input') WHEN 'real' THEN \
                  json_extract(new.item_json,'$.input') WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' \
                  ELSE coalesce(json_extract(new.item_json,'$.input'),'null') END) || ' ' || (CASE \
                  json_type(new.item_json,'$.result.text') WHEN 'text' THEN \
                  json_extract(new.item_json,'$.result.text') ELSE '' END) ELSE NULL END IS NOT NULL \
                      AND CASE json_extract(new.item_json,'$.kind') WHEN 'user' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'text' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'advice' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'result' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'error' THEN \
                  json_extract(new.item_json,'$.message') WHEN 'notice' THEN \
                  json_extract(new.item_json,'$.message') WHEN 'limit' THEN \
                  json_extract(new.item_json,'$.message') WHEN 'tool' THEN \
                  coalesce(json_extract(new.item_json,'$.name'),'tool') || ' ' || (CASE \
                  json_type(new.item_json,'$.input') WHEN 'text' THEN \
                  json_quote(json_extract(new.item_json,'$.input')) WHEN 'integer' THEN \
                  json_extract(new.item_json,'$.input') WHEN 'real' THEN \
                  json_extract(new.item_json,'$.input') WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' \
                  ELSE coalesce(json_extract(new.item_json,'$.input'),'null') END) || ' ' || (CASE \
                  json_type(new.item_json,'$.result.text') WHEN 'text' THEN \
                  json_extract(new.item_json,'$.result.text') ELSE '' END) ELSE NULL END <> ''; \
                  END;";

/// Migração 54 (`conversation_item_fts_au`). Migração é história: NÃO edite esta string.
/// Vive aqui, e não solta em `lib.rs`, para que os testes exercitem a SQL
/// EXATA que roda no banco da pessoa — gêmea que ninguém leu é gêmea que derivou.
pub const FTS_TRIGGER_UPDATE: &str = "CREATE TRIGGER IF NOT EXISTS conversation_item_fts_au \
                  AFTER UPDATE ON conversation_items \
                  WHEN old.item_json IS NOT new.item_json BEGIN \
                    DELETE FROM conversation_item_fts WHERE rowid = old.rowid; \
                    INSERT INTO conversation_item_fts(rowid, conversation_id, item_id, position, text) \
                    SELECT new.rowid, new.conversation_id, new.item_id, new.position, \
                  CASE json_extract(new.item_json,'$.kind') WHEN 'user' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'text' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'advice' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'result' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'error' THEN \
                  json_extract(new.item_json,'$.message') WHEN 'notice' THEN \
                  json_extract(new.item_json,'$.message') WHEN 'limit' THEN \
                  json_extract(new.item_json,'$.message') WHEN 'tool' THEN \
                  coalesce(json_extract(new.item_json,'$.name'),'tool') || ' ' || (CASE \
                  json_type(new.item_json,'$.input') WHEN 'text' THEN \
                  json_quote(json_extract(new.item_json,'$.input')) WHEN 'integer' THEN \
                  json_extract(new.item_json,'$.input') WHEN 'real' THEN \
                  json_extract(new.item_json,'$.input') WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' \
                  ELSE coalesce(json_extract(new.item_json,'$.input'),'null') END) || ' ' || (CASE \
                  json_type(new.item_json,'$.result.text') WHEN 'text' THEN \
                  json_extract(new.item_json,'$.result.text') ELSE '' END) ELSE NULL END \
                    WHERE CASE json_extract(new.item_json,'$.kind') WHEN 'user' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'text' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'advice' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'result' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'error' THEN \
                  json_extract(new.item_json,'$.message') WHEN 'notice' THEN \
                  json_extract(new.item_json,'$.message') WHEN 'limit' THEN \
                  json_extract(new.item_json,'$.message') WHEN 'tool' THEN \
                  coalesce(json_extract(new.item_json,'$.name'),'tool') || ' ' || (CASE \
                  json_type(new.item_json,'$.input') WHEN 'text' THEN \
                  json_quote(json_extract(new.item_json,'$.input')) WHEN 'integer' THEN \
                  json_extract(new.item_json,'$.input') WHEN 'real' THEN \
                  json_extract(new.item_json,'$.input') WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' \
                  ELSE coalesce(json_extract(new.item_json,'$.input'),'null') END) || ' ' || (CASE \
                  json_type(new.item_json,'$.result.text') WHEN 'text' THEN \
                  json_extract(new.item_json,'$.result.text') ELSE '' END) ELSE NULL END IS NOT NULL \
                      AND CASE json_extract(new.item_json,'$.kind') WHEN 'user' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'text' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'advice' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'result' THEN \
                  json_extract(new.item_json,'$.text') WHEN 'error' THEN \
                  json_extract(new.item_json,'$.message') WHEN 'notice' THEN \
                  json_extract(new.item_json,'$.message') WHEN 'limit' THEN \
                  json_extract(new.item_json,'$.message') WHEN 'tool' THEN \
                  coalesce(json_extract(new.item_json,'$.name'),'tool') || ' ' || (CASE \
                  json_type(new.item_json,'$.input') WHEN 'text' THEN \
                  json_quote(json_extract(new.item_json,'$.input')) WHEN 'integer' THEN \
                  json_extract(new.item_json,'$.input') WHEN 'real' THEN \
                  json_extract(new.item_json,'$.input') WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' \
                  ELSE coalesce(json_extract(new.item_json,'$.input'),'null') END) || ' ' || (CASE \
                  json_type(new.item_json,'$.result.text') WHEN 'text' THEN \
                  json_extract(new.item_json,'$.result.text') ELSE '' END) ELSE NULL END <> ''; \
                  END;";

/// Migração 55 (`conversation_item_fts_ad`). Migração é história: NÃO edite esta string.
/// Vive aqui, e não solta em `lib.rs`, para que os testes exercitem a SQL
/// EXATA que roda no banco da pessoa — gêmea que ninguém leu é gêmea que derivou.
pub const FTS_TRIGGER_DELETE: &str = "CREATE TRIGGER IF NOT EXISTS conversation_item_fts_ad \
                  AFTER DELETE ON conversation_items BEGIN \
                    DELETE FROM conversation_item_fts WHERE rowid = old.rowid; \
                  END;";

/// Migração 56 (`backfill_conversation_item_fts`). Migração é história: NÃO edite esta string.
/// Vive aqui, e não solta em `lib.rs`, para que os testes exercitem a SQL
/// EXATA que roda no banco da pessoa — gêmea que ninguém leu é gêmea que derivou.
pub const FTS_BACKFILL: &str = "INSERT INTO conversation_item_fts(rowid, conversation_id, item_id, position, text) \
                  SELECT i.rowid, i.conversation_id, i.item_id, i.position, \
                  CASE json_extract(i.item_json,'$.kind') WHEN 'user' THEN \
                  json_extract(i.item_json,'$.text') WHEN 'text' THEN json_extract(i.item_json,'$.text') \
                  WHEN 'advice' THEN json_extract(i.item_json,'$.text') WHEN 'result' THEN \
                  json_extract(i.item_json,'$.text') WHEN 'error' THEN \
                  json_extract(i.item_json,'$.message') WHEN 'notice' THEN \
                  json_extract(i.item_json,'$.message') WHEN 'limit' THEN \
                  json_extract(i.item_json,'$.message') WHEN 'tool' THEN \
                  coalesce(json_extract(i.item_json,'$.name'),'tool') || ' ' || (CASE \
                  json_type(i.item_json,'$.input') WHEN 'text' THEN \
                  json_quote(json_extract(i.item_json,'$.input')) WHEN 'integer' THEN \
                  json_extract(i.item_json,'$.input') WHEN 'real' THEN json_extract(i.item_json,'$.input') \
                  WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE \
                  coalesce(json_extract(i.item_json,'$.input'),'null') END) || ' ' || (CASE \
                  json_type(i.item_json,'$.result.text') WHEN 'text' THEN \
                  json_extract(i.item_json,'$.result.text') ELSE '' END) ELSE NULL END \
                  FROM conversation_items i \
                  WHERE CASE json_extract(i.item_json,'$.kind') WHEN 'user' THEN \
                  json_extract(i.item_json,'$.text') WHEN 'text' THEN json_extract(i.item_json,'$.text') \
                  WHEN 'advice' THEN json_extract(i.item_json,'$.text') WHEN 'result' THEN \
                  json_extract(i.item_json,'$.text') WHEN 'error' THEN \
                  json_extract(i.item_json,'$.message') WHEN 'notice' THEN \
                  json_extract(i.item_json,'$.message') WHEN 'limit' THEN \
                  json_extract(i.item_json,'$.message') WHEN 'tool' THEN \
                  coalesce(json_extract(i.item_json,'$.name'),'tool') || ' ' || (CASE \
                  json_type(i.item_json,'$.input') WHEN 'text' THEN \
                  json_quote(json_extract(i.item_json,'$.input')) WHEN 'integer' THEN \
                  json_extract(i.item_json,'$.input') WHEN 'real' THEN json_extract(i.item_json,'$.input') \
                  WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE \
                  coalesce(json_extract(i.item_json,'$.input'),'null') END) || ' ' || (CASE \
                  json_type(i.item_json,'$.result.text') WHEN 'text' THEN \
                  json_extract(i.item_json,'$.result.text') ELSE '' END) ELSE NULL END IS NOT NULL \
                    AND CASE json_extract(i.item_json,'$.kind') WHEN 'user' THEN \
                  json_extract(i.item_json,'$.text') WHEN 'text' THEN json_extract(i.item_json,'$.text') \
                  WHEN 'advice' THEN json_extract(i.item_json,'$.text') WHEN 'result' THEN \
                  json_extract(i.item_json,'$.text') WHEN 'error' THEN \
                  json_extract(i.item_json,'$.message') WHEN 'notice' THEN \
                  json_extract(i.item_json,'$.message') WHEN 'limit' THEN \
                  json_extract(i.item_json,'$.message') WHEN 'tool' THEN \
                  coalesce(json_extract(i.item_json,'$.name'),'tool') || ' ' || (CASE \
                  json_type(i.item_json,'$.input') WHEN 'text' THEN \
                  json_quote(json_extract(i.item_json,'$.input')) WHEN 'integer' THEN \
                  json_extract(i.item_json,'$.input') WHEN 'real' THEN json_extract(i.item_json,'$.input') \
                  WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE \
                  coalesce(json_extract(i.item_json,'$.input'),'null') END) || ' ' || (CASE \
                  json_type(i.item_json,'$.result.text') WHEN 'text' THEN \
                  json_extract(i.item_json,'$.result.text') ELSE '' END) ELSE NULL END <> '' \
                    AND NOT EXISTS (SELECT 1 FROM conversation_item_fts f WHERE f.rowid = i.rowid);";

fn database_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(crate::BANCO))
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

    // O `replace_all` NÃO apaga a conversa antes de reinserir, de propósito. O
    // apagão era redundante: com replace_all o change-set cobre todas as posições
    // `0..n-1` (lib/db/conversationItems.ts, `itemChanges`), o upsert abaixo
    // reescreve cada uma, e o `DELETE ... position >= item_count` no fim remove a
    // cauda que sobrou. Redundante e caro: desde o índice léxico (ADR-213) os
    // triggers de `conversation_item_fts` acompanham cada linha, então apagar tudo
    // fazia o persist reindexar a conversa inteira — 3.310ms contra 8ms medidos numa
    // conversa de 3.286 itens.
    //
    // O que era garantido pelo apagão agora é COBRADO: `replace_all` promete um
    // change-set completo, e a promessa é verificada antes de escrever. Fail-closed
    // no efeito — snapshot furado aborta em vez de deixar item velho sobrevivendo
    // numa posição que ninguém reescreveu.
    if replace_all {
        let mut cobertas = vec![false; item_count as usize];
        for change in &changes {
            if let Some(slot) = cobertas.get_mut(change.position as usize) {
                *slot = true;
            }
        }
        if let Some(faltando) = cobertas.iter().position(|coberta| !coberta) {
            return Err(format!(
                "snapshot incompleto: posição {faltando} de {item_count} não veio no change-set"
            ));
        }
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

/// Os itens da conversa para quem lê o banco por fora do front (busca do
/// `frota-context`, leitura de item, Companion). A fonte é a itemizada: desde
/// o ADR-230 o blob `conversations.items` deixou de ser gravado e é esvaziado
/// depois de a conversa entrar na fonte nova. Ele só responde por conversa
/// que ainda não entrou nela (sem linha de estado, ou banco sem as tabelas).
pub fn itens_da_conversa(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    // Tabela ausente (banco anterior à fonte itemizada) = não há snapshot.
    if let Ok(Some(snapshot)) = load_snapshot(connection, conversation_id) {
        return snapshot
            .items
            .iter()
            .map(|json| serde_json::from_str(json).map_err(|e| format!("histórico corrompido: {e}")))
            .collect();
    }
    let blob: String = connection
        .query_row(
            "SELECT items FROM conversations WHERE id = ?1",
            [conversation_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("conversa não encontrada no SQLite: {e}"))?;
    serde_json::from_str(&blob).map_err(|e| format!("histórico corrompido: {e}"))
}

/// Consolidação do histórico no boot (ADR-230): a fonte itemizada passa a ser
/// a ÚNICA. Roda antes do plugin SQL abrir o banco e depois do backup diário.
///
/// 1. Conversa que só existia no blob entra na fonte itemizada agora (antes
///    entrava só quando a pessoa a abria, e 7 das 22 nunca tinham entrado).
///    Blob ilegível, vazio ou com item sem `id` fica como está: o carregamento
///    exige o `id` de cada linha, e gravar pela metade seria perder histórico.
/// 2. O blob de toda conversa com snapshot VÁLIDO (o mesmo `load_snapshot`
///    que o carregamento usa) é esvaziado. Ninguém mais o grava, e guardar a
///    cópia velha seria ter duas verdades.
///
/// Banco sem as tabelas (instalação nova, antes do front criá-las) não faz
/// nada. Devolve (itemizadas, esvaziadas).
pub fn consolidar_historico(connection: &mut Connection) -> Result<(usize, usize), String> {
    let tem_tabelas: i64 = connection
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' \
             AND name IN ('conversation_items', 'conversation_item_state')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if tem_tabelas < 2 {
        return Ok((0, 0));
    }
    let legadas: Vec<(String, String)> = {
        let mut consulta = connection
            .prepare(
                "SELECT id, items FROM conversations c WHERE items <> '[]' AND NOT EXISTS \
                 (SELECT 1 FROM conversation_item_state s WHERE s.conversation_id = c.id)",
            )
            .map_err(|e| e.to_string())?;
        let linhas = consulta
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        linhas.filter_map(Result::ok).collect()
    };
    let mut itemizadas = 0;
    for (id, blob) in legadas {
        let Ok(serde_json::Value::Array(itens)) = serde_json::from_str::<serde_json::Value>(&blob) else {
            log::warn!("histórico da conversa {id} ilegível no blob; fica como está");
            continue;
        };
        if itens.is_empty() {
            continue;
        }
        let changes: Option<Vec<ConversationItemChange>> = itens
            .iter()
            .enumerate()
            .map(|(position, item)| {
                Some(ConversationItemChange {
                    position: position as u32,
                    item_id: item.get("id")?.as_str()?.to_string(),
                    item_json: item.to_string(),
                })
            })
            .collect();
        let Some(changes) = changes else {
            log::warn!("conversa {id} tem item sem id no blob; fica como está");
            continue;
        };
        let total = changes.len() as u32;
        save_changes(connection, &id, changes, total, true)?;
        itemizadas += 1;
    }
    let com_blob: Vec<String> = {
        let mut consulta = connection
            .prepare("SELECT id FROM conversations WHERE items <> '[]'")
            .map_err(|e| e.to_string())?;
        let linhas = consulta
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        linhas.filter_map(Result::ok).collect()
    };
    let mut esvaziadas = 0;
    for id in com_blob {
        if !matches!(load_snapshot(connection, &id), Ok(Some(ref s)) if !s.items.is_empty()) {
            continue;
        }
        connection
            .execute("UPDATE conversations SET items = '[]' WHERE id = ?1", [&id])
            .map_err(|e| e.to_string())?;
        esvaziadas += 1;
    }
    Ok((itemizadas, esvaziadas))
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
    fn leitores_de_fora_leem_a_fonte_itemizada_e_o_blob_so_sem_ela() {
        let mut connection = database();
        connection
            .execute_batch(
                "ALTER TABLE conversations ADD COLUMN items TEXT NOT NULL DEFAULT '[]'; \
                 INSERT INTO conversations (id, items) VALUES ('antiga', '[{\"kind\":\"user\",\"id\":\"u1\",\"text\":\"so no blob\"}]');",
            )
            .unwrap();
        // itemizada: o blob já foi esvaziado e não importa
        save_changes(&mut connection, "c1", vec![change(0, "a", "um"), change(1, "b", "dois")], 2, true).unwrap();
        let itens = itens_da_conversa(&connection, "c1").unwrap();
        assert_eq!(itens.len(), 2);
        assert_eq!(itens[1]["text"], "dois");
        // ainda não itemizada: o blob responde
        let antiga = itens_da_conversa(&connection, "antiga").unwrap();
        assert_eq!(antiga[0]["text"], "so no blob");
        assert!(itens_da_conversa(&connection, "nao-existe").is_err());
    }

    #[test]
    fn consolidar_itemiza_quem_so_tinha_blob_e_esvazia_o_blob_de_quem_tem_snapshot() {
        let mut connection = database();
        connection
            .execute_batch(
                "ALTER TABLE conversations ADD COLUMN items TEXT NOT NULL DEFAULT '[]'; \
                 INSERT INTO conversations (id, items) VALUES \
                   ('so-blob', '[{\"kind\":\"user\",\"id\":\"u1\",\"text\":\"oi\",\"ts\":1790196697549},{\"kind\":\"result\",\"id\":\"r1\",\"ok\":true,\"costUsd\":0.4213}]'), \
                   ('ilegivel', 'não-é-json'), \
                   ('sem-id', '[{\"kind\":\"text\",\"text\":\"sem id\"}]'), \
                   ('vazia', '[]');",
            )
            .unwrap();
        // c1 já itemizada, com o blob velho ainda lá
        save_changes(&mut connection, "c1", vec![change(0, "a", "um")], 1, true).unwrap();
        connection
            .execute("UPDATE conversations SET items = '[{\"id\":\"a\"}]' WHERE id = 'c1'", [])
            .unwrap();

        let (itemizadas, esvaziadas) = consolidar_historico(&mut connection).unwrap();
        assert_eq!(itemizadas, 1);
        assert_eq!(esvaziadas, 2); // c1 e so-blob

        let itens = itens_da_conversa(&connection, "so-blob").unwrap();
        assert_eq!(itens.len(), 2);
        assert_eq!(itens[0]["ts"], 1790196697549u64);
        assert_eq!(itens[1]["costUsd"], 0.4213);
        let blob = |id: &str| -> String {
            connection
                .query_row("SELECT items FROM conversations WHERE id = ?1", [id], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(blob("so-blob"), "[]");
        assert_eq!(blob("c1"), "[]");
        // o que não dava para itemizar fica intacto, e segue legível pelo blob
        assert_eq!(blob("ilegivel"), "não-é-json");
        assert_eq!(itens_da_conversa(&connection, "sem-id").unwrap()[0]["text"], "sem id");
        // de novo: nada a fazer
        assert_eq!(consolidar_historico(&mut connection).unwrap(), (0, 0));
    }

    #[test]
    fn consolidar_sem_as_tabelas_nao_faz_nada() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("CREATE TABLE conversations (id TEXT PRIMARY KEY, items TEXT NOT NULL);")
            .unwrap();
        assert_eq!(consolidar_historico(&mut connection).unwrap(), (0, 0));
    }

    #[test]
    fn snapshot_incompleto_aborta_em_vez_de_deixar_item_velho_vivo() {
        // O `replace_all` não apaga mais a conversa antes de reinserir (o apagão
        // reindexava tudo no índice léxico, 3.310ms por persist). A garantia que
        // ele dava virou cobrança: snapshot que não cobre todas as posições é
        // recusado, senão um item velho sobreviveria numa posição que ninguém
        // reescreveu — e a busca acharia conteúdo que a pessoa já não tem.
        let mut connection = database();
        save_changes(
            &mut connection,
            "c1",
            vec![change(0, "a", "um"), change(1, "b", "dois")],
            2,
            true,
        )
        .unwrap();

        let erro = save_changes(
            &mut connection,
            "c1",
            vec![change(0, "a", "um novo")], // falta a posição 1
            2,
            true,
        )
        .unwrap_err();
        assert!(
            erro.contains("snapshot incompleto"),
            "esperava recusa explícita, veio: {erro}"
        );

        // E o banco continua intacto: fail-closed não escreve pela metade.
        let texto: String = connection
            .query_row(
                "SELECT json_extract(item_json,'$.text') FROM conversation_items \
                 WHERE conversation_id='c1' AND position=0",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(texto, "um");
    }

    #[test]
    fn replace_all_encolhe_a_conversa_sem_deixar_cauda() {
        // O cenário que o apagão aparentava proteger: a conversa diminui.
        let mut connection = database();
        save_changes(
            &mut connection,
            "c1",
            vec![change(0, "a", "um"), change(1, "b", "dois"), change(2, "c", "tres")],
            3,
            true,
        )
        .unwrap();
        save_changes(
            &mut connection,
            "c1",
            vec![change(0, "a", "um")],
            1,
            true,
        )
        .unwrap();
        let restantes: i64 = connection
            .query_row(
                "SELECT count(*) FROM conversation_items WHERE conversation_id='c1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(restantes, 1, "a cauda tinha que ter sumido");
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
