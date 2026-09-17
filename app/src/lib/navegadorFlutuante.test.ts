import { describe, expect, it } from "vitest"
import {
  encaixarNoCartao,
  geometriaInicial,
  MARGEM,
  MINIMO,
  RESERVA_DO_COMPOSER,
  TOPO,
} from "./navegadorFlutuante"

describe("janela flutuante do navegador dentro do cartão", () => {
  it("nasce no canto de cima, à direita, sem cobrir o composer", () => {
    const g = geometriaInicial(1000, 800)
    expect(g).toEqual({ x: 1000 - 520 - MARGEM, y: TOPO, w: 520, h: 340 })
    expect(g.y + g.h).toBeLessThanOrEqual(800 - RESERVA_DO_COMPOSER)
  })

  it("arrastar para fora do cartão fica preso na borda", () => {
    expect(encaixarNoCartao({ x: -200, y: -50, w: 400, h: 300 }, 1000, 800)).toEqual({
      x: MARGEM, y: MARGEM, w: 400, h: 300,
    })
    expect(encaixarNoCartao({ x: 900, y: 700, w: 400, h: 300 }, 1000, 800)).toEqual({
      x: 1000 - MARGEM - 400, y: 800 - MARGEM - 300, w: 400, h: 300,
    })
  })

  it("redimensionar respeita o mínimo e o tamanho do cartão", () => {
    expect(encaixarNoCartao({ x: 20, y: 20, w: 50, h: 40 }, 1000, 800)).toMatchObject(MINIMO)
    const grande = encaixarNoCartao({ x: 20, y: 20, w: 5000, h: 5000 }, 1000, 800)
    expect(grande).toEqual({ x: MARGEM, y: MARGEM, w: 1000 - 2 * MARGEM, h: 800 - 2 * MARGEM })
  })

  it("cartão que encolheu puxa a janela lembrada para dentro", () => {
    const lembrada = { x: 700, y: 400, w: 520, h: 340 }
    const g = encaixarNoCartao(lembrada, 600, 500)
    expect(g.x).toBeGreaterThanOrEqual(MARGEM)
    expect(g.x + g.w).toBeLessThanOrEqual(600 - MARGEM)
    expect(g.y + g.h).toBeLessThanOrEqual(500 - MARGEM)
  })

  it("cartão menor que o mínimo: a janela cabe nele em vez de vazar", () => {
    const g = encaixarNoCartao({ x: 0, y: 0, w: 320, h: 220 }, 300, 200)
    expect(g).toEqual({ x: MARGEM, y: MARGEM, w: 300 - 2 * MARGEM, h: 200 - 2 * MARGEM })
  })
})
