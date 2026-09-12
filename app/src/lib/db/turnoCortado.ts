// O turno que você cortou também consumiu (ADR-180).
//
// O ledger (`recordTurnCost`) só grava no `result`, e um turno cortado por
// SIGINT normalmente morre antes dele. Medido na conversa "[feat] cliente
// coleta" (09/09/2026): 14 ações e 5min21s de trabalho real sem UMA linha em
// `turn_costs`. Aqui entra a linha do corte com custo DESCONHECIDO (NULL), que
// é diferente de US$ 0,00, e o total da conversa passa a se declarar estimado.
//
// `INSERT OR IGNORE`: se o `result` chegou antes do corte, a linha real fica e
// esta não entra; se o motor ainda mandar `result` depois do SIGINT, o
// `INSERT OR REPLACE` do `recordTurnCost` sobrescreve esta pelo mesmo run_id.
// Colher o usage parcial de cada motor é frente própria, por capability e com
// fixture real de cancelamento (ADR-016).
//
// Fura de propósito o piso do `worthLedgerRow` ("sem preço E sem token não é
// consumo"): aqui houve consumo, só não há medida dele.

import { getDb, USAGE_BASIS_DELTA } from "@/lib/db"

export async function registrarTurnoCortado(r: {
  runId: string
  projectId: string
  convId: string
  agent: string
  model: string | null
}): Promise<void> {
  try {
    // getDb dentro do try: banco indisponível também é linha perdida, não
    // exceção solta num corte que a pessoa pediu.
    const db = await getDb()
    if (!db) return
    await db.execute(
      "INSERT OR IGNORE INTO turn_costs (run_id, project_id, conv_id, agent, model, cost_usd, cost_source, input_tokens, output_tokens, cache_tokens, created_at, usage_basis) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
      [
        r.runId,
        r.projectId,
        r.convId,
        r.agent,
        r.model,
        null,
        "unknown",
        0,
        0,
        0,
        Date.now(),
        USAGE_BASIS_DELTA,
      ],
    )
  } catch (error) {
    // Best-effort como o resto do ledger, mas com rastro: perder esta linha é
    // voltar ao sumiço que ela existe para impedir.
    console.warn("ledger: não consegui registrar o turno cortado", error)
  }
}
