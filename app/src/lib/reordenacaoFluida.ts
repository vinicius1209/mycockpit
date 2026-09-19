// REORDENAR SEM SALTO (FLIP).
//
// Arrastar uma conversa ou um projeto reescrevia a lista e a tela pulava para a
// ordem nova num quadro. O traço de destino (ADR-216) já diz ONDE vai cair; o
// que faltava é a linha ANDAR até lá, senão a pessoa confere o resultado em vez
// de vê-lo acontecer.
//
// FLIP: mede onde cada linha estava (First), deixa o React reordenar (Last),
// devolve cada uma visualmente ao lugar antigo por `transform` (Invert) e
// anima o transform até zero (Play). O DOM final é sempre o correto — o
// movimento é só a diferença, então nada aqui pode deixar a lista num estado
// que não seja o de verdade.
//
// Duas escolhas que não são detalhe:
//
// 1. A medida é `offsetTop`, não `getBoundingClientRect().top`. O rect é
//    relativo à viewport, então ROLAR a lista mudaria todos os valores e o
//    gesto seguinte animaria linhas que ninguém moveu.
// 2. Linha sem posição anterior NÃO anima. É o ADR-179 aplicado aqui: quem
//    acabou de montar (conversa nova, troca de projeto, primeira pintura)
//    chega pronto; movimento conta reposicionamento, não chegada.

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react"

/** Atributo que marca uma linha como participante da reordenação fluida. */
export const ATRIBUTO_FLUIDO = "data-fluido"

/**
 * Puro: quanto cada id precisa ser deslocado para PARECER que ainda está onde
 * estava. Só entra quem existia antes, existe agora e de fato mudou de lugar —
 * o resto não tem o que animar.
 */
export function deslocamentos(
  antes: ReadonlyMap<string, number>,
  depois: ReadonlyMap<string, number>,
): Map<string, number> {
  const saida = new Map<string, number>()
  for (const [id, y] of depois) {
    const anterior = antes.get(id)
    if (anterior === undefined) continue // nasceu agora: chega pronto
    const delta = anterior - y
    if (delta !== 0) saida.set(id, delta)
  }
  return saida
}

/** Lê um token de duração do CSS (§6: duração vem de token, não de número
 *  solto no componente). Sem token, ou com valor ilegível, devolve o padrão. */
export function duracaoDoToken(valor: string | undefined, padrao = 200): number {
  if (!valor) return padrao
  const texto = valor.trim()
  const n = Number.parseFloat(texto)
  if (!Number.isFinite(n) || n <= 0) return padrao
  return texto.endsWith("ms") ? n : texto.endsWith("s") ? n * 1000 : padrao
}

function medir(container: HTMLElement): Map<string, number> {
  const mapa = new Map<string, number>()
  for (const el of container.querySelectorAll<HTMLElement>(`[${ATRIBUTO_FLUIDO}]`)) {
    const id = el.getAttribute(ATRIBUTO_FLUIDO)
    if (id) mapa.set(id, el.offsetTop)
  }
  return mapa
}

/**
 * Anima a reordenação das linhas dentro de `ref`.
 *
 * `assinatura` é a ordem atual em texto: mudou a string, mudou a ordem. Passar
 * a lista de ids evita reagir a re-render que não moveu nada.
 */
export function useReordenacaoFluida(
  ref: RefObject<HTMLElement | null>,
  assinatura: string,
): void {
  const posicoes = useRef<Map<string, number> | null>(null)

  // A primeira medição acontece no EFEITO (depois da pintura), não no layout
  // effect: assim a montagem inicial só registra posições e nunca anima.
  useEffect(() => {
    if (ref.current && posicoes.current === null) posicoes.current = medir(ref.current)
  }, [ref])

  useLayoutEffect(() => {
    const container = ref.current
    if (!container) return
    const antes = posicoes.current
    const depois = medir(container)
    posicoes.current = depois
    if (!antes) return

    // Movimento reduzido: a lista troca de ordem na hora. O sinal não some (a
    // ordem nova está lá, visível) — some só o trajeto, que é o que o §6 pede.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return

    const mover = deslocamentos(antes, depois)
    if (mover.size === 0) return
    const duracao = duracaoDoToken(
      getComputedStyle(document.documentElement).getPropertyValue("--dur"),
    )
    for (const el of container.querySelectorAll<HTMLElement>(`[${ATRIBUTO_FLUIDO}]`)) {
      const id = el.getAttribute(ATRIBUTO_FLUIDO)
      const delta = id ? mover.get(id) : undefined
      if (delta === undefined) continue
      // WAAPI e não classe: o trajeto é um número diferente a cada gesto, e a
      // animação se limpa sozinha ao terminar, sem deixar transform preso.
      el.animate?.(
        [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }],
        { duration: duracao, easing: "ease-out" },
      )
    }
  }, [ref, assinatura])
}
