import { describe, expect, it, vi } from "vitest"
import { attachInput } from "./input"
import type { InputHandlers } from "./input"
import { createWorld, simTick } from "./sim"
import { SIM_DT, T_WALK } from "./types"
import type { FloorPlan, World } from "./types"

/** Janela falsa: só o event target que o attachInput precisa (vitest roda em node). */
function makeTarget() {
  const listeners = new Map<string, Set<(e: unknown) => void>>()
  return {
    addEventListener(type: string, fn: (e: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      listeners.get(type)?.delete(fn)
    },
    dispatch(type: string, e?: unknown) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(e)
    },
  }
}

type FakeTarget = ReturnType<typeof makeTarget>

function fakeKey(key: string, over: Record<string, unknown> = {}): KeyboardEvent {
  return {
    key,
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...over,
  } as unknown as KeyboardEvent
}

function makeHandlers(over: Partial<InputHandlers> = {}): InputHandlers {
  return {
    isDockOpen: () => false,
    isTextTarget: () => false,
    onEscape: vi.fn(),
    onInteract: vi.fn(),
    onTabRoom: vi.fn(),
    ...over,
  }
}

function makeWorld(): World {
  const plan: FloorPlan = {
    w: 20,
    h: 20,
    grid: new Uint8Array(400).fill(T_WALK),
    rooms: [],
    spawn: { x: 10.5, y: 10.5 },
  }
  return createWorld(plan)
}

function attach(world: World, handlers: InputHandlers): { target: FakeTarget; detach: () => void } {
  const target = makeTarget()
  const detach = attachInput(target as unknown as Window, world, handlers)
  return { target, detach }
}

describe("attachInput — roteamento de teclado (§5)", () => {
  it("WASD/setas entram em keys no keydown e saem no keyup", () => {
    const world = makeWorld()
    const { target } = attach(world, makeHandlers())
    target.dispatch("keydown", fakeKey("w"))
    target.dispatch("keydown", fakeKey("ArrowLeft"))
    expect(world.input.keys).toEqual(new Set(["w", "arrowleft"]))
    target.dispatch("keyup", fakeKey("w"))
    expect(world.input.keys).toEqual(new Set(["arrowleft"]))
  })

  it("tecla vinda de campo de texto NUNCA vira movimento", () => {
    const world = makeWorld()
    const { target } = attach(world, makeHandlers({ isTextTarget: () => true }))
    target.dispatch("keydown", fakeKey("w"))
    target.dispatch("keydown", fakeKey("ArrowUp"))
    expect(world.input.keys.size).toBe(0)
    // E de fato o boss não se move num tick da sim.
    const antes = { ...world.boss.pos }
    simTick(world, SIM_DT, () => {})
    expect(world.boss.pos).toEqual(antes)
  })

  it("atalho com modificador (⌘/Ctrl/Alt) não vira movimento", () => {
    const world = makeWorld()
    const { target } = attach(world, makeHandlers())
    target.dispatch("keydown", fakeKey("d", { metaKey: true }))
    expect(world.input.keys.size).toBe(0)
  })

  it("com dock aberto, Tab segue a navegação de foco (sem preventDefault)", () => {
    const world = makeWorld()
    const handlers = makeHandlers({ isDockOpen: () => true })
    const { target } = attach(world, handlers)
    const e = fakeKey("Tab")
    target.dispatch("keydown", e)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(handlers.onTabRoom).not.toHaveBeenCalled()
  })

  it("com dock fechado, Tab cicla salas com preventDefault", () => {
    const world = makeWorld()
    const handlers = makeHandlers()
    const { target } = attach(world, handlers)
    const e = fakeKey("Tab")
    target.dispatch("keydown", e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(handlers.onTabRoom).toHaveBeenCalledTimes(1)
  })

  it("Esc delega ao coordenador da ui; E interage (ignorando auto-repeat)", () => {
    const world = makeWorld()
    const handlers = makeHandlers()
    const { target } = attach(world, handlers)
    target.dispatch("keydown", fakeKey("Escape"))
    expect(handlers.onEscape).toHaveBeenCalledTimes(1)
    target.dispatch("keydown", fakeKey("e"))
    target.dispatch("keydown", fakeKey("e", { repeat: true }))
    expect(handlers.onInteract).toHaveBeenCalledTimes(1)
    expect(world.input.keys.size).toBe(0) // nem Esc nem E são movimento
  })

  it("office oculto (isActive=false): nenhuma tecla é consumida nem preventDefault", () => {
    const world = makeWorld()
    const handlers = makeHandlers({ isActive: () => false })
    const { target } = attach(world, handlers)
    const tab = fakeKey("Tab")
    const seta = fakeKey("ArrowUp")
    target.dispatch("keydown", tab)
    target.dispatch("keydown", seta)
    target.dispatch("keydown", fakeKey("e"))
    target.dispatch("keydown", fakeKey("Escape"))
    // Tab/setas seguem o modo visível (foco/scroll) — sem preventDefault.
    expect(tab.preventDefault).not.toHaveBeenCalled()
    expect(seta.preventDefault).not.toHaveBeenCalled()
    expect(world.input.keys.size).toBe(0)
    expect(handlers.onTabRoom).not.toHaveBeenCalled()
    expect(handlers.onInteract).not.toHaveBeenCalled()
    expect(handlers.onEscape).not.toHaveBeenCalled()
  })

  it("blur limpa as teclas pressionadas", () => {
    const world = makeWorld()
    const { target } = attach(world, makeHandlers())
    target.dispatch("keydown", fakeKey("w"))
    expect(world.input.keys.size).toBe(1)
    target.dispatch("blur")
    expect(world.input.keys.size).toBe(0)
  })

  it("o cleanup remove os listeners e limpa keys", () => {
    const world = makeWorld()
    const { target, detach } = attach(world, makeHandlers())
    target.dispatch("keydown", fakeKey("w"))
    detach()
    expect(world.input.keys.size).toBe(0)
    target.dispatch("keydown", fakeKey("d"))
    expect(world.input.keys.size).toBe(0)
  })
})
