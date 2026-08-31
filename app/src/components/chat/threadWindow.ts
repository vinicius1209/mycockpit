// Escopo do fio: a JANELA de render (CHAT_WINDOW) é aplicada sobre NÓS, mas as
// derivações que a alimentam varriam o fio INTEIRO — 1.885 itens varridos por
// token para servir ~150 nós. Aqui mora o pedaço que falta: dado o primeiro nó
// visível, qual FATIA de itens a janela pode citar.
//
// A garantia que sustenta tudo: `buildNodes` percorre `items` em ordem e usa
// como `key` do nó o id do PRIMEIRO item do trecho que ele cobre. Logo as keys
// dos nós são monótonas no índice dos itens, e todo item que um nó VISÍVEL
// referencia está em `windowStartIndex(items, visible[0].key)` ou depois.
// Errar aqui é dado faltando na tela (hora sumida, selo de anexo perdido), não
// lentidão — por isso cada função degrada para o fio inteiro quando não
// reconhece a chave, nunca para "menos".
import type { ChatItem } from "@/store/chat"

/** Durante o flush final, o `result` já é fonte de verdade no store, mas ainda
 * não é o último marco VISUAL: `done` precisa assentar o turno primeiro. */
export function visibleThreadItems(items: ChatItem[], finalizing: boolean): ChatItem[] {
  const last = items[items.length - 1]
  return finalizing && last?.kind === "result" ? items.slice(0, -1) : items
}

/** Índice do primeiro item que a janela visível pode referenciar.
 *
 *  Varre de trás pra frente: o custo é o tamanho da JANELA, não o do fio.
 *  - `firstVisibleKey` nula (nada visível) → `items.length`, fatia vazia.
 *  - chave desconhecida (nó sem item correspondente, histórico curado) → `0`,
 *    ou seja, o comportamento de hoje. Degradar pro fio inteiro custa tempo;
 *    degradar pra fatia curta esconderia informação.
 *
 *  **Pré-condição: `id` de item é ÚNICO no fio.** Vale hoje por construção (o
 *  reducer carimba `uid()`, um uuid, em todo item), e a busca de trás pra frente
 *  devolve a ocorrência MAIS RECENTE. Com id repetido, a fatia começaria DEPOIS
 *  do nó que a pediu, que é justamente a direção proibida (informação sumindo da
 *  tela em vez de lentidão). Se um dia ids puderem repetir, esta função vira
 *  busca da PRIMEIRA ocorrência, não uma otimização a mais. */
export function windowStartIndex(
  items: ChatItem[],
  firstVisibleKey: string | null | undefined,
): number {
  if (!firstVisibleKey) return items.length
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].id === firstVisibleKey) return i
  }
  return 0
}

/** Carimbo dos itens que ABREM os grupos visíveis, e só deles.
 *
 *  O cabeçalho de grupo é o único consumidor de `ts` na lista, e são ~20
 *  consultas. `new Map(items.map(...))` alocava 1.885 tuplas por token pra
 *  servir essas 20. Aqui a varredura é de trás pra frente, com early-exit assim
 *  que todas as chaves pedidas foram achadas — na prática ela para no começo da
 *  janela, e o mapa nasce do tamanho do número de grupos. Medido no fio real
 *  (1.885 itens, 200 tokens): 0,1065 → 0,0163 ms/token, contra 0,0328 da
 *  variante "mapa da fatia inteira" que também foi medida.
 *
 *  Vai até o índice 0 de propósito: se algum grupo abrir num item mais antigo do
 *  que a janela sugere, a hora aparece do mesmo jeito (o early-exit é que paga a
 *  conta, não um corte cego). Item sem `ts` → `undefined`, e a UI omite a hora. */
export function tsForGroups(
  items: ChatItem[],
  groups: { nodes: { key: string }[] }[],
): Map<string, number | undefined> {
  const faltam = new Set<string>()
  for (const g of groups) {
    const k = g.nodes[0]?.key
    if (k) faltam.add(k)
  }
  const out = new Map<string, number | undefined>()
  for (let i = items.length - 1; i >= 0 && faltam.size > 0; i--) {
    const it = items[i]
    if (!faltam.has(it.id)) continue
    faltam.delete(it.id)
    out.set(it.id, it.ts)
  }
  return out
}

/** Índice do item do usuário que abre o turno de `from` (ou 0 se não houver).
 *
 *  Acumuladores por turno (`feedbackTextByResult`) zeram em cada item do
 *  usuário: começar a varredura no início do turno dá EXATAMENTE o mesmo
 *  resultado para tudo que vem de `from` em diante, sem varrer o que veio antes.
 *
 *  **Acoplamento declarado:** o predicado daqui (`kind === "user"`) é o MESMO
 *  que zera o acumulador em `feedbackTextByResult`, e as duas funções só podem
 *  mudar juntas. Reduzir o reset de lá (zerar em mais um tipo de item, por
 *  exemplo) sem mexer aqui faria este ponto de partida cair no meio de um estado
 *  que ele não reconstrói. O teste
 *  "o ponto de partida zera o acumulador" trava o par. */
export function turnStartIndex(items: ChatItem[], from: number): number {
  for (let i = Math.min(from, items.length - 1); i >= 0; i--) {
    if (items[i].kind === "user") return i
  }
  return 0
}

/** Contexto consolidado do executor para o feedback do resultado. Recomeça em
 * cada item do usuário; tools/subagentes não vazam como se fossem a resposta
 * principal.
 *
 * `from` é o início do TURNO que contém a janela (ver `turnStartIndex`): o mapa
 * sai idêntico para todo resultado dali em diante, que é tudo que a tela lê.
 *
 * O item que ZERA o acumulador aqui (`kind === "user"`) é o mesmo que
 * `turnStartIndex` procura. Mexer neste predicado sem mexer no de lá quebra a
 * equivalência silenciosamente: o mapa continua saindo, com o texto errado. */
export function feedbackTextByResult(
  items: ChatItem[],
  from = 0,
): Map<string, string> {
  const out = new Map<string, string>()
  let parts: string[] = []
  let previousResult: string | null = null
  for (let i = Math.max(0, from); i < items.length; i++) {
    const item = items[i]
    if (item.kind === "user") {
      parts = []
      previousResult = null
      continue
    }
    if (item.kind === "text" && item.text.trim()) {
      parts.push(item.text)
      continue
    }
    if (item.kind === "result") {
      // Alguns providers publicam envelopes parciais. Dentro do mesmo pedido,
      // só o resultado mais recente é um alvo de feedback.
      if (previousResult) out.delete(previousResult)
      const joined = parts.join("\n\n").trim()
      out.set(item.id, joined || item.text?.trim() || "")
      previousResult = item.id
    }
  }
  return out
}
