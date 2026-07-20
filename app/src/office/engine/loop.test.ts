import { afterEach, describe, expect, it, vi } from "vitest"
import { createLoop } from "./loop"

/** rAF falso com bomba manual de frames (vitest roda em node). */
function stubRaf() {
  const pending = new Map<number, FrameRequestCallback>()
  let nextId = 1
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    pending.set(nextId, cb)
    return nextId++
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    pending.delete(id)
  })
  return {
    pump(t: number) {
      const cbs = [...pending.values()]
      pending.clear()
      for (const cb of cbs) cb(t)
    },
    get pendingCount() {
      return pending.size
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createLoop — Fix Your Timestep", () => {
  it("acumula tempo real e roda a sim em passos fixos", () => {
    const raf = stubRaf()
    const simulate = vi.fn()
    const render = vi.fn()
    const loop = createLoop({ simulate, render })
    loop.start()
    raf.pump(0) // primeiro frame: zera o relógio, nada de sim
    expect(simulate).not.toHaveBeenCalled()
    raf.pump(33) // 33ms ⇒ 1 passo de 16.67ms (resto fica no acumulador)
    expect(simulate).toHaveBeenCalledTimes(1)
    raf.pump(66) // +33ms ⇒ acumulador rende mais 2 passos
    expect(simulate).toHaveBeenCalledTimes(3)
    // Render roda a cada frame com alpha ∈ [0, 1).
    for (const [alpha] of render.mock.calls) {
      expect(alpha).toBeGreaterThanOrEqual(0)
      expect(alpha).toBeLessThan(1)
    }
    loop.stop()
  })

  it("clampa frames longos em MAX_FRAME_MS (anti espiral da morte)", () => {
    const raf = stubRaf()
    const simulate = vi.fn()
    const loop = createLoop({ simulate, render: () => {} })
    loop.start()
    raf.pump(0)
    raf.pump(10_000) // oclusão longa: no máx. 250ms de sim (≤ 15 passos)
    expect(simulate.mock.calls.length).toBeLessThanOrEqual(15)
    expect(simulate.mock.calls.length).toBeGreaterThanOrEqual(14)
    loop.stop()
  })

  it("start é idempotente (StrictMode monta 2×) e running reflete o estado", () => {
    const raf = stubRaf()
    const render = vi.fn()
    const loop = createLoop({ simulate: () => {}, render })
    expect(loop.running).toBe(false)
    loop.start()
    loop.start()
    expect(loop.running).toBe(true)
    raf.pump(0)
    expect(render).toHaveBeenCalledTimes(1) // um único frame agendado
    loop.stop()
    expect(loop.running).toBe(false)
  })

  it("stop cancela o rAF pendente; nada roda depois", () => {
    const raf = stubRaf()
    const render = vi.fn()
    const loop = createLoop({ simulate: () => {}, render })
    loop.start()
    loop.stop()
    expect(raf.pendingCount).toBe(0)
    raf.pump(100)
    expect(render).not.toHaveBeenCalled()
  })

  it("retomada re-zera o relógio (sem delta gigante da pausa)", () => {
    const raf = stubRaf()
    const simulate = vi.fn()
    const loop = createLoop({ simulate, render: () => {} })
    loop.start()
    raf.pump(0)
    loop.stop()
    loop.start()
    raf.pump(5000) // 5s depois: primeiro frame pós-retomada não deve simular nada
    expect(simulate).not.toHaveBeenCalled()
    loop.stop()
  })
})
