// Gestão e ações da fila de mensagens do composer (ADR-046 e melhorias de UX).
//
// Recorte fechado: manipulação da fila de mensagens (edição/desempilhar sem apagar
// anexos, promoção de prioridade e disparo de envio forçado com interrupção).

import { useChat, type QueuedMsg } from "@/store/chat"
import type { Attachment } from "@/lib/attachments"
import { toast } from "sonner"

/** Extrai uma mensagem da fila sem apagar os blobs dos seus anexos do disco
 *  (usado ao editar/desempilhar de volta no composer). */
export function pullQueued(convId: string, index: number): QueuedMsg | null {
  const chat = useChat.getState()
  const cur = chat.byId[convId]
  if (!cur?.queued || index < 0 || index >= cur.queued.length) return null

  const item = cur.queued[index]
  useChat.setState((s) => {
    const c = s.byId[convId]
    if (!c?.queued) return s
    return {
      byId: {
        ...s.byId,
        [convId]: {
          ...c,
          queued: c.queued.filter((_, i) => i !== index),
        },
      },
    }
  })
  return item
}

/** Move o item na posição `index` para a primeira posição da fila (índice 0). */
export function promoteQueued(convId: string, index: number): void {
  const chat = useChat.getState()
  const cur = chat.byId[convId]
  if (!cur?.queued || index <= 0 || index >= cur.queued.length) return

  const item = cur.queued[index]
  const rest = cur.queued.filter((_, i) => i !== index)
  useChat.setState((s) => {
    const c = s.byId[convId]
    if (!c?.queued) return s
    return {
      byId: {
        ...s.byId,
        [convId]: {
          ...c,
          queued: [item, ...rest],
        },
      },
    }
  })
}

/** Enfileira uma mensagem prioritária no início da fila. */
export function enqueueFront(
  convId: string,
  text: string,
  attachments: Attachment[] = [],
): void {
  useChat.setState((s) => {
    const cur = s.byId[convId]
    if (!cur) return s
    return {
      byId: {
        ...s.byId,
        [convId]: {
          ...cur,
          queued: [{ text, attachments }, ...(cur.queued ?? [])],
        },
      },
    }
  })
}

/** Envio forçado da fila a partir de um item existente: ele vira o primeiro do
 *  lote e o turno ativo é interrompido; o `finally` do handleSend drena o lote
 *  completo imediatamente no novo turno. */
export function forceSendQueued(
  convId: string,
  index: number = 0,
  onStop?: () => void,
): void {
  if (index > 0) {
    promoteQueued(convId, index)
  }
  toast("Interrompendo turno para enviar a fila…")
  onStop?.()
}

/** Envio forçado direto do rascunho:
 *  enfileira o rascunho no início da fila, limpa o composer e cancela o
 *  turno ativo via onStop para disparar o novo turno na hora. */
export function forceSendDraft(
  convId: string,
  text: string,
  attachments: Attachment[],
  clearDraft: () => void,
  onStop?: () => void,
): void {
  if (!text.trim() && attachments.length === 0) return
  enqueueFront(convId, text, attachments)
  clearDraft()
  toast("Interrompendo turno para enviar o rascunho e a fila…")
  onStop?.()
}
