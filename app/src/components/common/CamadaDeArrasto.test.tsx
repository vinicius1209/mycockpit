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
import { iniciarArrasto, LIMIAR_DE_ARRASTO } from "./CamadaDeArrasto"

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
