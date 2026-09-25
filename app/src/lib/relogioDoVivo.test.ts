import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { _relogioAtivo, assinarRelogio, brilho, CICLO, quadroEm } from "./relogioDoVivo"

// O relógio do vivo (ADR-256): o quadro sai da HORA, então a janela que volta
// de uma oclusão não tem animação suspensa para retomar.

describe("relógio do vivo: o quadro", () => {
  it("é calculado pela hora, 12 por segundo, e dá a volta no ciclo", () => {
    expect(quadroEm(0)).toBe(0)
    expect(quadroEm(1000 / 12)).toBe(1)
    expect(quadroEm(1000)).toBe(12 % CICLO)
    // Depois de uma pausa longa (janela coberta), o quadro é o da hora, não o
    // de onde parou: é isto que o "trava e só volta ao clicar" não tinha.
    expect(quadroEm(3_600_000 + 250)).toBe(quadroEm(250))
  })

  it("cada ponto acende uma vez por ciclo, com esteira de dois quadros", () => {
    for (const onda of ["diagonal", "coluna"] as const) {
      for (let ponto = 0; ponto < 9; ponto++) {
        const brilhos = Array.from({ length: CICLO }, (_, q) => brilho(q, onda, ponto))
        expect(brilhos.filter((b) => b === 2)).toHaveLength(1)
        expect(brilhos.filter((b) => b === 1)).toHaveLength(2)
      }
    }
  })

  it("parado (reduced-motion) é visível: meia luz e o centro aceso, sem piscar", () => {
    const pontos = Array.from({ length: 9 }, (_, i) => brilho(5, "diagonal", i, true))
    expect(pontos).toEqual([1, 1, 1, 1, 2, 1, 1, 1, 1])
  })
})

describe("relógio do vivo: o laço", () => {
  let fila: FrameRequestCallback[] = []
  beforeEach(() => {
    fila = []
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => fila.push(cb))
    vi.stubGlobal("cancelAnimationFrame", () => {
      fila = []
    })
    vi.stubGlobal("matchMedia", () => ({ matches: false }))
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) })
  })
  afterEach(() => vi.unstubAllGlobals())

  it("só gira enquanto existe alguém para pintar, e para com o último", () => {
    const quadros: number[] = []
    const sair1 = assinarRelogio((q) => quadros.push(q))
    const sair2 = assinarRelogio(() => {})
    expect(_relogioAtivo()).toBe(true)
    expect(quadros).toHaveLength(1) // o quadro de agora, já na assinatura
    sair1()
    expect(_relogioAtivo()).toBe(true)
    sair2()
    expect(_relogioAtivo()).toBe(false)
  })

  it("pinta só quando o quadro muda", () => {
    const quadros: number[] = []
    const sair = assinarRelogio((q) => quadros.push(q))
    fila.shift()!(1000) // quadro 0 (12 % 12)
    fila.shift()!(1010) // mesmo quadro: nada
    fila.shift()!(1000 + 1000 / 12) // quadro 1
    expect(quadros.slice(1)).toEqual([0, 1])
    sair()
  })

  it("com reduced-motion não há laço: um quadro parado e só", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) })
    const chamadas: [number, boolean][] = []
    const sair = assinarRelogio((q, parado) => chamadas.push([q, parado]))
    expect(chamadas).toEqual([[0, true]])
    expect(_relogioAtivo()).toBe(false)
    sair()
  })
})
