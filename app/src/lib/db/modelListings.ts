// Cache persistido da lista viva de modelos de cada motor no SQLite.
// Evita cair em defaults estáticos quando sondas falham e garante renderização
// correta no boot inicial.

import type Database from "@tauri-apps/plugin-sql"
import { getDb } from "@/lib/db"
import type { ModelListing } from "@/lib/modelList"

let tablesReady: Promise<void> | null = null

export async function ensureModelListingTables(db: Database): Promise<void> {
  if (!tablesReady) {
    const run = (async () => {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS model_listings (
          agent TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          cli_version TEXT,
          fetched_at INTEGER NOT NULL,
          payload_json TEXT NOT NULL
        )`,
      )
    })()
    tablesReady = run.catch((e) => {
      tablesReady = null
      throw e
    })
  }
  return tablesReady
}

/** Testes de schema precisam simular uma conexão nova. */
export function _resetModelListingTablesForTests(): void {
  tablesReady = null
}

/** Guarda a lista que ESTE CLI acabou de dar. Chamado só depois de uma sonda
 *  bem-sucedida: falha nunca sobrescreve o que se sabia. */
export async function saveModelListing(listing: ModelListing): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureModelListingTables(db)
  await db.execute(
    `INSERT INTO model_listings (agent, source, cli_version, fetched_at, payload_json)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(agent) DO UPDATE SET
       source = excluded.source,
       cli_version = excluded.cli_version,
       fetched_at = excluded.fetched_at,
       payload_json = excluded.payload_json`,
    [
      listing.agent,
      listing.source,
      listing.cliVersion,
      listing.fetchedAt,
      JSON.stringify(listing.models),
    ],
  )
}

/** As listas guardadas, prontas pra hidratar o seletor no boot.
 *
 *  Linha com payload ilegível é PULADA com log, nunca derruba as outras: uma
 *  lista corrompida não pode custar o seletor dos demais motores. */
export async function loadModelListings(): Promise<ModelListing[]> {
  const db = await getDb()
  if (!db) return []
  await ensureModelListingTables(db)
  const rows = await db.select<
    {
      agent: string
      source: string
      cli_version: string | null
      fetched_at: number
      payload_json: string
    }[]
  >(`SELECT agent, source, cli_version, fetched_at, payload_json FROM model_listings`)
  const out: ModelListing[] = []
  for (const row of rows) {
    let models: ModelListing["models"]
    try {
      const parsed: unknown = JSON.parse(row.payload_json)
      if (!Array.isArray(parsed)) throw new Error("payload não é lista")
      models = parsed as ModelListing["models"]
    } catch (e) {
      console.warn(`model_listings: payload ilegível de ${row.agent}`, e)
      continue
    }
    out.push({
      agent: row.agent,
      source: row.source,
      cliVersion: row.cli_version,
      fetchedAt: row.fetched_at,
      models,
    })
  }
  return out
}
