// Escrita das notas do humano no fio — extraída de store/chat.ts (arquivo no
// teto da catraca), mesmo padrão de store/chat/clone.ts. O núcleo PURO das
// notas (o que fica pendente, como o bloco chega ao agente, onde a nota
// aparece na tela) mora em lib/notes.ts; aqui só a mutação da store.

import type { ChatState } from "@/store/chat"

type Get = () => ChatState
type Set = (fn: (s: ChatState) => Partial<ChatState>) => void

/** Carimba as notas como ENTREGUES: sem isto elas voltariam no prompt de todo
 *  turno seguinte, virando um acumulador de instrução (ver lib/notes). */
export function markNotesSentImpl(
  get: Get,
  set: Set,
  convId: string,
  ids: string[],
): void {
  const cur = get().byId[convId]
  if (!cur || ids.length === 0) return
  const alvo = new Set(ids)
  const items = cur.items.map((it) =>
    it.kind === "note" && alvo.has(it.id) ? { ...it, sent: true } : it,
  )
  set((s) => ({ byId: { ...s.byId, [convId]: { ...s.byId[convId], items } } }))
  void get().persist(convId)
}
