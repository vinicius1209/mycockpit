// O RECIBO da fase concluída (R6 do docs/mocks/missao-README.md).
//
// Hoje a fase concluída colapsa mostrando SÓ o custo, e "o que ela FEZ" não
// existe em lugar nenhum. Duas coisas faltavam e agora existem: a duração
// congelada (`MissionPhaseRun.endedAt`) e a contagem derivada de `items`.
//
// Ordem FIXA do resumo colapsado, porque o resumo deve SER a informação:
//   entregável → impacto → duração congelada → custo → quem fez
// O último em sussurro: quem varre uma lista de fases concluídas procura o
// entregável, não o fornecedor. O motor importa para auditoria, mas não é o
// que o olho procura.
//
// Puro.

import { fmtDuration } from "@/lib/format"
import { phaseCostState } from "@/lib/missionCost"
import { actionLabel } from "@/lib/missionAction"
import { agentDef } from "@/lib/agents"
import { presentTool } from "@/lib/toolview"
import type { MissionPhaseRun } from "@/lib/missionTypes"

export interface PhaseReceipt {
  /** O entregável, quando dá pra saber: o último arquivo escrito. */
  deliverable: string | null
  /** Impacto: quantas ações a fase reportou. null = o motor não reporta. */
  impact: string | null
  /** Duração CONGELADA. null = a fase não tem os dois carimbos. */
  duration: string | null
  /** Custo, no vocabulário dos três estados. */
  cost: string
  /** Quem fez, em sussurro (último de propósito). */
  engine: string
  /** A fase terminou mal (falhou ou foi interrompida)? Falha nunca recolhe. */
  bad: boolean
}

/** O último arquivo que a fase ESCREVEU (mutação), que é o candidato mais
 *  honesto a "entregável". null quando nenhuma escrita foi reportada. */
export function lastDeliverable(phase: MissionPhaseRun): string | null {
  const tools = (phase.items ?? []).filter((i) => i.kind === "tool")
  for (let i = tools.length - 1; i >= 0; i--) {
    const t = tools[i]
    if (t.kind !== "tool") continue
    const view = presentTool(t.name || "x", t.input)
    if (view.category !== "change") continue
    const lab = actionLabel(t.name, t.input)
    if (lab) return lab.label
  }
  return null
}

export function phaseReceipt(phase: MissionPhaseRun): PhaseReceipt {
  const acoes = (phase.items ?? []).filter((i) => i.kind === "tool").length
  const dur =
    phase.startedAt != null && phase.endedAt != null
      ? Math.max(0, phase.endedAt - phase.startedAt)
      : null
  const cost = phaseCostState(phase)
  return {
    deliverable: lastDeliverable(phase),
    impact:
      acoes > 0
        ? `${acoes} ${acoes === 1 ? "ação" : "ações"}`
        : // motor que não narra não tem contagem a dar, e zero ações seria a
          // mesma mentira do zero de custo.
          "sem ações relatadas",
    duration: dur != null && dur >= 1000 ? fmtDuration(dur) : null,
    cost: cost.value,
    engine: agentDef(phase.def.agent)?.shortLabel ?? phase.def.agent,
    bad: phase.status === "error" || phase.status === "aborted",
  }
}

/** A linha colapsada, na ordem fixa, já montada (a UI só decide a tipografia). */
export function receiptLine(r: PhaseReceipt): string {
  return [r.deliverable, r.impact, r.duration, r.cost, r.engine]
    .filter(Boolean)
    .join(" · ")
}
