/** Testes do pack PESSOAL (estados corporais) — mesmo padrão headless do
 *  behaviors.test.ts: WalkerSystem real + ctx fake em Maps, nenhum renderer.
 *  Cobrem: pensar andando (>8s + loop + abort por estado), descanso no sofá
 *  (restUntil + wake), cumprimento (proximidade + cooldown) e chegada
 *  (walk-in porta→mesa com dedupe). reducedMotion ⇒ nada acontece. */
import { describe, expect, it, vi } from "vitest"
import { T_WALK } from "../../engine/types"
import type {
  DeskSnapshot,
  DeskVisualState,
  FloorPlan,
  OfficeSnapshot,
  Vec2,
} from "../../engine/types"
import { createWalkerSystem } from "../walkers"
import {
  BEHAVIOR_PRIORITY,
  createBehaviors,
  type BehaviorApi,
  type BehaviorCtx,
} from "../behaviors"
import {
  GREET_COOLDOWN_S,
  REST_LEAN_RAD,
  THINK_PACE_AFTER_S,
  createPersonalPack,
  nearestDoor,
} from "./personal"

/** Planta aberta com UMA sala contendo as mesas (porta pro "corredor"). */
function planWithRoom(deskIds: string[]): FloorPlan {
  const w = 24
  const h = 14
  const grid = new Uint8Array(w * h).fill(T_WALK)
  return {
    w,
    h,
    grid,
    rooms: [
      {
        projectId: "p1",
        row: 0,
        origin: { x: 1, y: 1 },
        w: 10,
        h: 8,
        doorTiles: [{ x: 6, y: 9 }],
        desks: deskIds.map((id, i) => ({
          id,
          projectId: "p1",
          agent: "claude-code" as const,
          tile: { x: 1 + i * 3, y: 1 },
          interactTile: { x: 1 + i * 3, y: 3 },
          flip: false,
        })),
      },
    ],
    spawn: { x: 12.5, y: 12.5 },
  }
}

const SNAP_EMPTY: OfficeSnapshot = { rooms: [], deliveries: [] }

/** Snapshot com restUntil por mesa (o pack lê rooms[].desks[].restUntil). */
function restSnap(restByDesk: Record<string, number | undefined>): OfficeSnapshot {
  const desks: DeskSnapshot[] = Object.entries(restByDesk).map(
    ([id, restUntil]) => ({
      id,
      projectId: "p1",
      agent: "claude-code",
      state: "idle",
      label: "Disponível",
      restUntil,
    }),
  )
  return {
    rooms: [{ projectId: "p1", name: "P1", agg: "idle", costUsd: 0, desks }],
    deliveries: [],
  }
}

function makeRig(deskIds: string[], opts?: { reducedMotion?: boolean }) {
  const plan = planWithRoom(deskIds)
  const walkers = createWalkerSystem(plan)
  const behaviors = createBehaviors({
    plan,
    walkers,
    reducedMotion: opts?.reducedMotion ?? false,
  })
  const seated = new Map<string, boolean>()
  const states = new Map<string, DeskVisualState>()
  const anchors = new Map<string, Vec2>()
  deskIds.forEach((id, i) => {
    seated.set(id, true)
    states.set(id, "idle")
    anchors.set(id, { x: 1.5 + i * 3, y: 3.5 })
  })
  const waved: string[] = []
  const bossPos: Vec2 = { x: 20.5, y: 12.5 } // longe por padrão
  const ctx: BehaviorCtx = {
    hideSeated: (id) => seated.set(id, false),
    showSeated: (id) => seated.set(id, true),
    seatedVisible: (id) => seated.get(id) ?? false,
    deskAnchor: (id) => anchors.get(id) ?? null,
    deskState: (id) => states.get(id) ?? null,
    deskInfo: (id) => {
      const anchor = anchors.get(id)
      return anchor
        ? { id, agent: "claude-code", color: "#8a9a7b", seed: 7, anchor }
        : null
    },
    deskIds: () => deskIds,
    bossPos: () => bossPos,
    targets: {
      coffee: null,
      waterCooler: null,
      sofa: { x: 18.5, y: 6.5 },
      meetingTable: null,
      bossDesk: null,
    },
    time: 0,
    spawnWalker: (o) => walkers.spawn(o),
    handoffBubble: () => {},
    waveSeated: (id) => waved.push(id),
  }
  let api!: BehaviorApi
  behaviors.registerPack({
    id: "probe",
    onTick: (_dt, a) => {
      api = a
    },
  })
  behaviors.registerPack(createPersonalPack())
  behaviors.update(0, ctx)
  return {
    behaviors,
    ctx,
    seated,
    states,
    waved,
    bossPos,
    api: () => api,
    tick(dt = 1 / 30) {
      ctx.time += dt
      behaviors.update(dt, ctx)
    },
    /** Avança a sim até `cond` (ou estoura o teto de segundos). */
    tickUntil(cond: () => boolean, maxS = 60) {
      for (let i = 0; i < maxS * 30 && !cond(); i++) this.tick()
      expect(cond()).toBe(true)
    },
    snap(s: OfficeSnapshot = SNAP_EMPTY) {
      behaviors.applySnapshot(s, ctx)
    },
  }
}

describe("pensar andando", () => {
  it("mesa thinking há >8s levanta pra andar (wander); estado novo aborta e senta", () => {
    const rig = makeRig(["A"])
    const api = rig.api()
    rig.states.set("A", "thinking")
    rig.tick() // registra o started-at
    expect(api.tripCount()).toBe(0)

    // antes do limiar: sentado pensando na mesa
    rig.ctx.time += THINK_PACE_AFTER_S - 1
    rig.tick()
    expect(api.tripCount()).toBe(0)

    // passou do limiar: levanta (prioridade mínima) com os dots no walker
    rig.ctx.time += 2
    rig.tick()
    const trip = api.activeTrip("A")
    expect(trip?.priority).toBe(BEHAVIOR_PRIORITY.wander)
    expect(rig.seated.get("A")).toBe(false)
    // balões de pensamento anexados ao walker (sombras + corpo + dots)
    expect(trip!.walker.root.children.length).toBeGreaterThanOrEqual(4)

    // terminou o turno: RECALL gracioso (keepStates=[thinking]) — volta
    // ANDANDO e só senta quando o walker chega (nada de pulo pra cadeira)
    rig.states.set("A", "idle")
    rig.snap()
    expect(api.activeTrip("A")?.phase).toBe("return")
    expect(rig.seated.get("A")).toBe(false)
    rig.tickUntil(() => api.tripCount() === 0, 30)
    expect(rig.seated.get("A")).toBe(true)
  })

  it("EPISÓDIOS, não loop: com 1 perna sorteada, completa e DESCANSA sentado", () => {
    // Math.random=0 ⇒ episódio de 1 perna, jitter mínimo, descanso mínimo
    const rnd = vi.spyOn(Math, "random").mockReturnValue(0)
    try {
      const rig = makeRig(["A"])
      const api = rig.api()
      rig.states.set("A", "thinking")
      rig.tick()
      rig.ctx.time += THINK_PACE_AFTER_S + 1
      rig.tick()
      expect(api.tripCount()).toBe(1)

      // volta completa: o walker some e o sentado reaparece...
      rig.tickUntil(() => api.tripCount() === 0, 30)
      expect(rig.seated.get("A")).toBe(true)
      // ...mas o episódio ACABOU (1 perna): mesmo pensando, ele fica sentado
      // descansando — nada de loop imediato
      rig.ctx.time += 5
      rig.tick()
      expect(api.tripCount()).toBe(0)
      // só depois do descanso (18s+) ele levanta de novo
      rig.ctx.time += 20
      rig.tick()
      expect(api.tripCount()).toBe(1)
      expect(api.activeTrip("A")?.priority).toBe(BEHAVIOR_PRIORITY.wander)
    } finally {
      rnd.mockRestore()
    }
  })
})

describe("descanso no sofá", () => {
  it("restUntil futuro: caminha ao sofá (prioridade sofaRest), encosta com 💤 e volta quando o sinal some", () => {
    const rig = makeRig(["A"])
    const api = rig.api()
    rig.snap(restSnap({ A: Date.now() + 120_000 }))
    rig.tick()
    const trip = api.activeTrip("A")
    expect(trip?.priority).toBe(BEHAVIOR_PRIORITY.sofaRest)
    expect(rig.seated.get("A")).toBe(false)

    // chegou: pausa longa, lean de "encostado" + efeito 💤 anexado
    rig.tickUntil(() => trip!.phase === "pause", 60)
    rig.tick()
    expect(trip!.walker.root.rotation).toBeCloseTo(REST_LEAN_RAD)
    expect(trip!.walker.root.children.length).toBeGreaterThanOrEqual(4)

    // o auto-resume disparou (sinal sumiu do snapshot): acorda e volta
    rig.snap(restSnap({ A: undefined }))
    rig.tick()
    expect(trip!.walker.root.rotation).toBe(0) // lean desfeito ao acordar
    rig.tickUntil(() => api.tripCount() === 0, 60)
    expect(rig.seated.get("A")).toBe(true)
  })

  it("restUntil já perto de vencer (<7s): não vale a caminhada", () => {
    const rig = makeRig(["A"])
    rig.snap(restSnap({ A: Date.now() + 3_000 }))
    rig.tick()
    expect(rig.api().tripCount()).toBe(0)
    expect(rig.seated.get("A")).toBe(true)
  })
})

describe("cumprimento", () => {
  it("boss a <2.5 tiles de mesa idle: acena UMA vez; cooldown de 30s por mesa", () => {
    const rig = makeRig(["A"])
    rig.bossPos.x = 2.5
    rig.bossPos.y = 3.5 // a 1 tile da âncora de A
    rig.tick()
    expect(rig.waved).toEqual(["A"])
    for (let i = 0; i < 30; i++) rig.tick()
    expect(rig.waved).toEqual(["A"]) // dentro do cooldown: nada

    rig.ctx.time += GREET_COOLDOWN_S + 1
    rig.tick()
    expect(rig.waved).toEqual(["A", "A"]) // boss continua perto: re-acena
  })

  it("mesa ocupada (typing) ou boss longe: não acena", () => {
    const rig = makeRig(["A"])
    rig.tick() // boss longe (default)
    expect(rig.waved).toEqual([])
    rig.bossPos.x = 2.5
    rig.bossPos.y = 3.5
    rig.states.set("A", "typing")
    rig.tick()
    expect(rig.waved).toEqual([])
  })
})

describe("chegada ao trabalho", () => {
  it("arrival: esconde o sentado, entra pela porta, senta na mesa; dedupe por at", () => {
    const rig = makeRig(["A"])
    const at = Date.now()
    const snap: OfficeSnapshot = {
      ...SNAP_EMPTY,
      arrivals: [{ deskId: "A", at }],
    }
    rig.snap(snap)
    expect(rig.seated.get("A")).toBe(false) // corpo virou walker na porta

    // mesmo arrival reapresentado pelo TTL do derive: não duplica
    rig.snap(snap)
    expect(rig.seated.get("A")).toBe(false)

    // caminha porta→mesa e senta (walker some, sentado reaparece)
    rig.tickUntil(() => rig.seated.get("A") === true, 60)
    expect(rig.api().tripCount()).toBe(0) // walk-in nunca entra no cap
  })

  it("mesa volta a 'off' no meio do walk-in: cancela e a cadeira fica vazia", () => {
    const rig = makeRig(["A"])
    rig.snap({ ...SNAP_EMPTY, arrivals: [{ deskId: "A", at: Date.now() }] })
    expect(rig.seated.get("A")).toBe(false)
    rig.tick()
    rig.states.set("A", "off")
    rig.snap()
    // walker cancelado; sentado segue oculto (off ⇒ cadeira vazia)
    expect(rig.seated.get("A")).toBe(false)
    for (let i = 0; i < 90; i++) rig.tick()
    expect(rig.seated.get("A")).toBe(false)
  })

  it("nearestDoor: escolhe a porta mais próxima da mesa; null sem sala", () => {
    const plan = planWithRoom(["A"])
    plan.rooms[0].doorTiles = [
      { x: 2, y: 9 },
      { x: 9, y: 9 },
    ]
    expect(nearestDoor(plan, "A", { x: 1.5, y: 3.5 })).toEqual({
      x: 2.5,
      y: 9.5,
    })
    expect(nearestDoor(plan, "Z", { x: 1.5, y: 3.5 })).toBeNull()
  })
})

describe("reducedMotion", () => {
  it("nada acontece: sem passeio, sem sofá, sem aceno, sem walk-in", () => {
    const rig = makeRig(["A"], { reducedMotion: true })
    rig.states.set("A", "thinking")
    rig.tick()
    rig.ctx.time += THINK_PACE_AFTER_S + 5
    rig.tick()
    expect(rig.api().tripCount()).toBe(0)

    rig.states.set("A", "idle")
    rig.snap(restSnap({ A: Date.now() + 120_000 }))
    rig.bossPos.x = 2.5
    rig.bossPos.y = 3.5
    rig.tick()
    expect(rig.api().tripCount()).toBe(0)
    expect(rig.waved).toEqual([])

    rig.snap({ ...SNAP_EMPTY, arrivals: [{ deskId: "A", at: Date.now() }] })
    expect(rig.seated.get("A")).toBe(true) // sentado intocado
  })
})
