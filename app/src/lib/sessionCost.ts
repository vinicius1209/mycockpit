// Custo da sessão (helper PURO do fio), extraído de store/chat.ts: aqui não há
// store, só a leitura dos itens de UMA conversa. O store re-exporta
// `sessionCost` pra quem sempre o importou de lá continuar importando de lá.

import type { ChatItem } from "@/store/chat"

/** Os results FINAIS do fio: results SEGUIDOS de outro result são parciais da
 *  mesma invocação e colapsam no último (somá-los inflava a sessão, US$ 120
 *  num turno que custou US$ 31). Uma varredura só, porque "quanto custou" e
 *  "quantos turnos o app não sabe precificar" precisam contar exatamente os
 *  MESMOS turnos — duas regras seriam duas verdades sobre o mesmo fio. */
function* finalResults(
  items: ChatItem[],
): Generator<Extract<ChatItem, { kind: "result" }>> {
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind !== "result" || items[i + 1]?.kind === "result") continue
    yield it
  }
}

/** Custo acumulado da sessão (soma dos turnos com `result`), consciência de
 *  gasto. `turns` conta os results finais (a UI só mostra o custo com ≥2
 *  turnos). Puro, testável, fonte única do strip de custo. */
export function sessionCost(items: ChatItem[]): {
  total: number
  estimated: boolean
  turns: number
} {
  let total = 0
  let estimated = false
  let turns = 0
  for (const it of finalResults(items)) {
    turns++
    total += it.costUsd ?? 0
    if (it.costSource === "estimated" || it.costSource === "unknown")
      estimated = true
  }
  return { total, estimated, turns }
}

/** ADR-047 — turnos que consumiram e ficaram SEM preço (`costUsd` nulo, modelo
 *  fora da tabela de preço). O total acima é soma PARCIAL enquanto isto for
 *  > 0, e a faixa inferior diz isso em vez de somar zero em silêncio. */
export function sessionUnpricedTurns(items: ChatItem[]): number {
  let n = 0
  for (const it of finalResults(items)) if (it.costUsd == null) n++
  return n
}
