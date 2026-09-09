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
 * Combina o sinal de evento do app (`limitedAgents`) com o snapshot da janela de uso (`UsageSnapshot`).
 */
export function checkAgentQuota(
  agent: string,
  limitedAgents: Record<string, string | null>,
  snapshot?: UsageSnapshot | null,
  now: number = Date.now(),
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
    if (full) {
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
      )
      return !quota.exhausted
    })
    .map((destination) => ({
      id: destination.id,
      label: destination.label,
    }))
}
