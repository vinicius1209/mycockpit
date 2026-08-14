// O ESTADO VIVO da missão que NÃO é do run: os dois gestos de intervenção (R7
// do docs/mocks/missao-README.md — segurar no fim da fase e interromper esta
// fase) e o plumbing por conversa (cwd, loop de revisão).
//
// Mora fora do store porque é plumbing, não estado de UI (mesma regra do
// missionCwd/missionReview), e porque a catraca de tamanho cobrou a divisão de
// store/mission.ts.
//
// A distinção que estes dois mapas sustentam é a mais cara da frente: um
// cancelamento pedido POR VOCÊ não pode virar o mesmo desfecho de um motor que
// quebrou. Sem a marca de intenção, interromper uma fase mataria a missão
// inteira, que é o gesto que já existe e se chama Parar.
//
// Estado VIVO: some com o app e não entra no run-state (pausa restaurada seria
// a pausa de um processo que já morreu).

import type { ReviewLoopState } from "@/lib/missionState"

/** Missões paradas ANTES de começar a próxima fase, esperando o gesto humano.
 *  MESMO padrão do gate: o loop aguarda, `release` resolve com true (segue),
 *  abort/clear com null (desiste). */
const holdWaiters = new Map<string, (go: boolean | null) => void>()

/** Missões em que o humano pediu a morte do processo da fase corrente. */
const interruptIntents = new Set<string>()

/** Registra o waiter e devolve a promessa que o loop aguarda. */
export function awaitRelease(missionId: string): Promise<boolean | null> {
  return new Promise<boolean | null>((resolve) => {
    holdWaiters.set(missionId, resolve)
  })
}

/** O loop saiu da espera (por qualquer caminho): limpa o waiter. */
export function clearReleaseWaiter(missionId: string): void {
  holdWaiters.delete(missionId)
}

/** Existe um loop de fato ESPERANDO? Distingue "só pedi" (ainda reversível) de
 *  "a missão já parou" (aí desligar não é o gesto, continuar é). */
export function isWaitingRelease(missionId: string): boolean {
  return holdWaiters.has(missionId)
}

/** Solta a missão: `true` segue, `null` desiste (abort/clear). No-op sem
 *  ninguém esperando. */
export function releaseWaiter(missionId: string, go: boolean | null): void {
  holdWaiters.get(missionId)?.(go)
}

/** Marca a INTENÇÃO humana antes do cancel: o evento de cancelamento chega
 *  pelo stream e o loop precisa achar a marca já lá (fail-closed na ordem). */
export function markInterrupt(missionId: string): void {
  interruptIntents.add(missionId)
}

/** Consome a intenção (uma por episódio). true = o cancelamento foi seu. */
export function takeInterrupt(missionId: string): boolean {
  return interruptIntents.delete(missionId)
}

/** Descarta a intenção sem consumir o desfecho (abort/clear). */
export function forgetInterrupt(missionId: string): void {
  interruptIntents.delete(missionId)
}

// ── Plumbing por conversa ────────────────────────────────────────────────────
// Fora do MissionRun de propósito: é encanamento de persistência, não estado de
// UI (evita churn de tipo em quem consome o run).

/** cwd da missão de cada conversa (worktree ou pasta do projeto) — alvo do
 *  run-state.json. */
export const missionCwd = new Map<string, string>()

/** Estado vivo do loop de revisão por conversa (loops disparados + último
 *  veredito): cada marco grava isto no run-state pra memória do clamp de
 *  MAX_REVIEW_LOOPS sobreviver a crash (sem ele, a retomada re-armava o loop e
 *  pagava rodadas extras). */
export const missionReview = new Map<string, ReviewLoopState>()
