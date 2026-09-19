// O GESTO NÃO PODE COMER O CLIQUE.
//
// Bug de 19/09/2026, relatado no app instalado: "não consigo alternar entre
// conversas". A linha da conversa é `<div onPointerDown>` com um `<button
// onClick>` dentro. O `iniciarArrasto` capturava o ponteiro já no `pointerdown`,
// e captura ativa num ANCESTRAL redireciona os eventos de mouse derivados para
// quem capturou: o `click` ia parar na div e o `onClick` do botão nunca rodava.
// Reordenar seguia funcionando (é na div), e por isso o sintoma foi "arrastar
// funciona, clicar não".
//
// A captura só existe para o gesto sobreviver ao ponteiro saindo da linha. Isso
// só importa DEPOIS que virou arrasto, então é lá que ela nasce.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { cancelarArrasto, cargaArrastada } from "@/lib/arrastoInterno"
import { reorderByIds } from "@/lib/reorder"
import { iniciarArrasto, ladoDoDestino, LIMIAR_DE_ARRASTO } from "./CamadaDeArrasto"

function fonteFalsa() {
  const setPointerCapture = vi.fn()
  const releasePointerCapture = vi.fn()
  const el = { setPointerCapture, releasePointerCapture } as unknown as Element
  return { el, setPointerCapture, releasePointerCapture }
}

function apertar(el: Element, x = 100, y = 100) {
  return {
    button: 0,
    pointerId: 7,
    clientX: x,
    clientY: y,
    currentTarget: el,
  } as unknown as React.PointerEvent
}

beforeEach(() => cancelarArrasto())

describe("captura do ponteiro no arrasto interno", () => {
  it("apertar não captura o ponteiro: clique tem que continuar sendo clique", () => {
    const { el, setPointerCapture } = fonteFalsa()
    iniciarArrasto(apertar(el), { tipo: "projeto", id: "p1" }, "Projeto")
    expect(setPointerCapture).not.toHaveBeenCalled()
    expect(cargaArrastada()).toBeNull()
  })

  it("botão que não é o principal nem arma o gesto", () => {
    const { el, setPointerCapture } = fonteFalsa()
    const direito = { ...apertar(el), button: 2 } as unknown as React.PointerEvent
    iniciarArrasto(direito, { tipo: "projeto", id: "p1" }, "Projeto")
    expect(setPointerCapture).not.toHaveBeenCalled()
  })

  it("o limiar é o que separa mão trêmula de arrasto", () => {
    expect(LIMIAR_DE_ARRASTO).toBeGreaterThan(0)
  })
})

describe("de que lado o item vai cair", () => {
  // A regra não é o cursor, é `reorderByIds`: ele acha o índice do alvo na
  // lista ORIGINAL e insere DEPOIS de remover a origem. Estes casos são a
  // prova, rodando o helper puro de verdade.
  const lista = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]

  it("arrastar para BAIXO deposita depois do alvo", () => {
    expect(reorderByIds(lista, "a", "c").map((x) => x.id)).toEqual(["b", "c", "a", "d"])
  })

  it("arrastar para CIMA deposita antes do alvo", () => {
    expect(reorderByIds(lista, "d", "b").map((x) => x.id)).toEqual(["a", "d", "b", "c"])
  })

  it("o lado sai da ordem no DOM, que espelha a ordem da lista", () => {
    // Sem jsdom nesta suíte: as linhas são dublês que respondem
    // `compareDocumentPosition` pela posição declarada, que é o único fato que
    // a função consulta.
    const linhas = ["a", "b", "c"]
    const linha = (id: string) =>
      ({
        compareDocumentPosition(outro: { id: string }) {
          const eu = linhas.indexOf(id)
          const ele = linhas.indexOf(outro.id)
          return ele > eu ? 4 : ele < eu ? 2 : 0
        },
        id,
      }) as unknown as Element

    const [a, b, c] = linhas.map(linha)
    // alvo DEPOIS da origem no DOM = arrastando pra baixo = cai depois
    expect(ladoDoDestino(a, c)).toBe("depois")
    // alvo ANTES da origem = arrastando pra cima = cai antes
    expect(ladoDoDestino(c, b)).toBe("antes")
    // sem origem conhecida (arrasto de texto, de arquivo) não há lado
    expect(ladoDoDestino(null, b)).toBeNull()
  })

  it("soltar em cima de si mesmo não tem lado nem efeito", () => {
    const mesmo = {} as Element
    expect(ladoDoDestino(mesmo, mesmo)).toBeNull()
    // e o helper puro concorda: mesma referência, sem re-render
    expect(reorderByIds(lista, "b", "b")).toBe(lista)
  })
})
