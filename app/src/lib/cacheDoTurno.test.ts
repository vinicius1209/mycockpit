import { describe, expect, it } from "vitest"
import { divisaoDoCacheDoTurno } from "@/lib/cacheDoTurno"

describe("divisaoDoCacheDoTurno — o recibo só mostra o que sabe", () => {
  it("separa o lido do reconstruído (amostra real desta máquina)", () => {
    // Medido no transcript: read 20471, creation 22089 no mesmo turno.
    expect(divisaoDoCacheDoTurno({ cacheRead: 20471, cacheCreation: 22089 })).toEqual({
      lido: 20471,
      reconstruido: 22089,
    })
  })

  it("turno só de leitura: reconstruído zero, e o recibo não mostra a linha", () => {
    expect(divisaoDoCacheDoTurno({ cacheRead: 42560, cacheCreation: 0 })).toEqual({
      lido: 42560,
      reconstruido: 0,
    })
  })

  it("item de transcript ANTIGO (sem o campo) não vira acusação de reconstrução", () => {
    // Ausente = não sabemos. Vira 0, e 0 aqui significa "não mostro nada" —
    // nunca "afirmo que foi zero".
    expect(divisaoDoCacheDoTurno({ cacheRead: 900 })).toEqual({
      lido: 900,
      reconstruido: 0,
    })
    expect(divisaoDoCacheDoTurno(undefined)).toEqual({ lido: 0, reconstruido: 0 })
    expect(divisaoDoCacheDoTurno({ cacheRead: null, cacheCreation: null })).toEqual({
      lido: 0,
      reconstruido: 0,
    })
  })

  it("valor negativo (motor confuso) não vira número torto na tela", () => {
    expect(divisaoDoCacheDoTurno({ cacheRead: -5, cacheCreation: -1 })).toEqual({
      lido: 0,
      reconstruido: 0,
    })
  })
})
