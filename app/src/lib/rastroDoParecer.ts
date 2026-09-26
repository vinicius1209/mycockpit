// O RASTRO de um parecer levado ao executor (ADR-267, mock
// `docs/mocks/especialista-na-conversa.html`, seção C). O bloco do parecer sai
// do rascunho no envio; o pedido guarda `pareceres`, e os dois lados se
// apontam: a mensagem enviada diz de quem era o parecer que levou, e o parecer
// diz em que pedido foi levado. Puro sobre os itens do fio.

import type { ChatItem } from "@/store/chat"

/** O primeiro pedido seu que levou este parecer, ou `null`. Puro. */
export function pedidoQueLevou(items: readonly ChatItem[], adviceId: string): Extract<ChatItem, { kind: "user" }> | null {
  for (const it of items) {
    if (it.kind === "user" && it.pareceres?.some((p) => p.itemId === adviceId)) return it
  }
  return null
}

/** O parecer que um pedido levou, se ainda estiver no fio. Puro. */
export function parecerLevado(items: readonly ChatItem[], itemId: string): Extract<ChatItem, { kind: "advice" }> | null {
  const it = items.find((i) => i.id === itemId)
  return it?.kind === "advice" ? it : null
}

/** O começo do parecer, numa linha, para a citação: sem título markdown e sem
 *  quebra, cortado na palavra. Puro. */
export function trechoDoParecer(texto: string, max = 60): string {
  const linha = texto
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim())
    .find((l) => l.length > 0 && !/^parecer d/i.test(l)) ?? ""
  if (linha.length <= max) return linha
  const corte = linha.slice(0, max)
  return `${corte.slice(0, Math.max(corte.lastIndexOf(" "), max - 12)).trim()}…`
}
