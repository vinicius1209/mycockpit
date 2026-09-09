// Os efeitos GLOBAIS que um evento de turno tem sobre a COTA de um agent.
//
// Globais porque não são da conversa: quem bateu no teto bateu para todas, e o
// seletor de qualquer fio precisa saber. Saíram do `handleEvent` (que já estava
// no limite da catraca e não pode crescer) porque viraram regra com dois
// consumidores e um incidente atrás, não mais uma linha de encanamento.
//
// As DUAS metades do mesmo fato, que antes só tinham uma:
//
//   `limit_reached` → marca o agent como limitado (`limitedAgents`).
//   `result.ok`     → cura a marca E carimba "este agent concluiu um turno
//                     agora", que é a contraprova de uma LEITURA velha de
//                     100% na janela de uso.
//
// Faltava a segunda metade do `result.ok`. O poll da janela é de 15 min e o
// snapshot vale 30, então em 09/09/2026 o auto-resume retomou, o turno rodou
// inteiro e terminou bem, e a faixa seguiu oferecendo outro motor: o "100%"
// lido ANTES do turno continuava de pé DEPOIS dele. O app tinha a prova na mão
// e não a usava. Quem decide o que fazer com o carimbo é `checkAgentQuota`;
// aqui o turno só conta o que sabe.

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
