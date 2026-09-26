// Peças comuns aos cartões de pedido (aprovação, pergunta, recurso). Saíram
// do `InteractionHost.tsx` pela catraca de tamanho (ADR-261).

import { X } from "lucide-react"
import type { InteractionOrigin } from "@/store/interactions"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

/** Leva você até a conversa dona do pedido (mesmo gesto do sino/tray): projeto
 *  ativo + conversa aberta + modo linear. Lá o card renderiza inline, com o
 *  contexto do turno em volta — que é onde dá pra decidir de verdade. */
export async function goToOrigin(origin: InteractionOrigin) {
  const app = useApp.getState()
  app.setActiveProject(origin.projectId)
  await useChat.getState().openProject(origin.projectId)
  await useChat.getState().switchConversation(origin.convId)
  app.setViewMode("linear")
}

export function QueueHint({ extra }: { extra: number }) {
  if (extra <= 0) return null
  return <span className="text-muted-foreground"> (+{extra} na fila)</span>
}

/** X de dispensar: escape hatch p/ card órfão (run morto) ou pedido indesejado.
 *  Responde fail-closed best-effort e SEMPRE remove o card (nunca trava a UI). */
export function DismissBtn({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      onClick={onDismiss}
      title="Dispensar (nega/cancela)"
      aria-label="Dispensar interação"
      className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
    >
      <X className="size-3.5" />
    </button>
  )
}

