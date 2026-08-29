import type Database from "@tauri-apps/plugin-sql"

/** ALTER idempotente: engole só a coluna já existente; erro real propaga. */
export async function addColumn(db: Database, sql: string): Promise<void> {
  try {
    await db.execute(sql)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/duplicate column/i.test(msg)) throw e
  }
}

let composerDraftsReady: Promise<void> | null = null

/**
 * Espelho fail-safe da Migration 40. O runtime Tauri cria a tabela no boot;
 * este ensure cobre banco de teste/dev e upgrade interrompido, com o mesmo
 * padrão das demais tabelas que o frontend acessa diretamente.
 */
export async function ensureComposerDraftTables(db: Database): Promise<void> {
  if (!composerDraftsReady) {
    const run = (async () => {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS conversation_drafts (
           conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE
         )`,
      )
      await addColumn(
        db,
        `ALTER TABLE conversation_drafts ADD COLUMN text TEXT NOT NULL DEFAULT ''`,
      )
      await addColumn(
        db,
        `ALTER TABLE conversation_drafts ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'`,
      )
      await addColumn(
        db,
        `ALTER TABLE conversation_drafts ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`,
      )
    })()
    composerDraftsReady = run.catch((e) => {
      composerDraftsReady = null
      throw e
    })
  }
  return composerDraftsReady
}

/** Testes de schema precisam simular uma conexão nova. */
export function _resetComposerDraftTablesForTests(): void {
  composerDraftsReady = null
}
