import { DESTINATIONS } from "@/lib/agents"
import { estadoNaMaquina, type AgentProbe } from "@/lib/detect"
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

/**
 * Identifica os agentes alternativos disponíveis para revezamento na máquina.
 */
export function alternativeAgentsFor(
  currentAgent: string,
  detectados: Record<string, AgentProbe> = {},
  limitedAgents: Record<string, string | null> = {},
  byAgentSnapshots: Record<string, UsageSnapshot> = {},
  now: number = Date.now(),
): RevezamentoOpcao[] {
  return DESTINATIONS.filter((d) => {
    if (d.id === currentAgent) return false
    if (!d.available) return false
    if (estadoNaMaquina(d.id, detectados) === "ausente") return false
    const quota = checkAgentQuota(
      d.id,
      limitedAgents,
      byAgentSnapshots[d.id],
      now,
    )
    if (quota.exhausted) return false
    return true
  }).map((d) => ({
    id: d.id,
    label: d.label,
  }))
}
