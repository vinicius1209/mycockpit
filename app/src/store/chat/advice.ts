// PARECER DE CONSELHEIRO no fio (Especialistas E1/E3).
//
// Extraído do `store/chat.ts` pela catraca de tamanho.
//
// Em 21/09/2026 o "trazer pro executor" saiu daqui: o parecer trazido virou
// BLOCO DO RASCUNHO (`lib/parecerTrazido.ts`), porque em campo invisível da
// conversa ele não tinha como ser visto, desfeito nem persistido. Ficou o que
// é mesmo do fio: tirar um parecer da conversa.
//
// `get`/`patch` chegam por parâmetro em vez de import: é o padrão dos outros
// módulos de `store/chat/`, e é o que deixa o comportamento testável sem montar
// a store inteira.

import type { ChatState } from "@/store/chat"

type Get = () => ChatState
type Patch = (convId: string, partial: Partial<ChatState["byId"][string]>) => void

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
