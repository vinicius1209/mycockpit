import { useEffect, useMemo, useRef } from "react"
import type { ChatItem } from "@/store/chat"
import { useConversationMaps } from "@/store/conversationMaps"

/**
 * Mantém a leitura da conversa ativa atualizada mesmo com a lateral fechada.
 * A superfície apenas revela o mapa; não é o gatilho que o produz.
 */
export function useConversationMapRefresh(input: {
  conversationId: string | null
  projectId: string | null
  items: readonly ChatItem[]
  running: boolean
  finalizing: boolean
}) {
  const scheduleRefresh = useConversationMaps((state) => state.scheduleRefresh)
  const active = input.running || input.finalizing
  const terminalItemId = useMemo(() => {
    if (active) return null
    for (let index = input.items.length - 1; index >= 0; index--) {
      const item = input.items[index]
      if (
        item.kind === "result" ||
        item.kind === "error" ||
        item.kind === "cancelled" ||
        item.kind === "limit"
      ) {
        return item.id
      }
    }
    return null
  }, [active, input.items])
  const latest = useRef(input)
  latest.current = input
  useEffect(() => {
    const current = latest.current
    if (!current.conversationId || !current.projectId || active) return
    scheduleRefresh({
      conversationId: current.conversationId,
      projectId: current.projectId,
      items: current.items,
      running: false,
      finalizing: false,
    })
  }, [
    input.conversationId,
    input.projectId,
    active,
    scheduleRefresh,
    terminalItemId,
  ])
}
