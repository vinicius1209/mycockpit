// Lógica PURA (sem DOM/store) do revezamento (§ limite/erro) e da recuperação de
// missão — separada dos componentes pra ser testável no ambiente node do vitest
// (o office não tem jsdom). Os componentes (DeskDock/MissionDock) só desenham;
// a decisão de "qual alvo" e "qual escolha" vive aqui e é coberta por ui.test.ts.
import type { RecoveryChoice } from "@/lib/missionTypes"

/** Alvos do revezamento: os agents disponíveis MENOS o atual (não faz sentido
 *  "continuar no mesmo"). Espelha o filtro do ContinueRow do MessageList
 *  (available && kind agent && id !== current) — a lista já chega filtrada por
 *  availableAgents(); aqui só tira o atual. */
export function revezamentoTargets<T extends { id: string }>(
  current: string,
  agents: T[],
): T[] {
  return agents.filter((a) => a.id !== current)
}

// buildRecoveryChoice subiu pra @/lib/recoveryChoice (fonte única com o card de
// recovery do Trabalho, MissionTimeline) — re-exportado aqui pra manter os
// consumidores do office (MissionDock, ui.test) intactos.
export { buildRecoveryChoice } from "@/lib/recoveryChoice"

// --- ações injetáveis (wiring testável sem DOM) -----------------------------
// Os componentes chamam estes com as funções reais (continueInAgent do bridge/
// send; resolve/abort do bridge/hooks); os testes chamam com spies e conferem
// que o ALVO/ESCOLHA chega certo.

export interface RevezamentoDeps {
  continueInAgent: (
    args: { convId: string; projectId: string; projectPath: string; agent: string; text: string },
    targetAgent: string,
  ) => void | Promise<void>
}

/** Dispara o revezamento pro alvo escolhido (botão "Continuar no {label}"). */
export function pickRevezamento(
  deps: RevezamentoDeps,
  args: { convId: string; projectId: string; projectPath: string; agent: string; text: string },
  targetAgent: string,
): void {
  void deps.continueInAgent(args, targetAgent)
}

export interface RecoveryDeps {
  resolve: (convId: string, choice: RecoveryChoice) => void
  abort: (convId: string) => void
}

/** "Trocar e retomar": aplica a escolha e re-roda a fase (resolveRecovery). */
export function applyRecovery(
  deps: RecoveryDeps,
  convId: string,
  choice: RecoveryChoice,
): void {
  deps.resolve(convId, choice)
}

/** "Desistir": abandona a recuperação → a missão vai a error (abortRecovery). */
export function cancelRecovery(deps: RecoveryDeps, convId: string): void {
  deps.abort(convId)
}
