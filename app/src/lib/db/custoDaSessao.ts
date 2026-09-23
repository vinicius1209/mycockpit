// Custo acumulado que cada sessão já reportou (ADR-226).
//
// Desde o claude 2.1.280 (medido em 23/09/2026), ao retomar uma sessão o
// `total_cost_usd` do `result` é o ACUMULADO da sessão, não o do turno. O
// runner calcula o custo do turno como a diferença para o total anterior
// (`pricing::custo_do_turno`), e é aqui que esse total anterior mora entre um
// run e outro, porque o processo do motor morre a cada turno.
//
// Perder esta linha não quebra o turno: o custo reportado vale como está, que é
// o comportamento de antes. Por isso as falhas são registradas no log e não
// sobem.

import { getDb } from "@/lib/db"

let pronta: Promise<void> | null = null

async function garantirTabela(): Promise<boolean> {
  const db = await getDb()
  if (!db) return false
  if (!pronta) {
    pronta = db
      .execute(
        `CREATE TABLE IF NOT EXISTS cost_baselines (
           thread_id TEXT PRIMARY KEY,
           conv_id TEXT,
           reported_total REAL NOT NULL,
           updated_at INTEGER NOT NULL
         )`,
      )
      .then(() => undefined)
      .catch((erro) => {
        pronta = null
        throw erro
      })
  }
  await pronta
  return true
}

export async function carregarCustoDaSessao(threadId: string): Promise<number | null> {
  try {
    if (!(await garantirTabela())) return null
    const db = await getDb()
    const linhas = await db!.select<{ reported_total: number }[]>(
      "SELECT reported_total FROM cost_baselines WHERE thread_id = $1",
      [threadId],
    )
    return linhas[0]?.reported_total ?? null
  } catch (erro) {
    console.error("[custo] não consegui ler o custo acumulado da sessão", erro)
    return null
  }
}

export async function salvarCustoDaSessao(
  threadId: string,
  convId: string,
  reportedTotal: number,
): Promise<void> {
  try {
    if (!(await garantirTabela())) return
    const db = await getDb()
    await db!.execute(
      `INSERT INTO cost_baselines (thread_id, conv_id, reported_total, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(thread_id) DO UPDATE SET
         conv_id = excluded.conv_id,
         reported_total = excluded.reported_total,
         updated_at = excluded.updated_at`,
      [threadId, convId, reportedTotal, Date.now()],
    )
  } catch (erro) {
    console.error("[custo] não consegui guardar o custo acumulado da sessão", erro)
  }
}
