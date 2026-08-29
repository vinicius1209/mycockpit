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

import { useEffect, useMemo, useRef, useState } from "react"
import { placeNotes } from "@/lib/notes"
import { buildNodesMemo, type NodesMemo } from "@/components/chat/nodesMemo"
import { reuseNodes, type Node } from "@/components/chat/messageNodes"
import type { ChatItem } from "@/store/chat"

/** Teto de nós pintados de uma vez. Conversa longa (já vimos 665KB de items)
 *  renderizava TUDO — com diffs abertos por padrão o DOM explodia. */
export const CHAT_WINDOW = 150

/**
 * Quantos nós a PRIMEIRA pintura monta.
 *
 * O `perf-fio-plan` mediu o custo por TOKEN e o resolveu. O que ninguém tinha
 * medido é o custo de ABRIR — e ele não está no dado: numa conversa real de
 * 3,18 MB (1669 itens, 547 nós), ler do disco custa 4,9ms, `JSON.parse` 6,1ms
 * e `buildNodes` **0,9ms**. O que trava é o React montando 150 nós de uma vez,
 * cada nó de prosa passando por react-markdown + remark-gfm + rehype-highlight
 * num único commit síncrono.
 *
 * A cauda é o que importa: você aterrissa no FIM. 40 nós cobrem a primeira
 * tela com folga; os outros 110 entram quando o navegador estiver ocioso, e a
 * ancoragem (que segue o reflow até o layout sossegar) reancora sozinha quando
 * eles chegam.
 */
export const JANELA_INICIAL = 40

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

/**
 * Quantos nós a janela esconde no começo do fio. `0` = fio inteiro na tela.
 *
 * `janela` é parâmetro pra permitir a montagem em duas etapas (primeira
 * pintura curta, depois o teto). O default é o teto: quem não pede nada — o
 * TurnScrubber, por exemplo — enxerga a mesma janela de sempre.
 */
export function hiddenNodeCount(
  total: number,
  showAll: boolean,
  janela: number = CHAT_WINDOW,
): number {
  return showAll ? 0 : Math.max(0, total - janela)
}

/**
 * A janela da PRIMEIRA pintura, que cresce sozinha até o teto.
 *
 * Não precisa de reset por conversa: o `ChatPanel` põe `key={activeId}` no
 * wrapper do transcript, então trocar de fio REMONTA a árvore e o estado volta
 * ao inicial por construção — resetar à mão aqui seria uma segunda verdade
 * sobre "quando a janela recomeça".
 */
export function useJanelaProgressiva(): number {
  const [janela, setJanela] = useState(JANELA_INICIAL)
  useEffect(() => {
    if (janela >= CHAT_WINDOW) return
    const expandir = () => setJanela(CHAT_WINDOW)
    // `requestIdleCallback` é o certo (roda depois da primeira pintura), mas
    // nem todo motor tem — e o WebKit do Tauri é justamente um que não tem.
    // O rAF + timeout cobre com a mesma ordem: pinta, depois expande.
    const ric = window.requestIdleCallback
    if (ric) {
      const id = ric(expandir, { timeout: 600 })
      return () => window.cancelIdleCallback?.(id)
    }
    const id = requestAnimationFrame(() => setTimeout(expandir, 0))
    return () => cancelAnimationFrame(id)
  }, [janela])
  return janela
}
