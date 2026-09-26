import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  _relogioAtivo,
  anguloEm,
  assinarRelogio,
  CICLO_DO_BRILHO_MS,
  faixaDoBrilhoEm,
  TRAVESSIA_MS,
  VOLTA_MS,
} from "./relogioDoVivo"

// O relógio do vivo (ADR-256, ADR-259): a pose sai da HORA, então a janela que
// volta de uma oclusão não tem animação suspensa para retomar.

describe("relógio do vivo: a pose", () => {
  it("o cometa dá uma volta por VOLTA_MS, calculada pela hora", () => {
    expect(anguloEm(0)).toBe(0)
    expect(anguloEm(VOLTA_MS / 4)).toBeCloseTo(90)
    // Depois de uma pausa longa (janela coberta), o ângulo é o da hora, não o
    // de onde parou: é isto que o "trava e só volta ao clicar" não tinha.
    expect(anguloEm(VOLTA_MS * 3271 + 275)).toBeCloseTo(anguloEm(275))
  })

  it("o brilho atravessa a frase da esquerda para a direita e descansa fora dela", () => {
    expect(faixaDoBrilhoEm(0)).toBe(100)
    expect(faixaDoBrilhoEm(TRAVESSIA_MS / 2)).toBeCloseTo(0)
    expect(faixaDoBrilhoEm(TRAVESSIA_MS + 1)).toBe(-100)
    expect(faixaDoBrilhoEm(CICLO_DO_BRILHO_MS * 50 + TRAVESSIA_MS / 2)).toBeCloseTo(0)
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
    const horas: number[] = []
    const sair1 = assinarRelogio((ms) => horas.push(ms))
    const sair2 = assinarRelogio(() => {})
    expect(_relogioAtivo()).toBe(true)
    expect(horas).toHaveLength(1) // a pose de agora, já na assinatura
    sair1()
    expect(_relogioAtivo()).toBe(true)
    sair2()
    expect(_relogioAtivo()).toBe(false)
  })

  it("pinta a cada quadro com a hora do quadro", () => {
    const horas: number[] = []
    const sair = assinarRelogio((ms) => horas.push(ms))
    fila.shift()!(1000)
    fila.shift()!(1016)
    expect(horas.slice(1)).toEqual([1000, 1016])
    sair()
  })

  it("com reduced-motion não há laço: uma pose parada e só", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) })
    const chamadas: [number, boolean][] = []
    const sair = assinarRelogio((ms, parado) => chamadas.push([ms, parado]))
    expect(chamadas).toEqual([[0, true]])
    expect(_relogioAtivo()).toBe(false)
    sair()
  })
})
