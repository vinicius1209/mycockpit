// A ordem MANUAL das conversas de um projeto (S1.2).
//
// Extraído de store/chat.ts pela catraca, mesmo padrão de clone.ts, notes.ts,
// remove.ts e planGate.ts: recorte fechado, não pedaço partido pra caber.
//
// As duas ações eram gêmeas linha a linha — arrastar e mover por teclado
// diferem SÓ na função que calcula a lista nova. Juntá-las aqui deixou a parte
// que importa (o espelho duplo + a renumeração) escrita uma vez: o estado da
// ordem vive em dois lugares (`conversationsByProject` e o espelho
// `conversations` do projeto ativo), e atualizar um e esquecer o outro é
// exatamente o tipo de divergência que só aparece depois, na tela errada.

import type { ConversationMeta } from "@/lib/db/conversations"
import { persistConversationOrder } from "@/lib/db/conversations"
import { moveByDelta, reorderByIds } from "@/lib/reorder"
import type { ChatState } from "@/store/chat"

type Get = () => ChatState
type Set = (fn: (s: ChatState) => Partial<ChatState>) => void

/**
 * Aplica uma lista nova: espelho duplo + renumeração do `sort_order`.
 *
 * `next === cur` (mesma REFERÊNCIA) é o no-op dos helpers puros de reordenação
 * — solto num alvo inválido, ou mover pra fora da ponta. Sair aqui evita gravar
 * no banco uma ordem que não mudou.
 */
function aplica(
  get: Get,
  set: Set,
  projectId: string,
  recalcula: (cur: ConversationMeta[]) => ConversationMeta[],
): void {
  const cur = get().conversationsByProject[projectId]
  if (!cur) return
  const next = recalcula(cur)
  if (next === cur) return
  set((s) => ({
    conversationsByProject: { ...s.conversationsByProject, [projectId]: next },
    // O espelho só acompanha se o projeto reordenado É o aberto; mexer nele a
    // partir de outro projeto trocaria a lista debaixo do usuário.
    conversations: projectId === s.projectId ? next : s.conversations,
  }))
  void persistConversationOrder(
    projectId,
    next.map((c) => c.id),
  )
}

/** Arrastar e soltar: `dragId` vai para a posição de `overId`. */
export function reorderConversationsImpl(
  get: Get,
  set: Set,
  projectId: string,
  dragId: string,
  overId: string,
): void {
  aplica(get, set, projectId, (cur) => reorderByIds(cur, dragId, overId))
}

/** Mover por teclado: UM passo pra cima (-1) ou pra baixo (+1). O tipo é
 *  `1 | -1` e não `number` — "mover 3" não é um gesto que exista aqui. */
export function moveConversationImpl(
  get: Get,
  set: Set,
  projectId: string,
  id: string,
  delta: 1 | -1,
): void {
  aplica(get, set, projectId, (cur) => moveByDelta(cur, id, delta))
}
