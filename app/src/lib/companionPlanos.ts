// A cota no topo do Companion (F1 do lote 2 do Maestri): a pior janela de cada
// motor, pela MESMA regra da faixa do app (`planosDaFaixa`), com o texto
// pronto. A página não reimplementa regra: só desenha o que chega aqui.

import { agentDef } from "@/lib/agents"
import type { CompanionPlano } from "@/lib/companionTypes"
import { planosDaFaixa, rotuloCurtoDaJanela } from "@/lib/faixaDosPlanos"
import {
  fmtPct,
  fmtResetAbsolute,
  usageTone,
  type UsageFailure,
  type UsageSnapshot,
} from "@/lib/usageWindow"

/** Uma linha por motor com leitura fresca; sem leitura, o motor não aparece.
 *  Reset que já passou não vira "volta": a leitura é que está velha. Puro. */
export function planosDoCompanion(
  byAgent: Record<string, UsageSnapshot>,
  failures: Record<string, UsageFailure>,
  now: number,
): CompanionPlano[] {
  return planosDaFaixa(null, byAgent, failures, now).map(({ agent, janela }) => {
    const futuro = janela.resetsAt != null && janela.resetsAt * 1000 > now
    const quando = futuro ? fmtResetAbsolute(janela.resetsAt, now) : null
    return {
      agent,
      rotulo: agentDef(agent)?.label ?? agent,
      janela: rotuloCurtoDaJanela(janela),
      pct: Math.min(100, Math.max(0, Math.round(janela.usedPercent))),
      tom: usageTone(janela.usedPercent),
      detalhe: quando ? `${fmtPct(janela.usedPercent)} · volta ${quando}` : fmtPct(janela.usedPercent),
    }
  })
}
