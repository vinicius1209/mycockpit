import type { Attachment } from "@/lib/attachments"
import { agentDef, DESTINATIONS, dispatchBlockReason } from "@/lib/agents"
import type { AgentProbe } from "@/lib/detect"
import type { Destination } from "@/lib/types"
import {
  fmtResetIn,
  snapshotUsable,
  type UsageSnapshot,
} from "@/lib/usageWindow"

export interface AgentQuotaStatus {
  exhausted: boolean
  resetHint: string | null
}

export interface RevezamentoOpcao {
  id: string
  label: string
}

/**
 * Avalia se o agente atingiu 100% do limite de uso.
 * Combina o sinal de evento do app (`limitedAgents`) com o snapshot da janela de
 * uso (`UsageSnapshot`) e com a CONTRAPROVA de um turno que passou.
 *
 * A contraprova existe porque as duas fontes correm em relógios diferentes: o
 * poll da janela é de 15 min e o snapshot vale por 30, então uma leitura de
 * "100%" continua de pé muito depois de a janela ter virado. Em 09/09/2026 o
 * auto-resume retomou, o turno rodou inteiro e terminou bem, e a faixa seguiu
 * dizendo "sem cota para o próximo turno" — o app tinha a prova na mão e não
 * usava. Turno concluído DEPOIS da leitura é evidência de primeira mão de que
 * aquela leitura não descreve o agora.
 *
 * O que a contraprova NÃO faz: inventar percentual. Ela derruba a conclusão
 * ("esgotado"), nunca o número — quem diz quanto sobrou continua sendo o
 * provider, e até a próxima leitura o medidor mostra o que leu, com a idade
 * dele. Derrubar a conclusão é honesto; forjar 38% seria teatro.
 *
 * `limitedAgents` (o `limit_reached` do CLI) NÃO precisa disso: ele já é curado
 * pelo mesmo `result.ok` em `handleEvent`.
 */
export function checkAgentQuota(
  agent: string,
  limitedAgents: Record<string, string | null>,
  snapshot?: UsageSnapshot | null,
  now: number = Date.now(),
  /** Quando o agent concluiu um turno pela última vez (`useUsage.lastSuccessAt`). */
  lastSuccessAt?: number | null,
): AgentQuotaStatus {
  // 1. Sinal do app (limit_reached emitido pelo CLI)
  if (agent in limitedAgents) {
    return {
      exhausted: true,
      resetHint: limitedAgents[agent] ?? null,
    }
  }

  // 2. Sinal da janela de uso (statusline ou poll da conta)
  if (
    snapshot?.windows &&
    snapshot.windows.length > 0 &&
    snapshotUsable(snapshot, undefined, now)
  ) {
    const full = snapshot.windows.find((w) => w.usedPercent >= 100)
    // Turno concluído depois desta leitura a desmente: passou, logo não estava
    // esgotado. Empate (mesmo ms) fica com a leitura, que é a fonte.
    const desmentida = lastSuccessAt != null && lastSuccessAt > snapshot.fetchedAt
    if (full && !desmentida) {
      const resetRel = fmtResetIn(full.resetsAt, now)
      return {
        exhausted: true,
        resetHint: resetRel ?? "100%",
      }
    }
  }

  return {
    exhausted: false,
    resetHint: null,
  }
}

export interface EligibleHandoffTargetsInput {
  currentAgent: string
  detected?: Record<string, AgentProbe>
  limitedAgents?: Record<string, string | null>
  byAgentSnapshots?: Record<string, UsageSnapshot>
  /** `useUsage.lastSuccessAt`: um destino não é descartado por uma leitura que
   *  um turno dele já desmentiu. */
  lastSuccessByAgent?: Record<string, number>
  attachments?: readonly Attachment[]
  now?: number
  /** Injetável só para testes de contrato e registries futuros. */
  destinations?: Destination[]
}

function acceptsAttachments(
  agent: string,
  attachments: readonly Attachment[],
): boolean {
  const caps = agentDef(agent)?.caps
  if (!caps) return attachments.length === 0
  return attachments.every((attachment) =>
    attachment.kind === "image"
      ? caps.image
      : attachment.kind === "pdf"
        ? caps.pdf
        : false,
  )
}

/** Fonte única dos destinos realmente acionáveis pelas duas formas de
 * continuidade. Estado desconhecido continua elegível; ausência, falta de
 * login, cota esgotada e anexo incompatível falham fechados. */
export function eligibleHandoffTargets({
  currentAgent,
  detected = {},
  limitedAgents = {},
  byAgentSnapshots = {},
  lastSuccessByAgent = {},
  attachments = [],
  now = Date.now(),
  destinations = DESTINATIONS,
}: EligibleHandoffTargetsInput): RevezamentoOpcao[] {
  return destinations
    .filter((destination) => {
      if (destination.kind !== "agent") return false
      if (destination.id === currentAgent) return false
      if (!destination.available) return false
      if (dispatchBlockReason(destination.id, detected)) return false
      if (!acceptsAttachments(destination.id, attachments)) return false
      const quota = checkAgentQuota(
        destination.id,
        limitedAgents,
        byAgentSnapshots[destination.id],
        now,
        lastSuccessByAgent[destination.id],
      )
      return !quota.exhausted
    })
    .map((destination) => ({
      id: destination.id,
      label: destination.label,
    }))
}
