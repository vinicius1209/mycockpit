/** Testes do sistema de COMPORTAMENTOS — arbitragem central (prioridade,
 *  cap global, invariante "aborto restaura o sentado") + o pack core
 *  (handoff/café) migrado do stage. Puro: WalkerSystem real headless (mesmo
 *  padrão de walkers.test.ts) + ctx fake em Maps — nenhum renderer. */
import { describe, expect, it } from "vitest"
import { T_WALK } from "../engine/types"
import type {
  DeskVisualState,
  FloorPlan,
  OfficeSnapshot,
  Vec2,
} from "../engine/types"
import { createWalkerSystem } from "./walkers"
import {
  BEHAVIOR_PRIORITY,
  MAX_BEHAVIOR_WALKERS,
  behaviorTargetsFromPlan,
  createBehaviors,
  type BehaviorApi,
  type BehaviorCtx,
} from "./behaviors"
import { createCorePack } from "./behaviors/core"

/** Planta aberta (tudo caminhável) — arbitragem não depende de geometria. */
function openPlan(w = 24, h = 12): FloorPlan {
  const grid = new Uint8Array(w * h).fill(T_WALK)
  return { w, h, grid, rooms: [], spawn: { x: 1.5, y: 1.5 } }
}

const SNAP_EMPTY: OfficeSnapshot = { rooms: [], deliveries: [] }

/** Harness: behaviors + ctx fake (Maps de sentado/estado/âncora) + api via
 *  pack-sonda (a api só chega a packs — nunca é exposta fora). */
function makeRig(deskIds: string[], opts?: { reducedMotion?: boolean }) {
  const plan = openPlan()
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
    anchors.set(id, { x: 1.5 + i * 2, y: 1.5 })
  })
  const bubbles: string[] = []
  const ctx: BehaviorCtx = {
    hideSeated: (id) => seated.set(id, false),
    showSeated: (id) => seated.set(id, true),
    seatedVisible: (id) => seated.get(id) ?? false,
    deskAnchor: (id) => anchors.get(id) ?? null,
    deskState: (id) => states.get(id) ?? null,
    deskInfo: (id) => {
      const anchor = anchors.get(id)
      return anchor
        ? { id, agent: "claude-code", color: "#8a9a7b", seed: 1, anchor }
        : null
    },
    deskIds: () => deskIds,
    bossPos: () => ({ x: 1.5, y: 1.5 }),
    targets: {
      coffee: { x: 20.5, y: 1.5 },
      waterCooler: { x: 22.5, y: 1.5 },
      sofa: null,
      meetingTable: null,
      bossDesk: null,
    },
    time: 0,
    spawnWalker: (o) => walkers.spawn(o),
    handoffBubble: (id) => bubbles.push(id),
  }
  let api!: BehaviorApi
  behaviors.registerPack({
    id: "probe",
    onTick: (_dt, a) => {
      api = a
    },
  })
  behaviors.update(0, ctx)
  return {
    behaviors,
    ctx,
    seated,
    states,
    bubbles,
    api: () => api,
    tick(dt = 1 / 30) {
      ctx.time += dt
      behaviors.update(dt, ctx)
    },
    snap(s: OfficeSnapshot = SNAP_EMPTY) {
      behaviors.applySnapshot(s, ctx)
    },
  }
}

const GOAL: Vec2 = { x: 10.5, y: 8.5 }

describe("arbitragem central (beginTrip)", () => {
  it("prioridade maior ABORTA o menor da mesma mesa; aborto restaura o sentado", () => {
    const rig = makeRig(["A"])
    const api = rig.api()
    let aborted = 0
    const low = api.beginTrip({
      deskId: "A",
      priority: BEHAVIOR_PRIORITY.coffee,
      idle: true,
      to: GOAL,
      onAbort: () => aborted++,
    })
    expect(low).not.toBeNull()
    expect(rig.seated.get("A")).toBe(false)

    // mesma mesa, prioridade IGUAL/menor: negada (nunca 2 comportamentos)
    expect(
      api.beginTrip({ deskId: "A", priority: BEHAVIOR_PRIORITY.coffee, to: GOAL }),
    ).toBeNull()
    expect(
      api.beginTrip({ deskId: "A", priority: BEHAVIOR_PRIORITY.wander, to: GOAL }),
    ).toBeNull()
    expect(aborted).toBe(0)

    // prioridade maior toma a mesa: o menor aborta e o sentado vira o novo walker
    const high = api.beginTrip({
      deskId: "A",
      priority: BEHAVIOR_PRIORITY.handoff,
      to: GOAL,
    })
    expect(high).not.toBeNull()
    expect(aborted).toBe(1)
    expect(low!.phase).toBe("done")
    expect(low!.walker.done).toBe(true)
    expect(api.activeTrip("A")).toBe(high)
    expect(api.tripCount()).toBe(1)
    expect(rig.seated.get("A")).toBe(false) // oculto pelo NOVO comportamento

    // invariante nº1: abortar o vigente restaura o sentado imediatamente
    high!.abort()
    expect(rig.seated.get("A")).toBe(true)
    expect(api.tripCount()).toBe(0)
  })

  it("cap global de 3 walkers; prioridade maior derruba o de MENOR prioridade", () => {
    const rig = makeRig(["A", "B", "C", "D"])
    const api = rig.api()
    expect(MAX_BEHAVIOR_WALKERS).toBe(3)
    for (const id of ["A", "B", "C"]) {
      expect(
        api.beginTrip({
          deskId: id,
          priority: BEHAVIOR_PRIORITY.coffee,
          idle: true,
          to: GOAL,
        }),
      ).not.toBeNull()
    }
    expect(api.tripCount()).toBe(3)

    // cap cheio + prioridade igual: negada (sem vítima estritamente menor)
    expect(
      api.beginTrip({
        deskId: "D",
        priority: BEHAVIOR_PRIORITY.coffee,
        idle: true,
        to: GOAL,
      }),
    ).toBeNull()
    expect(api.tripCount()).toBe(3)

    // cap cheio + prioridade maior: derruba o menor (e o restaura na mesa)
    const high = api.beginTrip({
      deskId: "D",
      priority: BEHAVIOR_PRIORITY.handoff,
      to: GOAL,
    })
    expect(high).not.toBeNull()
    expect(api.tripCount()).toBe(3)
    expect(rig.seated.get("A")).toBe(true) // vítima (primeira de menor prioridade)
    expect(api.activeTrip("A")).toBeNull()
    expect(rig.seated.get("D")).toBe(false)
  })

  it("mesa não-idle nunca inicia comportamento OCIOSO (e trabalho respeita startStates)", () => {
    const rig = makeRig(["A"])
    const api = rig.api()
    for (const state of ["typing", "thinking", "hand", "off"] as const) {
      rig.states.set("A", state)
      expect(
        api.beginTrip({
          deskId: "A",
          priority: BEHAVIOR_PRIORITY.coffee,
          idle: true,
          to: GOAL,
        }),
      ).toBeNull()
    }
    // trabalho (default idle|off): negado com a mesa ativa, ok com "off"
    rig.states.set("A", "typing")
    expect(
      api.beginTrip({ deskId: "A", priority: BEHAVIOR_PRIORITY.handoff, to: GOAL }),
    ).toBeNull()
    rig.states.set("A", "off")
    const trip = api.beginTrip({
      deskId: "A",
      priority: BEHAVIOR_PRIORITY.handoff,
      to: GOAL,
    })
    expect(trip).not.toBeNull()
    expect(rig.seated.get("A")).toBe(false)
    trip!.abort()
  })

  it("mesa fora dos keepStates ⇒ RECALL gracioso: volta ANDANDO e só então senta", () => {
    const rig = makeRig(["A", "B"])
    const api = rig.api()
    api.beginTrip({ deskId: "A", priority: BEHAVIOR_PRIORITY.handoff, to: GOAL })
    api.beginTrip({
      deskId: "B",
      priority: BEHAVIOR_PRIORITY.coffee,
      idle: true,
      to: GOAL,
    })
    // trabalho sobrevive a "off", mas não a "typing"; ocioso só sobrevive a "idle"
    rig.states.set("A", "off")
    rig.states.set("B", "off")
    rig.snap()
    expect(api.activeTrip("A")).not.toBeNull()
    // café RECALLED: viagem segue viva (voltando), sentado AINDA oculto —
    // nada de teleporte pra cadeira
    expect(api.activeTrip("B")).not.toBeNull()
    expect(api.activeTrip("B")!.phase).toBe("return")
    expect(rig.seated.get("B")).toBe(false)
    rig.states.set("A", "typing")
    rig.snap()
    expect(api.activeTrip("A")).not.toBeNull()
    expect(api.activeTrip("A")!.phase).toBe("return")
    // anda de volta até sumir: aí sim os sentados são restaurados
    for (let i = 0; i < 600 && api.tripCount() > 0; i++) rig.tick()
    expect(api.tripCount()).toBe(0)
    expect(rig.seated.get("A")).toBe(true)
    expect(rig.seated.get("B")).toBe(true)
  })

  it("sentado re-mostrado por troca de pose DENTRO dos keepStates volta a se esconder (nunca 2 corpos)", () => {
    // cenário real: visita do reviewer/guerra com keepStates thinking+typing —
    // o stage re-aplica a pose (setState→applyPose torna o root visível) quando
    // a mesa alterna thinking→typing; a viagem segue viva e o applySnapshot
    // precisa re-esconder o sentado
    const rig = makeRig(["A"])
    const api = rig.api()
    rig.states.set("A", "thinking")
    const trip = api.beginTrip({
      deskId: "A",
      priority: BEHAVIOR_PRIORITY.reviewerVisit,
      startStates: ["thinking", "typing"],
      keepStates: ["thinking", "typing"],
      to: GOAL,
      pauseS: Number.POSITIVE_INFINITY,
    })
    expect(trip).not.toBeNull()
    expect(rig.seated.get("A")).toBe(false)
    // stage re-mostra o sentado ao aplicar a pose de "typing"
    rig.states.set("A", "typing")
    rig.seated.set("A", true)
    rig.snap()
    expect(api.activeTrip("A")).toBe(trip) // viagem segue viva (keepStates)
    expect(rig.seated.get("A")).toBe(false) // sentado re-escondido
  })

  it("ciclo completo restaura o sentado (onDone) e viagem some do sistema", () => {
    const rig = makeRig(["A"])
    const api = rig.api()
    let done = 0
    api.beginTrip({
      deskId: "A",
      priority: BEHAVIOR_PRIORITY.handoff,
      to: { x: 3.5, y: 1.5 },
      pauseS: 0.2,
      onDone: () => done++,
    })
    for (let i = 0; i < 60 * 30 && api.tripCount() > 0; i++) rig.tick(1 / 60)
    expect(done).toBe(1)
    expect(rig.seated.get("A")).toBe(true)
    expect(api.activeTrip("A")).toBeNull()
  })

  it("clear() restaura TODOS os sentados e zera as viagens", () => {
    const rig = makeRig(["A", "B", "C"])
    const api = rig.api()
    api.beginTrip({ deskId: "A", priority: BEHAVIOR_PRIORITY.handoff, to: GOAL })
    api.beginTrip({
      deskId: "B",
      priority: BEHAVIOR_PRIORITY.coffee,
      idle: true,
      to: GOAL,
    })
    expect(api.tripCount()).toBe(2)
    rig.behaviors.clear()
    expect(api.tripCount()).toBe(0)
    expect(rig.seated.get("A")).toBe(true)
    expect(rig.seated.get("B")).toBe(true)
  })

  it("reducedMotion: beginTrip sempre nega (nenhuma viagem spawna)", () => {
    const rig = makeRig(["A"], { reducedMotion: true })
    const api = rig.api()
    expect(
      api.beginTrip({ deskId: "A", priority: BEHAVIOR_PRIORITY.handoff, to: GOAL }),
    ).toBeNull()
    expect(rig.seated.get("A")).toBe(true)
  })
})

describe("reserva de mesa-alvo (targetDeskId de visitas)", () => {
  /** Visita de A à mesa de B (âncora de B), com reserva. */
  const visit = (api: BehaviorApi) =>
    api.beginTrip({
      deskId: "A",
      priority: BEHAVIOR_PRIORITY.reviewerVisit,
      to: { x: 3.5, y: 1.5 },
      targetDeskId: "B",
      pauseS: Number.POSITIVE_INFINITY,
    })

  it("mesa reservada NEGA ocioso do dono (café/passeio); trabalho passa; aborto da visita libera", () => {
    const rig = makeRig(["A", "B"])
    const api = rig.api()
    const v = visit(api)
    expect(v).not.toBeNull()
    expect(api.deskReserved("B")).toBe(true)
    expect(api.deskReserved("A")).toBe(false)
    // café (idle: true) e passeio-pensante (wander) negados pro dono
    expect(
      api.beginTrip({
        deskId: "B",
        priority: BEHAVIOR_PRIORITY.coffee,
        idle: true,
        to: GOAL,
      }),
    ).toBeNull()
    expect(
      api.beginTrip({ deskId: "B", priority: BEHAVIOR_PRIORITY.wander, to: GOAL }),
    ).toBeNull()
    expect(rig.seated.get("B")).toBe(true)
    // TRABALHO da mesa reservada não é bloqueado (handoff sai normalmente)
    const work = api.beginTrip({
      deskId: "B",
      priority: BEHAVIOR_PRIORITY.handoff,
      to: GOAL,
    })
    expect(work).not.toBeNull()
    work!.abort()
    // visita abortada ⇒ reserva liberada (sem deadlock): café volta a poder
    v!.abort()
    expect(api.deskReserved("B")).toBe(false)
    expect(
      api.beginTrip({
        deskId: "B",
        priority: BEHAVIOR_PRIORITY.coffee,
        idle: true,
        to: GOAL,
      }),
    ).not.toBeNull()
  })

  it("ocioso EM VOO na mesa-alvo é recalled GRACIOSAMENTE; reserva vive até o fim da visita", () => {
    const rig = makeRig(["A", "B"])
    const api = rig.api()
    const coffee = api.beginTrip({
      deskId: "B",
      priority: BEHAVIOR_PRIORITY.coffee,
      idle: true,
      to: GOAL,
      pauseS: 600,
    })
    expect(coffee).not.toBeNull()
    for (let i = 0; i < 30; i++) rig.tick() // B já longe da cadeira
    const v = visit(api)
    expect(v).not.toBeNull()
    // recall gracioso: o café segue VIVO voltando — nunca cancela seco
    expect(coffee!.phase).toBe("return")
    expect(coffee!.walker.done).toBe(false)
    expect(rig.seated.get("B")).toBe(false) // ainda voltando (sem teleporte)
    for (let i = 0; i < 600 && coffee!.phase !== "done"; i++) rig.tick()
    expect(rig.seated.get("B")).toBe(true) // dono sentou de volta
    expect(api.activeTrip("A")).toBe(v) // a visita segue viva
    // novo café negado enquanto a visita durar
    expect(
      api.beginTrip({
        deskId: "B",
        priority: BEHAVIOR_PRIORITY.coffee,
        idle: true,
        to: GOAL,
      }),
    ).toBeNull()
    // visita volta andando: a reserva só libera quando o walker some (onDone)
    v!.walker.leave()
    expect(api.deskReserved("B")).toBe(true)
    for (let i = 0; i < 600 && api.tripCount() > 0; i++) rig.tick()
    expect(api.deskReserved("B")).toBe(false)
    expect(rig.seated.get("A")).toBe(true)
  })

  it("clear() libera as reservas junto com as viagens", () => {
    const rig = makeRig(["A", "B"])
    const api = rig.api()
    expect(visit(api)).not.toBeNull()
    expect(api.deskReserved("B")).toBe(true)
    rig.behaviors.clear()
    expect(api.deskReserved("B")).toBe(false)
    expect(rig.seated.get("A")).toBe(true)
  })
})

describe("pack core (handoff + café migrados do stage)", () => {
  it("handoff spawna courier da mesa origem, entrega (balão) e volta; dedupe por from::to::at", () => {
    const rig = makeRig(["A", "B"])
    rig.behaviors.registerPack(createCorePack())
    const api = rig.api()
    const at = Date.now()
    const snap: OfficeSnapshot = {
      ...SNAP_EMPTY,
      handoffs: [{ fromDeskId: "A", toDeskId: "B", at }],
    }
    rig.snap(snap)
    expect(api.tripCount()).toBe(1)
    expect(api.activeTrip("A")?.priority).toBe(BEHAVIOR_PRIORITY.handoff)
    expect(rig.seated.get("A")).toBe(false)
    expect(rig.seated.get("B")).toBe(true) // destino nunca levanta

    // mesmo handoff de novo (TTL do derive reapresenta): não duplica
    rig.snap(snap)
    expect(api.tripCount()).toBe(1)

    // ciclo completo: balão na mesa destino e sentado da origem de volta
    for (let i = 0; i < 60 * 30 && api.tripCount() > 0; i++) rig.tick(1 / 60)
    expect(rig.bubbles).toEqual(["B"])
    expect(rig.seated.get("A")).toBe(true)

    // já atendido (memória seenHandoffs): não re-spawna após concluir
    rig.snap(snap)
    expect(api.tripCount()).toBe(0)
  })

  it("café: só mesa idle, no máx. 1 por vez, e handoff DERRUBA o café da mesma mesa", () => {
    const rig = makeRig(["A", "B"])
    rig.behaviors.registerPack(createCorePack())
    const api = rig.api()
    // agenda determinística (180–360s): nada spawna antes do intervalo mínimo
    rig.tick()
    expect(api.tripCount()).toBe(0)
    // salto do relógio da sim além do intervalo máximo: A e B ficam "devendo"
    // café, mas só UM sai por vez
    rig.ctx.time += 400
    rig.tick()
    expect(api.tripCount()).toBe(1)
    const coffee =
      api.activeTrip("A") ?? api.activeTrip("B")
    expect(coffee?.priority).toBe(BEHAVIOR_PRIORITY.coffee)
    const deskId = coffee!.deskId

    // handoff da MESMA mesa tem prioridade: café abortado, courier assume
    const other = deskId === "A" ? "B" : "A"
    rig.snap({
      ...SNAP_EMPTY,
      handoffs: [{ fromDeskId: deskId, toDeskId: other, at: Date.now() }],
    })
    expect(coffee!.phase).toBe("done")
    expect(api.activeTrip(deskId)?.priority).toBe(BEHAVIOR_PRIORITY.handoff)
    expect(api.tripCount()).toBe(1)
  })

  it("café não inicia com a mesa ativa (typing) nem com reducedMotion", () => {
    const rig = makeRig(["A"])
    rig.behaviors.registerPack(createCorePack())
    const api = rig.api()
    rig.states.set("A", "typing")
    rig.ctx.time += 400
    rig.tick()
    expect(api.tripCount()).toBe(0)

    const rigRm = makeRig(["A"], { reducedMotion: true })
    rigRm.behaviors.registerPack(createCorePack())
    rigRm.ctx.time += 400
    rigRm.tick()
    expect(rigRm.api().tripCount()).toBe(0)
    expect(rigRm.seated.get("A")).toBe(true)
  })
})

describe("behaviorTargetsFromPlan", () => {
  it("planta sem sala comum/boss: todos os alvos null", () => {
    const t = behaviorTargetsFromPlan(openPlan())
    expect(t).toEqual({
      coffee: null,
      waterCooler: null,
      sofa: null,
      meetingTable: null,
      bossDesk: null,
    })
  })

  it("extrai cafeteira/bebedouro/sofá/mesão da sala comum e a mesa do boss", () => {
    const plan = openPlan()
    plan.commonRoom = {
      id: "commons",
      origin: { x: 10, y: 2 },
      w: 12,
      h: 9,
      doorTiles: [],
      decor: [],
    }
    plan.bossRoom = {
      id: "boss",
      origin: { x: 0, y: 0 },
      w: 10,
      h: 8,
      doorTiles: [],
      deskTile: { x: 3, y: 1 },
      deskFootprint: { w: 4, h: 2 },
      interactTile: { x: 5, y: 4 },
      decor: [],
    }
    const t = behaviorTargetsFromPlan(plan)
    expect(t.coffee).toEqual({ x: 11.5, y: 3.5 })
    expect(t.waterCooler).toEqual({ x: 13.5, y: 3.5 })
    expect(t.sofa).toEqual({ x: 18.5, y: 8.5 })
    expect(t.meetingTable).toEqual({ x: 16.5, y: 8.5 })
    expect(t.bossDesk).toEqual({ x: 5.5, y: 4.5 })
  })
})
