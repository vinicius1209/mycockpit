// A ÚLTIMA LISTA VIVA de cada motor, no banco.
//
// POR QUE existe: a lista viva é uma sonda, e sonda falha (CLI atualizando,
// máquina sem rede, app-server pendurado). Sem cache, cada falha jogava o
// seletor de volta na lista ESCRITA À MÃO do bundle — que é justamente a que
// envelhece: em 09/09/2026 ela ainda abria em "Sol" e oferecia dois modelos
// (gpt-5.4, gpt-5.4-mini) que o CLI já não conhecia.
//
// Com o cache, o pior caso deixa de ser "a lista de quando a versão foi
// compilada" e passa a ser "a última lista que o SEU CLI deu". O seletor também
// abre certo no primeiro frame do boot, antes de a sonda responder.
//
// Uma linha por motor: a pergunta é "o que este CLI conhece agora", e resposta
// nova SUBSTITUI a anterior (histórico de modelo é assunto do ledger, que tem
// tabela própria e motivo escrito). Mesmo padrão idempotente das outras tabelas
// que o frontend acessa direto: CREATE IF NOT EXISTS + cache de promessa que
// RESETA em falha.

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
