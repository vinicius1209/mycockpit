// O LEDGER (não as missões vivas) → custo de HOJE, pro digest do celular.
//
// Extraído de `companion.ts` só pela catraca de tamanho (arquivo já
// congelado acima do teto de .ts; ratchet proíbe subir o teto ou editar a
// baseline à mão — "DIVIDA O ARQUIVO"). Só a fatia do LEDGER sai daqui: o
// custo de missões VIVAS depende de `missions.byConv` e `projectOf`,
// contexto que é do `companion.ts`, e não vale a pena carregar pra cá.

import type { LedgerEntry } from "@/lib/db"
import { unpricedSpend, type UnpricedSpend } from "@/lib/panel"

/** Ledger de hoje → total + por-projeto, SÓ o que tem preço (ADR-047:
 *  `costUsd` NULL não soma como US$ 0,00) + o que ficou de fora, em
 *  `unpriced` (régua única de `lib/panel.ts`, importada, não recalculada). */
export function ledgerCostsForToday(ledger: LedgerEntry[]): {
  totalUsd: number
  byProject: Record<string, number>
  unpriced: UnpricedSpend
} {
  const byProject: Record<string, number> = {}
  let totalUsd = 0
  for (const e of ledger) {
    if (e.costUsd == null) continue
    totalUsd += e.costUsd
    byProject[e.projectId] = (byProject[e.projectId] ?? 0) + e.costUsd
  }
  return { totalUsd, byProject, unpriced: unpricedSpend(ledger) }
}
