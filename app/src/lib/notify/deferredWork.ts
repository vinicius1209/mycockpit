import { notifyDeferredEnd } from "@/lib/notify"
import type { AgentEvent } from "@/lib/agent"

const notifiedKeys = new Set<string>()

/**
 * Dispara notificação quando um trabalho em background atinge desfecho terminal
 * (completed ou stopped/interrupted), deduplicando por tentativa e desfecho (SPEC F4).
 */
export function maybeNotifyDeferredEvent(convId: string, event: AgentEvent) {
  if (event.type !== "deferred_work") return
  if (event.status !== "completed" && event.status !== "stopped") return

  const key = `${convId}:${event.id}:${event.status}`
  if (notifiedKeys.has(key)) return
  notifiedKeys.add(key)

  notifyDeferredEnd({
    convId,
    name: event.name,
    status: event.status === "completed" ? "completed" : "interrupted",
    summary: event.summary,
  })
}

/** Limpa chaves de deduplicação (usado em testes). */
export function resetDeferredNotifiedKeysForTest() {
  notifiedKeys.clear()
}
