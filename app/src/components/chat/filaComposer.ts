// Gestão e ações da fila de mensagens do composer (ADR-046 e melhorias de UX).
//
// Recorte fechado: manipulação da fila de mensagens (edição/desempilhar sem apagar
// anexos, promoção de prioridade e disparo de envio forçado com interrupção).

import { useChat, type QueuedMsg } from "@/store/chat"
import type { Attachment } from "@/lib/attachments"
import { cancelConversationTurn } from "@/lib/cancelConversationTurn"
import { marcarCausaDoCorte } from "@/lib/corte"
import { toast } from "sonner"

export async function stopActiveConversation(): Promise<void> {
  const convId = useChat.getState().activeId
  if (!convId) return
  try {
    // Sem toast de sucesso: o marco do corte fica no fio que você está
    // olhando, e o toast só repetiria o fio e sumiria (ADR-180).
    await cancelConversationTurn(convId, "parada")
  } catch (error) {
    console.error("falha ao parar a conversa", error)
    toast.error("Não consegui parar o turno.")
  }
}

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

/** Com turno rodando, o envio forçado CORTA o turno: a causa vai carimbada para
 *  o marco "você interrompeu" do fio, que é o registro (ADR-180). Toast ali
 *  repetiria o fio e sumiria. Sem turno rodando não há corte, e o aviso segue. */
function dispatchNotice(convId: string): void {
  const conv = useChat.getState().byId[convId]
  if (conv?.running) {
    marcarCausaDoCorte(convId, "correcao")
    return
  }
  toast(
    conv?.finalizing
      ? "A fila será enviada assim que o turno fechar."
      : "Enviando a fila…",
  )
}

/** O item escolhido vira o primeiro do lote e o dono garante o despacho. */
export function forceSendQueued(
  convId: string,
  index: number,
  onDispatch: (id: string) => Promise<unknown>,
): void {
  const queued = useChat.getState().byId[convId]?.queued ?? []
  if (index < 0 || index >= queued.length) return
  if (index > 0) {
    promoteQueued(convId, index)
  }
  dispatchNotice(convId)
  void onDispatch(convId).catch((error) => {
    console.error("falha ao interromper o turno para enviar a fila", error)
    toast.error("Não consegui interromper o turno. A mensagem continua na fila.")
  })
}

/** Envio forçado direto do rascunho:
 *  enfileira o rascunho no início da fila, limpa o composer e pede ao dono o
 *  despacho garantido no alvo explícito. */
export function forceSendDraft(
  convId: string,
  text: string,
  attachments: Attachment[],
  clearDraft: () => void,
  onDispatch: (id: string) => Promise<unknown>,
): void {
  if (!text.trim() && attachments.length === 0) return
  enqueueFront(convId, text, attachments)
  clearDraft()
  dispatchNotice(convId)
  void onDispatch(convId).catch((error) => {
    console.error("falha ao interromper o turno para enviar a fila", error)
    toast.error("Não consegui interromper o turno. A mensagem continua na fila.")
  })
}

/** A lista com o item de `de` levado para `para` (ADR-240: reordenar a fila
 *  arrastando). Índice fora do intervalo devolve a lista como está. Puro. */
export function moverItem<T>(lista: readonly T[], de: number, para: number): T[] {
  if (de === para || de < 0 || de >= lista.length || para < 0 || para >= lista.length) return [...lista]
  const copia = [...lista]
  const [item] = copia.splice(de, 1)
  copia.splice(para, 0, item)
  return copia
}

/** Reordena a fila da conversa. A ordem é a do envio: elas vão juntas, na
 *  ordem em que estão. */
export function moverNaFila(convId: string, de: number, para: number): void {
  useChat.setState((s) => {
    const c = s.byId[convId]
    if (!c?.queued) return s
    return { byId: { ...s.byId, [convId]: { ...c, queued: moverItem(c.queued, de, para) } } }
  })
}
