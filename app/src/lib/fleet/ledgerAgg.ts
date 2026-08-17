// O LEDGER → CUSTO POR PROJETO, separado do que ficou SEM preço.
//
// Extraído de `fleet/derive.ts` só pela catraca de tamanho (o arquivo já
// estava congelado acima do teto de .ts; ratchet proíbe subir o teto ou
// editar a baseline à mão — "DIVIDA O ARQUIVO"). A função é pura de
// propósito: `refreshLedger` (em `derive.ts`) é só o fio async em volta dela,
// e ela sozinha é testável sem tocar o Tauri SQL plugin (no-op em teste).

import type { LedgerEntry } from "@/lib/db"

/** O ledger inteiro → custo por projeto E o que ficou sem preço, por projeto
 *  (ADR-047: `costUsd == null` não é "gastou zero" — entra na soma SÓ quando
 *  sabemos o preço; sem preço vira contagem separada, nunca 0 silencioso). */
export function aggregateLedgerByProject(entries: LedgerEntry[]): {
  byProject: Record<string, number>
  unpriced: Record<string, { turns: number; tokens: number }>
} {
  const byProject: Record<string, number> = {}
  const unpriced: Record<string, { turns: number; tokens: number }> = {}
  for (const e of entries) {
    if (e.costUsd == null) {
      const cur = unpriced[e.projectId] ?? { turns: 0, tokens: 0 }
      unpriced[e.projectId] = { turns: cur.turns + 1, tokens: cur.tokens + e.tokens }
      continue
    }
    byProject[e.projectId] = (byProject[e.projectId] ?? 0) + e.costUsd
  }
  return { byProject, unpriced }
}
