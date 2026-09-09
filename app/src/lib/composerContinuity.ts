import {
  lastExecutorTurnOutcome,
  pendingExecutorRequest,
  type PendingExecutorRequest,
} from "@/lib/turnOutcome"
import type { ChatItem } from "@/store/chat"

export type ComposerContinuity =
  | {
      mode: "continue-now"
      terminalId: string
      pending: PendingExecutorRequest
    }
  | {
      mode: "next-send"
      terminalId: string
      pending: null
    }

/** Decide o significado da superfície antes de renderizá-la. Um pedido
 * interrompido sempre tem prioridade sobre o aviso preventivo de cota. */
export function deriveComposerContinuity(
  items: ChatItem[],
  busy: boolean,
  quotaExhausted: boolean,
): ComposerContinuity | null {
  if (busy) return null

  const outcome = lastExecutorTurnOutcome(items)
  if (!outcome) return null

  if (outcome.kind === "failed") {
    const pending = pendingExecutorRequest(items)
    return pending
      ? {
          mode: "continue-now",
          terminalId: outcome.terminalId,
          pending,
        }
      : null
  }

  return quotaExhausted
    ? {
        mode: "next-send",
        terminalId: outcome.terminalId,
        pending: null,
      }
    : null
}
