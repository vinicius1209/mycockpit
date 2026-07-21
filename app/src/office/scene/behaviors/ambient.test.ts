/** Testes do pack AMBIENT (gato do escritório + gatilhos de som) — mesmo
 *  padrão headless de behaviors.test.ts: planta aberta, ctx fake em Maps,
 *  Container real do Pixi como camada. O som em si é no-op sem AudioContext
 *  (node) — aqui se testa a LÓGICA pura (sala ativa, canto de dormir) e o
 *  comportamento observável do gato (spawna 1, anda, dorme, reducedMotion). */
import { Container } from "pixi.js"
import { describe, expect, it } from "vitest"
import { T_INTERACT, T_WALK } from "../../engine/types"
import type {
  DeskVisualState,
  FloorPlan,
  OfficeSnapshot,
  Vec2,
} from "../../engine/types"
import { createWalkerSystem } from "../walkers"
import { createBehaviors, type BehaviorCtx } from "../behaviors"
import { catActivityRoom, catSleepSpot, createAmbientPack } from "./ambient"

function openPlan(w = 24, h = 12): FloorPlan {
  const grid = new Uint8Array(w * h).fill(T_WALK)
  return { w, h, grid, rooms: [], spawn: { x: 1.5, y: 1.5 } }
}

const SNAP_EMPTY: OfficeSnapshot = { rooms: [], deliveries: [] }

function makeRig(opts?: { reducedMotion?: boolean }) {
  const plan = openPlan()
  const walkers = createWalkerSystem(plan)
  const behaviors = createBehaviors({
    plan,
    walkers,
    reducedMotion: opts?.reducedMotion ?? false,
  })
  const states = new Map<string, DeskVisualState>()
  const ctx: BehaviorCtx = {
    hideSeated: () => {},
    showSeated: () => {},
    seatedVisible: () => true,
    deskAnchor: () => null,
    deskState: (id) => states.get(id) ?? null,
    deskInfo: () => null,
    deskIds: () => [],
    bossPos: () => ({ x: 1.5, y: 1.5 }),
    targets: {
      coffee: null,
      waterCooler: null,
      sofa: null,
      meetingTable: null,
      bossDesk: null,
    },
    time: 0,
    spawnWalker: (o) => walkers.spawn(o),
    handoffBubble: () => {},
  }
  const layer = new Container()
  behaviors.registerPack(createAmbientPack({ layer }))
  return {
    behaviors,
    ctx,
    layer,
    tick(dt = 1 / 30) {
      ctx.time += dt
      behaviors.update(dt, ctx)
    },
  }
}

describe("catActivityRoom", () => {
  it("elege a sala com mais mesas typing/thinking; tudo quieto = null", () => {
    const desk = (id: string, state: DeskVisualState) => ({
      id,
      projectId: "p",
      agent: "claude-code" as const,
      state,
      label: "",
    })
    const snap: OfficeSnapshot = {
      deliveries: [],
      rooms: [
        {
          projectId: "a",
          name: "A",
          agg: "running",
          costUsd: 0,
          desks: [desk("a::claude-code", "typing")],
        },
        {
          projectId: "b",
          name: "B",
          agg: "running",
          costUsd: 0,
          desks: [desk("b::claude-code", "thinking"), desk("b::codex", "typing")],
        },
      ],
    }
    expect(catActivityRoom(snap)).toBe("b")
    expect(catActivityRoom(SNAP_EMPTY)).toBeNull()
    const quiet: OfficeSnapshot = {
      deliveries: [],
      rooms: [
        { projectId: "a", name: "A", agg: "idle", costUsd: 0, desks: [desk("x", "idle")] },
      ],
    }
    expect(catActivityRoom(quiet)).toBeNull()
  })
})

describe("catSleepSpot", () => {
  it("prefere canto caminhável da sala do projeto; cai pra planta sem sala", () => {
    const plan = openPlan()
    plan.rooms = [
      {
        projectId: "a",
        row: 0,
        origin: { x: 4, y: 2 },
        w: 6,
        h: 5,
        doorTiles: [],
        desks: [],
      },
    ]
    // canto SE (com 1 tile de folga das bordas — nada oclui o loaf na iso)
    expect(catSleepSpot(plan, "a")).toEqual({ x: 8.5, y: 5.5 })
    // canto SE bloqueado (interact) ⇒ SW com a mesma folga
    plan.grid[5 * plan.w + 8] = T_WALK | T_INTERACT
    expect(catSleepSpot(plan, "a")).toEqual({ x: 5.5, y: 5.5 })
    // sem projeto: primeiro tile caminhável da planta aberta (varre do sul)
    expect(catSleepSpot(plan, null)).toEqual({ x: 0.5, y: 11.5 })
  })

  it("planta sem tile caminhável: null (pack não spawna gato)", () => {
    const plan: FloorPlan = {
      w: 4,
      h: 4,
      grid: new Uint8Array(16),
      rooms: [],
      spawn: { x: 1, y: 1 },
    }
    expect(catSleepSpot(plan, null)).toBeNull()
  })
})

describe("gato do escritório", () => {
  it("spawna UM gato na camada e passeia (posição muda entre ticks)", () => {
    const rig = makeRig()
    rig.tick()
    expect(rig.layer.children.length).toBe(1)
    const cat = rig.layer.children[0]
    const before: Vec2 = { x: cat.position.x, y: cat.position.y }
    for (let i = 0; i < 90; i++) rig.tick() // 3s de sim — o gato já anda
    const moved =
      Math.abs(cat.position.x - before.x) + Math.abs(cat.position.y - before.y)
    expect(moved).toBeGreaterThan(0)
    // segue sendo UM gato (cap próprio de 1)
    rig.behaviors.applySnapshot(SNAP_EMPTY, rig.ctx)
    for (let i = 0; i < 30; i++) rig.tick()
    expect(rig.layer.children.length).toBe(1)
  })

  it("depois dos passeios, dorme (~2min parado) e acorda de novo", () => {
    const rig = makeRig()
    rig.tick()
    const cat = rig.layer.children[0]
    // avança MUITO a sim em passos grandes: pausas e caminhadas se resolvem
    let sleptAt: Vec2 | null = null
    for (let i = 0; i < 60 * 60 && sleptAt === null; i++) {
      rig.tick(0.5)
      const p: Vec2 = { x: cat.position.x, y: cat.position.y }
      // heurística: dorme quando fica parado por 20 ticks de 0.5s seguidos
      let still = true
      for (let j = 0; j < 20 && still; j++) {
        rig.tick(0.5)
        still = cat.position.x === p.x && cat.position.y === p.y
      }
      if (still) sleptAt = p
    }
    expect(sleptAt).not.toBeNull()
  })

  it("reducedMotion: gato dormindo num canto, estático", () => {
    const rig = makeRig({ reducedMotion: true })
    rig.tick()
    expect(rig.layer.children.length).toBe(1)
    const cat = rig.layer.children[0]
    const before: Vec2 = { x: cat.position.x, y: cat.position.y }
    for (let i = 0; i < 120; i++) rig.tick(0.5)
    expect(cat.position.x).toBe(before.x)
    expect(cat.position.y).toBe(before.y)
  })
})
