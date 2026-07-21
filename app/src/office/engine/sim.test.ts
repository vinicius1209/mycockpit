import { describe, expect, it } from "vitest"
import { setInspect } from "./camera"
import { createWorld, simTick } from "./sim"
import { BOSS_SPEED, SIM_DT, T_INTERACT, T_WALK } from "./types"
import type { DeskPlacement, FloorPlan, RoomPlacement, SimEvent, Vec2, World } from "./types"

function makeDesk(id: string, interact: Vec2): DeskPlacement {
  return {
    id,
    projectId: "p1",
    agent: "claude-code",
    tile: { x: interact.x, y: interact.y - 1 },
    interactTile: interact,
    flip: false,
  }
}

function makeRoom(desks: DeskPlacement[]): RoomPlacement {
  return { projectId: "p1", row: 0, origin: { x: 0, y: 0 }, w: 10, h: 8, doorTiles: [], desks }
}

function makePlan(opts: { w: number; h: number; spawn: Vec2; blocked?: Vec2[]; rooms?: RoomPlacement[] }): FloorPlan {
  const grid = new Uint8Array(opts.w * opts.h).fill(T_WALK)
  for (const b of opts.blocked ?? []) grid[b.y * opts.w + b.x] = 0
  for (const room of opts.rooms ?? []) {
    for (const d of room.desks) grid[d.interactTile.y * opts.w + d.interactTile.x] |= T_INTERACT
  }
  return { w: opts.w, h: opts.h, grid, rooms: opts.rooms ?? [], spawn: opts.spawn }
}

function collect(world: World): { events: SimEvent[]; tick: (n?: number) => void } {
  const events: SimEvent[] = []
  const emit = (e: SimEvent) => events.push(e)
  return { events, tick: (n = 1) => { for (let i = 0; i < n; i++) simTick(world, SIM_DT, emit) } }
}

describe("movimento por teclado (espaço de tela → mundo)", () => {
  const COMBOS: string[][] = [["w"], ["a"], ["s"], ["d"], ["w", "d"], ["w", "a"], ["s", "d"], ["s", "a"]]

  it("|velocidade| é igual nas 8 direções", () => {
    const N = 30
    const dists = COMBOS.map((keys) => {
      const world = createWorld(makePlan({ w: 40, h: 40, spawn: { x: 20, y: 20 } }))
      for (const k of keys) world.input.keys.add(k)
      const { tick } = collect(world)
      tick(N)
      return Math.hypot(world.boss.pos.x - 20, world.boss.pos.y - 20)
    })
    const expected = BOSS_SPEED * N * SIM_DT
    for (const d of dists) expect(d).toBeCloseTo(expected, 9)
  })

  it("setas funcionam como WASD", () => {
    const world = createWorld(makePlan({ w: 40, h: 40, spawn: { x: 20, y: 20 } }))
    world.input.keys.add("arrowright")
    const { tick } = collect(world)
    tick(10)
    const disp = Math.hypot(world.boss.pos.x - 20, world.boss.pos.y - 20)
    expect(disp).toBeCloseTo(BOSS_SPEED * 10 * SIM_DT, 9)
  })

  it("facing segue as quatro direções da tela e persiste ao parar", () => {
    const world = createWorld(makePlan({ w: 40, h: 40, spawn: { x: 20, y: 20 } }))
    const { tick } = collect(world)
    world.input.keys.add("d")
    tick()
    expect(world.boss.facing).toBe("right")
    world.input.keys.clear()
    world.input.keys.add("a")
    tick()
    expect(world.boss.facing).toBe("left")
    world.input.keys.clear()
    world.input.keys.add("w")
    tick()
    expect(world.boss.facing).toBe("back")
    world.input.keys.clear()
    world.input.keys.add("s")
    tick()
    expect(world.boss.facing).toBe("front")
    world.input.keys.clear()
    tick()
    expect(world.boss.facing).toBe("front")
  })

  it("prev é gravado no início do tick (render interpola por fora)", () => {
    const world = createWorld(makePlan({ w: 40, h: 40, spawn: { x: 20, y: 20 } }))
    world.input.keys.add("d")
    const { tick } = collect(world)
    tick()
    const p1 = { ...world.boss.pos }
    tick()
    expect(world.boss.prev).toEqual(p1)
    expect(world.boss.moving).toBe(true)
  })

  it("parede bloqueia o eixo mas desliza no outro (move-and-slide)", () => {
    // Parede na linha y=19 inteira: subir de tela (w+d ⇒ mundo -y) barra em y,
    // mas o eixo x continua livre.
    const blocked: Vec2[] = []
    for (let x = 0; x < 40; x++) blocked.push({ x, y: 19 })
    const world = createWorld(makePlan({ w: 40, h: 40, spawn: { x: 20.5, y: 20.5 }, blocked }))
    world.input.keys.add("w") // wdir = (-1,-1)/√2: anda em -x e -y
    const { tick } = collect(world)
    tick(30)
    expect(world.boss.pos.y).toBeGreaterThan(20.2) // y barrado pela folga dos pés
    expect(world.boss.pos.x).toBeLessThan(20.5 - 1) // x deslizou
  })
})

describe("click-to-move e WASD", () => {
  it("clique no chão vira caminho A*; WASD cancela caminho e mesa pendente", () => {
    const world = createWorld(makePlan({ w: 20, h: 20, spawn: { x: 10.5, y: 10.5 } }))
    const { tick } = collect(world)
    world.input.clickWorld = { x: 3.5, y: 10.5 }
    tick()
    expect(world.boss.path).not.toBeNull()
    expect(world.input.clickWorld).toBeNull() // consumido
    world.input.keys.add("w")
    tick()
    expect(world.boss.path).toBeNull()
    expect(world.boss.pendingDeskId).toBeNull()
  })

  it("clique na mesa: caminho até o interactTile e arrived-at-desk na chegada", () => {
    const desk = makeDesk("p1::claude-code", { x: 5, y: 5 })
    const world = createWorld(
      makePlan({ w: 12, h: 12, spawn: { x: 8.5, y: 5.5 }, rooms: [makeRoom([desk])] }),
    )
    const { events, tick } = collect(world)
    world.input.clickDeskId = desk.id
    tick()
    expect(world.boss.pendingDeskId).toBe(desk.id)
    tick(90)
    const arrived = events.filter((e) => e.kind === "arrived-at-desk")
    expect(arrived).toEqual([{ kind: "arrived-at-desk", deskId: desk.id }])
    expect(world.boss.pendingDeskId).toBeNull()
    // Chegou de fato na frente da mesa.
    expect(world.boss.pos.x).toBeCloseTo(5.5, 0)
    expect(world.boss.pos.y).toBeCloseTo(5.5, 0)
    // E a proximidade também disparou no caminho.
    expect(events.some((e) => e.kind === "near-desk" && e.deskId === desk.id)).toBe(true)
  })

  it("clique em interactable usa o alvo explícito em vez de clamp de chão", () => {
    const plan = makePlan({ w: 12, h: 12, spawn: { x: 8.5, y: 5.5 } })
    plan.interactables = [
      {
        id: "commons::mission",
        tile: { x: 5, y: 3 },
        footprint: { w: 4, h: 2 },
        interactTile: { x: 5, y: 5 },
      },
    ]
    plan.grid[5 * plan.w + 5] |= T_INTERACT
    const world = createWorld(plan)
    const { events, tick } = collect(world)
    world.input.clickDeskId = "commons::mission"
    tick()
    expect(world.boss.pendingDeskId).toBe("commons::mission")
    tick(90)
    expect(events).toContainEqual({ kind: "arrived-at-desk", deskId: "commons::mission" })
    expect(world.boss.pos.x).toBeCloseTo(5.5, 0)
    expect(world.boss.pos.y).toBeCloseTo(5.5, 0)
  })

  it("clique em mesa desconhecida é consumido sem efeito (não trava a sim)", () => {
    const world = createWorld(makePlan({ w: 12, h: 12, spawn: { x: 6.5, y: 6.5 } }))
    const { events, tick } = collect(world)
    world.input.clickDeskId = "fantasma::codex"
    tick()
    expect(world.input.clickDeskId).toBeNull()
    expect(world.boss.path).toBeNull()
    expect(events).toEqual([])
  })
})

describe("proximidade com histerese (REACH_ENTER 1.0 / REACH_EXIT 1.5)", () => {
  function worldWithDesks(desks: DeskPlacement[], spawn: Vec2): World {
    return createWorld(makePlan({ w: 16, h: 16, spawn, rooms: [makeRoom(desks)] }))
  }

  it("entra a ≤1.0, segura entre 1.0 e 1.5, sai a >1.5", () => {
    const desk = makeDesk("p1::claude-code", { x: 5, y: 5 }) // centro (5.5, 5.5)
    const world = worldWithDesks([desk], { x: 7.5, y: 5.5 }) // dist 2.0
    const { events, tick } = collect(world)
    tick()
    expect(events).toEqual([]) // longe: nada

    world.boss.pos = { x: 6.4, y: 5.5 } // dist 0.9 ⇒ entra
    tick()
    expect(events).toEqual([{ kind: "near-desk", deskId: desk.id }])

    world.boss.pos = { x: 6.7, y: 5.5 } // dist 1.2 (zona morta) ⇒ segura
    tick()
    expect(events.length).toBe(1)
    expect(world.nearDeskId).toBe(desk.id)

    world.boss.pos = { x: 7.2, y: 5.5 } // dist 1.7 ⇒ sai
    tick()
    expect(events[1]).toEqual({ kind: "near-desk", deskId: null })
    expect(world.nearDeskId).toBeNull()
  })

  it("alvo único: a mesa mais próxima só rouba com folga de 0.15", () => {
    const a = makeDesk("p1::claude-code", { x: 5, y: 5 }) // centro (5.5, 5.5)
    const b = makeDesk("p1::codex", { x: 6, y: 5 }) //       centro (6.5, 5.5)
    const world = worldWithDesks([a, b], { x: 5.9, y: 5.5 }) // dA 0.4 < dB 0.6
    const { events, tick } = collect(world)
    tick()
    expect(world.nearDeskId).toBe(a.id)

    world.boss.pos = { x: 6.05, y: 5.5 } // dB 0.45 < dA 0.55, folga 0.1 < 0.15 ⇒ mantém A
    tick()
    expect(world.nearDeskId).toBe(a.id)
    expect(events.length).toBe(1)

    world.boss.pos = { x: 6.3, y: 5.5 } // dB 0.2 ≪ dA 0.8 ⇒ troca para B
    tick()
    expect(world.nearDeskId).toBe(b.id)
    expect(events[1]).toEqual({ kind: "near-desk", deskId: b.id })
  })
})

describe("integração com a câmera", () => {
  it("primeiro input de movimento sai do inspect e emite camera-mode follow", () => {
    const world = createWorld(makePlan({ w: 20, h: 20, spawn: { x: 10.5, y: 10.5 } }))
    setInspect(world, { x: 3, y: 3 })
    const { events, tick } = collect(world)
    world.input.keys.add("d")
    tick()
    expect(world.camera.mode).toBe("follow")
    expect(world.camera.inspectTarget).toBeNull()
    expect(events[0]).toEqual({ kind: "camera-mode", mode: "follow" })
  })

  it("sem input de movimento o inspect permanece", () => {
    const world = createWorld(makePlan({ w: 20, h: 20, spawn: { x: 10.5, y: 10.5 } }))
    setInspect(world, { x: 3, y: 3 })
    const { events, tick } = collect(world)
    tick(10)
    expect(world.camera.mode).toBe("inspect")
    expect(events.filter((e) => e.kind === "camera-mode")).toEqual([])
  })
})
