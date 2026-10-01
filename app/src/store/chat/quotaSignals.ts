// Efeitos globais de eventos de turno sobre a cota de um motor:
// - limit_reached: marca o motor como limitado (limitedAgents).
// - result.ok: limpa a marca e carimba que o motor concluiu um turno com sucesso,
//   servindo de contraprova a leituras desatualizadas de cota.

import type { AgentEvent } from "@/lib/agent"
import { useApp } from "@/store/app"
import { useUsage } from "@/store/usage"

/** Aplica o que ESTE evento diz sobre a cota do agent. `agent` indefinido
 *  (evento antes de a identidade do processo existir) não vira palpite. */
export function aplicarSinalDeCota(
  agent: string | undefined,
  e: AgentEvent,
  now: number = Date.now(),
): void {
  if (!agent) return
  if (e.type === "limit_reached") {
    useApp.getState().setAgentLimited(agent, e.reset_hint ?? null)
    return
  }
  if (e.type === "result" && e.ok) {
    useApp.getState().clearAgentLimited(agent)
    useUsage.getState().recordTurnSuccess(agent, now)
  }
}
