import type { ComponentProps } from "react"
import { MessageList } from "@/components/chat/MessageList"
import { normalizeConversationScale } from "@/lib/conversationScale"
import { useApp } from "@/store/app"

/** Aplica zoom só ao transcript. A largura inversa conserva a coluna física de
 *  760px e faz o texto refluir como no browser, sem ampliar o chrome/composer. */
export function ScaledMessageList(props: ComponentProps<typeof MessageList>) {
  const scale = useApp((s) =>
    normalizeConversationScale(s.settings.conversationScale),
  )
  return (
    <div
      data-conversation-scale={scale}
      style={{
        width: `${100 / scale}%`,
        maxWidth: `${760 / scale}px`,
        zoom: scale,
      }}
      className="mx-auto min-w-0"
    >
      <MessageList {...props} />
    </div>
  )
}
