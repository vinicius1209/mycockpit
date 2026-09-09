// PARECER DE CONSELHEIRO no fio (Especialistas E1/E3).
//
// Extraído do `store/chat.ts` pela catraca de tamanho, e o corte foi coeso: as
// três funções aqui são o ciclo de vida de um parecer — ele CHEGA (item
// `advice` no fio), é TRAZIDO pro executor (vira contexto do próximo turno) e
// pode ser TIRADO da conversa.
//
// Duas regras que este arquivo carrega e que não são óbvias no código:
//
//  • "Trazer pro executor" ACUMULA. Dois pareceres trazidos viram um bloco só,
//    na ordem em que você trouxe. Substituir seria perder o primeiro em
//    silêncio, e quem clicou duas vezes quis os dois.
//  • `takePendingAdvice` CONSOME. Ele é chamado no envio, e limpar ali é o que
//    impede o mesmo parecer de entrar em dois turnos seguidos. Não persiste de
//    propósito: quem persiste é o caminho de envio, depois do aceite.
//
// `get`/`patch` chegam por parâmetro em vez de import: é o padrão dos outros
// módulos de `store/chat/`, e é o que deixa o comportamento testável sem montar
// a store inteira.

import type { ChatState } from "@/store/chat"

type Get = () => ChatState
type Patch = (convId: string, partial: Partial<ChatState["byId"][string]>) => void

/** Traz o parecer pro próximo turno do executor, acumulando com o que já foi
 *  trazido. Não vira bolha: entra como bloco no prompt. */
export function bringAdviceToExecutorImpl(
  get: Get,
  patch: Patch,
  convId: string,
  block: string,
): void {
  const cur = get().byId[convId]
  if (!cur) return
  const next = cur.pendingAdvice ? `${cur.pendingAdvice}\n\n${block}` : block
  patch(convId, { pendingAdvice: next })
}

/** Consome o que foi trazido (uma vez só) e devolve pro caminho de envio. */
export function takePendingAdviceImpl(
  get: Get,
  patch: Patch,
  convId: string,
): string | null {
  const cur = get().byId[convId]
  const block = cur?.pendingAdvice ?? null
  if (block) patch(convId, { pendingAdvice: undefined })
  return block
}

/** Tirar da conversa (E3): remove TODOS os pareceres daquela persona. A
 *  presença na faixa é DERIVADA dos itens, então a persona some de lá sozinha.
 *  Mesma escrita do `removeThreadItem`, filtrando por `personaId` em vez de id
 *  do item — e este SIM persiste, porque apagar item é mudança do fio. */
export function removeAdviceImpl(
  get: Get,
  patch: Patch,
  convId: string,
  personaId: string,
): void {
  const cur = get().byId[convId]
  if (!cur) return
  patch(convId, {
    items: cur.items.filter(
      (it) => !(it.kind === "advice" && it.personaId === personaId),
    ),
  })
  void get().persist(convId)
}
