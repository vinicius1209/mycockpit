// O gate do "Planejar primeiro" no fio — gravar o plano proposto e carimbar a
// decisão do humano.
//
// Extraído de store/chat.ts (no teto do ratchet), mesmo padrão de clone.ts,
// notes.ts e remove.ts: um recorte fechado, não um pedaço partido pra caber.
//
// Por que virou item e não campo: `pendingPlan` era estado de runtime, e uma
// DECISÃO DO HUMANO não sobrevive aí. Relato real — o plano do agy foi
// proposto, o cartão apareceu, o app reiniciou, e a conversa no banco não tinha
// nada: 31 `tool`, 2 `user`, 2 `text`, 2 `result`. Item vive em `items`, que o
// `dbSave` já grava, então a durabilidade vem de graça — e a decisão vira
// HISTÓRICO em vez de estado que some.

import type { ChatItem, ChatState } from "@/store/chat"
import { uid } from "@/store/chat"

type Get = () => ChatState
type Set = (fn: (s: ChatState) => Partial<ChatState>) => void

/** Fim de um turno `plan_first` que deu certo: o plano entra no fio esperando
 *  decisão. Sem `decision` = ainda na mesa (ver `pendingPlanGate`). */
export function pushPlanGateImpl(get: Get, set: Set, convId: string, text: string) {
  const id = uid()
  set((s) => {
    const cur = s.byId[convId]
    if (!cur) return {}
    const item: ChatItem = { kind: "planGate", id, text }
    return { byId: { ...s.byId, [convId]: { ...cur, items: [...cur.items, item] } } }
  })
  void get().persist(convId)
  // O gate entra na FILA de interações junto: é dela que vêm o ponto na
  // sidebar, o sino, a tray, a nativa e o Companion. Antes o cartão existia só
  // na tela da conversa aberta — podia te esperar em silêncio (lib/planGate).
  //
  // Import DINÂMICO, mesma razão do mission/fusion em store/chat/remove.ts:
  // `store/interactions` importa `store/chat` de volta, e um import estático
  // fecharia o ciclo (foi assim que a suíte da missão quebrou com
  // "window is not defined" — o ciclo puxava o módulo errado no boot).
  void import("@/lib/planGate").then((m) => {
    m.enqueuePlanGate(convId, id, text)
    // E o plano anterior desta conversa, se havia, foi SUPERADO por este.
    m.supersedeOldGates(convId, id)
  })
}

/**
 * Carimba a decisão. NÃO apaga o item: o cartão vira uma linha de histórico, e
 * "eu autorizei esse plano?" passa a ter resposta uma semana depois.
 *
 * A primeira decisão vence — carimbar de novo não sobrescreve. Um clique duplo,
 * ou um envio que cruze com o gesto, não pode transformar "descartado" em
 * "aprovado" pelas costas.
 */
export function decidePlanGateImpl(
  get: Get,
  set: Set,
  convId: string,
  id: string,
  decision: "approved" | "discarded" | "superseded",
) {
  set((s) => {
    const cur = s.byId[convId]
    if (!cur) return {}
    // Preserva a REFERÊNCIA dos itens que não mudaram: o `memo` por item do
    // MessageList compara por identidade, e recriar o fio inteiro aqui
    // re-renderizaria markdown de conversa longa por causa de um carimbo.
    let mexeu = false
    const items = cur.items.map((it) => {
      if (it.kind !== "planGate" || it.id !== id || it.decision) return it
      mexeu = true
      return { ...it, decision }
    })
    if (!mexeu) return {}
    return { byId: { ...s.byId, [convId]: { ...cur, items } } }
  })
  void get().persist(convId)
  // Decidido = sai da fila. Sem isto o ponto de "precisa de você" ficaria aceso
  // depois de você já ter decidido.
  void import("@/lib/planGate").then((m) => m.dequeuePlanGate(id))
}
