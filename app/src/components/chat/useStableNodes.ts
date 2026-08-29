// Nós de render do fio, memoizados de forma INCREMENTAL — e a janela que o
// transcript aplica sobre eles.
//
// Mora aqui, e não dentro do MessageList, porque há mais de uma superfície
// lendo o MESMO fio: o transcript pinta os grupos e o TurnScrubber pinta a
// régua lateral que navega até eles. Chamar `buildNodes(items)` cru numa
// segunda superfície refazia a DOBRA INTEIRA a cada `text_delta` (é fold com
// vizinhança, não `map` — ver nodesMemo.ts) e, pior, produzia keys de grupo
// DIFERENTES das do transcript quando o `placeNotes` não era aplicado igual.
// Dois consumidores, uma regra só.

import { useMemo, useRef } from "react"
import { placeNotes } from "@/lib/notes"
import { buildNodesMemo, type NodesMemo } from "@/components/chat/nodesMemo"
import { reuseNodes, type Node } from "@/components/chat/messageNodes"
import type { ChatItem } from "@/store/chat"

/** Teto de nós pintados de uma vez. Conversa longa (já vimos 665KB de items)
 *  renderizava TUDO — com diffs abertos por padrão o DOM explodia. */
export const CHAT_WINDOW = 150

/** Nós de render com a IDENTIDADE preservada entre frames (`reuseNodes`) e
 *  reconstruídos só na FAIXA que o token mexeu (`nodesMemo`) — abaixo de
 *  `rebuiltFrom` os nós já SÃO os do frame anterior, e a dobra nem passa lá. */
export function useStableNodes(items: ChatItem[]): Node[] {
  const memo = useRef<NodesMemo | null>(null)
  return useMemo(() => {
    const prev = memo.current
    const next = buildNodesMemo(prev, placeNotes(items))
    memo.current = next
    return prev ? reuseNodes(prev.nodes, next.nodes, next.rebuiltFrom) : next.nodes
  }, [items])
}

/** Quantos nós a janela esconde no começo do fio. `0` = fio inteiro na tela. */
export function hiddenNodeCount(total: number, showAll: boolean): number {
  return showAll ? 0 : Math.max(0, total - CHAT_WINDOW)
}
