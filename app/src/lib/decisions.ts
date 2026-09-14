// Regra PURA da faixa de decisão pendente (o "precisa de você" do chrome).
//
// A faixa é chrome, não aba: visibilidade permanente só existe em elemento de
// moldura (ADR-040). Duas consequências que moram aqui, longe do React:
//
// 1. **Sem conteúdo, a faixa não existe.** `stripSummary` devolve null com a
//    fila vazia — não "vazio", não placeholder, não altura reservada (§5).
// 2. **Ela fala de DECISÃO, nunca do agora.** Nada de "2 em voo": a linha viva
//    do turno é a dona única do que está rodando (§6, B2.2). O que entra aqui
//    é o que está PARADO esperando um gesto humano.
//
// A idade só aparece quando existe carimbo real: decisão sem timestamp não
// ganha idade inventada (§7).

import type { Decision } from "@/lib/inbox"
import { fmtAgo } from "@/lib/format"

/** Timestamp (epoch ms) da decisão, quando ela tem um. null = sem carimbo
 *  (card do board e disputa recém-nascida no store não têm). */
export function decisionTs(d: Decision): number | null {
  if (d.kind === "proposal") return d.createdAt
  if (d.kind === "fusion") return d.createdAt ?? null
  return null
}

/** Substantivo da decisão, singular e plural (o resumo agregado da faixa). */
export function decisionNoun(d: Decision, plural: boolean): string {
  switch (d.kind) {
    case "fusion":
      return plural ? "disputas" : "disputa"
    case "card":
      return plural ? "cards" : "card"
    case "proposal":
      return plural ? "propostas" : "proposta"
  }
}

/** A frase de UMA decisão (o caso mais comum da fila, pela evidência de uso):
 *  diz o que é, de qual projeto, sem prometer ação nenhuma. */
export function decisionLine(d: Decision): string {
  switch (d.kind) {
    case "fusion":
      return `Disputa esperando veredito · ${d.projectName}`
    case "card":
      return `Card ${d.state === "blocked" ? "bloqueado" : "em revisão"}: ${d.title} · ${d.projectName}`
    case "proposal":
      return `Proposta do lead · ${d.projectName ?? "board inteiro"}`
  }
}

/** Contagem por tipo, na ordem em que os tipos aparecem na fila (que já vem
 *  ordenada por urgência): "2 disputas, 1 card". */
export function decisionBreakdown(pending: Decision[]): string {
  const order: Decision["kind"][] = []
  const byKind = new Map<Decision["kind"], { n: number; d: Decision }>()
  for (const d of pending) {
    const cur = byKind.get(d.kind)
    if (cur) cur.n += 1
    else {
      byKind.set(d.kind, { n: 1, d })
      order.push(d.kind)
    }
  }
  return order
    .map((k) => {
      const { n, d } = byKind.get(k)!
      return `${n} ${decisionNoun(d, n > 1)}`
    })
    .join(", ")
}

export interface StripSummary {
  /** Quantas decisões esperam você (o número que a faixa mostra). */
  count: number
  /** Texto principal, já pronto pra truncar. */
  text: string
  /** "há 4 h" da MAIS ANTIGA com carimbo, ou null (nenhuma tem). */
  ageText: string | null
}

/** O estado da faixa. `null` = a faixa NÃO EXISTE (nada esperando você).
 *  Com uma decisão só, a faixa diz qual é; com várias, agrega por tipo. */
export function stripSummary(
  pending: Decision[],
  now = Date.now(),
): StripSummary | null {
  if (pending.length === 0) return null
  const stamps = pending
    .map(decisionTs)
    .filter((t): t is number => t != null && t <= now)
  const oldest = stamps.length > 0 ? Math.min(...stamps) : null
  return {
    count: pending.length,
    text:
      pending.length === 1
        ? decisionLine(pending[0])
        : `${pending.length} esperando você · ${decisionBreakdown(pending)}`,
    ageText: oldest != null ? `a mais antiga ${fmtAgo(now - oldest)}` : null,
  }
}
