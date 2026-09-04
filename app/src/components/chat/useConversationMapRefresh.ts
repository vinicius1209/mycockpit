import { useEffect } from "react"
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
  useEffect(() => {
    if (!input.conversationId || !input.projectId) return
    scheduleRefresh({
      conversationId: input.conversationId,
      projectId: input.projectId,
      items: input.items,
      running: input.running,
      finalizing: input.finalizing,
    })
  }, [
    input.conversationId,
    input.finalizing,
    input.items,
    input.projectId,
    input.running,
    scheduleRefresh,
  ])
}
