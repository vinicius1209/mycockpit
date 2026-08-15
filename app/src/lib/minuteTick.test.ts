// Ticker único de minuto (STYLEGUIDE §6): 40 conversas não podem virar 40
// assinaturas de relógio, e um ticker que sobrevive à tela é vazamento.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  _ouvintesDoMinuto,
  _resetMinuteTick,
  _setRelogio,
  minuteNow,
  subscribeMinute,
} from "@/lib/minuteTick"

const T0 = 1_785_512_000_000
let agora = T0
let restaurarRelogio: (() => void) | null = null

beforeEach(() => {
  vi.useFakeTimers()
  agora = T0
  restaurarRelogio = _setRelogio(() => agora)
})

afterEach(() => {
  _resetMinuteTick()
  restaurarRelogio?.()
  vi.useRealTimers()
})

describe("ticker único de 60s", () => {
  it("três assinantes compartilham UM interval", () => {
    const spy = vi.spyOn(globalThis, "setInterval")
    const a = subscribeMinute(() => {})
    const b = subscribeMinute(() => {})
    const c = subscribeMinute(() => {})
    expect(spy).toHaveBeenCalledTimes(1)
    expect(_ouvintesDoMinuto()).toBe(3)
    a()
    b()
    c()
  })

  it("o último a sair desliga o interval (nada tica com a lista desmontada)", () => {
    const clear = vi.spyOn(globalThis, "clearInterval")
    const a = subscribeMinute(() => {})
    const b = subscribeMinute(() => {})
    a()
    expect(clear).not.toHaveBeenCalled()
    b()
    expect(clear).toHaveBeenCalledTimes(1)
    expect(_ouvintesDoMinuto()).toBe(0)
  })

  it("desmontar e remontar liga um interval novo, não dois", () => {
    const spy = vi.spyOn(globalThis, "setInterval")
    subscribeMinute(() => {})()
    const b = subscribeMinute(() => {})
    expect(spy).toHaveBeenCalledTimes(2)
    expect(_ouvintesDoMinuto()).toBe(1)
    b()
  })

  it("o instante é o MESMO para todo mundo e só anda de minuto em minuto", () => {
    const solto = subscribeMinute(() => {})
    const inicial = minuteNow()
    agora = T0 + 30_000
    vi.advanceTimersByTime(30_000)
    expect(minuteNow()).toBe(inicial) // ainda não virou o minuto

    agora = T0 + 60_000
    vi.advanceTimersByTime(30_000)
    expect(minuteNow()).toBe(T0 + 60_000)
    solto()
  })

  it("avisa TODOS os assinantes no mesmo tique", () => {
    const vistos: string[] = []
    const a = subscribeMinute(() => vistos.push("a"))
    const b = subscribeMinute(() => vistos.push("b"))
    agora = T0 + 60_000
    vi.advanceTimersByTime(60_000)
    expect(vistos).toEqual(["a", "b"])
    a()
    b()
  })

  it("o primeiro assinante re-lê o relógio: ninguém herda um instante velho", () => {
    agora = T0 + 5 * 60_000
    const solto = subscribeMinute(() => {})
    expect(minuteNow()).toBe(T0 + 5 * 60_000)
    solto()
  })
})
