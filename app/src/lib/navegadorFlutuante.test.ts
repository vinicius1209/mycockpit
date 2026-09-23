import { describe, expect, it } from "vitest"
import {
  encaixarNoCartao,
  geometriaInicial,
  MARGEM,
  MINIMO,
  redimensionar,
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

describe("redimensionar pela borda ou pelo canto", () => {
  const g0 = { x: 400, y: 100, w: 520, h: 340 }

  it("puxar a borda esquerda cresce para a esquerda e a direita fica parada", () => {
    const g = redimensionar(g0, "w", -100, 0, 1000, 800)
    expect(g).toEqual({ x: 300, y: 100, w: 620, h: 340 })
  })

  it("puxar a borda de cima cresce para cima e a de baixo fica parada", () => {
    const g = redimensionar(g0, "n", 0, -60, 1000, 800)
    expect(g).toEqual({ x: 400, y: 40, w: 520, h: 400 })
  })

  it("o canto de baixo à direita mexe nas duas medidas", () => {
    expect(redimensionar(g0, "se", 30, 40, 1000, 800)).toEqual({ x: 400, y: 100, w: 550, h: 380 })
  })

  it("borda de lado não mexe na altura, e vice-versa", () => {
    expect(redimensionar(g0, "e", 50, 999, 1000, 800).h).toBe(340)
    expect(redimensionar(g0, "s", 999, 50, 1000, 800).w).toBe(520)
  })

  it("encolher além do mínimo trava a borda puxada, sem deslizar a janela", () => {
    const g = redimensionar(g0, "w", 900, 0, 1000, 800)
    expect(g).toEqual({ x: 400 + 520 - MINIMO.w, y: 100, w: MINIMO.w, h: 340 })
  })

  it("crescer além do cartão para na margem", () => {
    expect(redimensionar(g0, "nw", -2000, -2000, 1000, 800)).toEqual({
      x: MARGEM, y: MARGEM, w: 400 + 520 - MARGEM, h: 100 + 340 - MARGEM,
    })
    const g = redimensionar(g0, "se", 2000, 2000, 1000, 800)
    expect(g.x + g.w).toBe(1000 - MARGEM)
    expect(g.y + g.h).toBe(800 - MARGEM)
  })
})
