import { ConversationMapPanel } from "@/components/layout/ConversationMapPanel"
import { useChat } from "@/store/chat"

export function ActiveConversationMapPanel({
  conversationId,
  projectId,
  title,
}: {
  conversationId: string | null
  projectId: string
  title: string | null
}) {
  const conversation = useChat((state) =>
    conversationId ? state.byId[conversationId] : undefined,
  )
  return (
    <ConversationMapPanel
      conversationId={conversationId}
      projectId={projectId}
      items={conversation?.items}
      title={title}
      running={conversation?.running ?? false}
      finalizing={conversation?.finalizing ?? false}
    />
  )
}
