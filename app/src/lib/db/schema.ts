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
 * Espelho fail-safe das migrations 40 e 47. O runtime cria a tabela no boot;
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
        `ALTER TABLE conversation_drafts ADD COLUMN mention_values TEXT NOT NULL DEFAULT '[]'`,
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

let conversationHierarchyReady: Promise<void> | null = null

/**
 * Espelho fail-safe da Migration 43. O runtime Tauri cria a coluna no boot;
 * este ensure cobre banco de teste/dev e upgrade interrompido.
 */
export async function ensureConversationHierarchySchema(db: Database): Promise<void> {
  if (!conversationHierarchyReady) {
    const run = (async () => {
      await addColumn(
        db,
        "ALTER TABLE conversations ADD COLUMN parent_id TEXT REFERENCES conversations(id) ON DELETE SET NULL",
      )
    })()
    conversationHierarchyReady = run.catch((e) => {
      conversationHierarchyReady = null
      throw e
    })
  }
  return conversationHierarchyReady
}

export function _resetConversationHierarchyForTests(): void {
  conversationHierarchyReady = null
}

let conversationItemsReady: Promise<void> | null = null

/** Espelho fail-safe das migrations 48 e 49. O acesso normal passa pelos
 * comandos Rust transacionais; este ensure cobre banco de teste/dev e upgrade
 * interrompido antes da primeira leitura incremental. */
export async function ensureConversationItemTables(db: Database): Promise<void> {
  if (!conversationItemsReady) {
    const run = (async () => {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS conversation_items (
           conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
           position INTEGER NOT NULL,
           item_id TEXT NOT NULL,
           item_json TEXT NOT NULL,
           revision INTEGER NOT NULL,
           updated_at INTEGER NOT NULL,
           PRIMARY KEY (conversation_id, position)
         )`,
      )
      await db.execute(
        `CREATE TABLE IF NOT EXISTS conversation_item_state (
           conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
           revision INTEGER NOT NULL,
           item_count INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         )`,
      )
    })()
    conversationItemsReady = run.catch((error) => {
      conversationItemsReady = null
      throw error
    })
  }
  return conversationItemsReady
}

export function _resetConversationItemTablesForTests(): void {
  conversationItemsReady = null
}
