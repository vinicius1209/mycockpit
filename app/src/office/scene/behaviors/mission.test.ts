/** Testes do pack MISSÃO/SOCIAL — kickoff, visita do reviewer, sala de
 *  guerra, bastão, comemoração (pulinhos + confete) e entrega na mesa do Boss.
 *  Mesmo padrão do behaviors.test.ts: WalkerSystem real headless + ctx fake;
 *  ids de mesa no formato REAL `${projectId}::${agent}` (a visita do reviewer
 *  deriva a mesa do executor por esse contrato). */
import { beforeEach, describe, expect, it } from "vitest"
import { BOSS_DESK_ID, T_WALK } from "../../engine/types"
import type {
  DeskVisualState,
  FloorPlan,
  OfficeAgentId,
  OfficeSnapshot,
  RoomSnapshot,
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
  CELEBRATE_PRIORITY,
  GATE_VISIT_PRIORITY,
  WAR_PRIORITY,
  activeGateVisit,
  createMissionPack,
  onBossDeskDrop,
  onGateVisitChange,
  type GateVisit,
} from "./mission"
import { useOfficeUi } from "../../ui/store"

const PROJ = "p1"
const DESK_CLAUDE = `${PROJ}::claude-code`
const DESK_CODEX = `${PROJ}::codex`
const DESK_AGY = `${PROJ}::agy`

function openPlan(w = 24, h = 12): FloorPlan {
  const grid = new Uint8Array(w * h).fill(T_WALK)
  return { w, h, grid, rooms: [], spawn: { x: 1.5, y: 1.5 } }
}

const SNAP_EMPTY: OfficeSnapshot = { rooms: [], deliveries: [] }

/** Sala fake com as 3 mesas do projeto (estados vêm do rig). */
function roomSnap(
  states: Partial<Record<string, DeskVisualState>>,
  extra?: Partial<RoomSnapshot>,
): RoomSnapshot {
  const agents: OfficeAgentId[] = ["claude-code", "codex", "agy"]
  return {
    projectId: PROJ,
    name: "Projeto 1",
    agg: "idle",
    costUsd: 0,
    desks: agents.map((agent) => {
      const id = `${PROJ}::${agent}`
      return {
        id,
        projectId: PROJ,
        agent,
        state: states[id] ?? "idle",
        label: "Disponível",
      }
    }),
    ...extra,
  }
}

function makeRig(opts?: { reducedMotion?: boolean; noTargets?: boolean }) {
  const deskIds = [DESK_CLAUDE, DESK_CODEX, DESK_AGY]
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
    anchors.set(id, { x: 1.5 + i * 3, y: 1.5 })
  })
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
    bossPos: () => ({ x: 1.5, y: 1.5 }),
    targets: opts?.noTargets
      ? {
          coffee: null,
          waterCooler: null,
          sofa: null,
          meetingTable: null,
          bossDesk: null,
        }
      : {
          coffee: null,
          waterCooler: null,
          sofa: null,
          meetingTable: { x: 12.5, y: 8.5 },
          bossDesk: { x: 20.5, y: 2.5 },
        },
    time: 0,
    spawnWalker: (o) => walkers.spawn(o),
    handoffBubble: () => {},
  }
  let api!: BehaviorApi
  behaviors.registerPack({
    id: "probe",
    onTick: (_dt, a) => {
      api = a
    },
  })
  behaviors.registerPack(createMissionPack())
  behaviors.update(0, ctx)
  return {
    behaviors,
    ctx,
    seated,
    states,
    api: () => api,
    tick(dt = 1 / 30) {
      ctx.time += dt
      behaviors.update(dt, ctx)
    },
    /** Avança até o escritório esvaziar (ou estourar o guarda). */
    settle() {
      for (let i = 0; i < 60 * 60 && api.tripCount() > 0; i++) this.tick(1 / 60)
    },
    snap(s: OfficeSnapshot = SNAP_EMPTY) {
      behaviors.applySnapshot(s, ctx)
    },
  }
}

beforeEach(() => {
  useOfficeUi.setState({ unseenDeliveries: 0, gateVisit: null })
})

describe("kickoff", () => {
  it("mesas idle vão à mesa de reunião; quem trabalha fica; dedupe por projectId::at", () => {
    const rig = makeRig()
    const api = rig.api()
    rig.states.set(DESK_CODEX, "typing") // trabalhando: fica
    const at = Date.now()
    const snap: OfficeSnapshot = {
      rooms: [roomSnap({ [DESK_CODEX]: "typing" })],
      deliveries: [],
      kickoffs: [{ projectId: PROJ, deskIds: [DESK_CLAUDE, DESK_CODEX], at }],
    }
    rig.snap(snap)
    expect(api.tripCount()).toBe(1)
    expect(api.activeTrip(DESK_CLAUDE)?.priority).toBe(BEHAVIOR_PRIORITY.kickoff)
    expect(api.activeTrip(DESK_CODEX)).toBeNull()
    expect(rig.seated.get(DESK_CODEX)).toBe(true)

    // TTL do derive reapresenta o mesmo evento: não duplica
    rig.snap(snap)
    expect(api.tripCount()).toBe(1)

    // ciclo completo (ida + pausa de 5s + volta): sentado restaurado
    rig.settle()
    expect(rig.seated.get(DESK_CLAUDE)).toBe(true)
    rig.snap(snap)
    expect(api.tripCount()).toBe(0) // já atendido (memória seen)
  })

  it("máximo 1 kickoff por vez — o segundo espera (retenta enquanto o TTL durar)", () => {
    const rig = makeRig()
    const api = rig.api()
    const at = Date.now()
    rig.snap({
      rooms: [roomSnap({})],
      deliveries: [],
      kickoffs: [{ projectId: PROJ, deskIds: [DESK_CLAUDE], at }],
    })
    expect(api.tripCount()).toBe(1)
    // segundo kickoff com a reunião em curso: ninguém levanta agora
    rig.snap({
      rooms: [roomSnap({})],
      deliveries: [],
      kickoffs: [{ projectId: "p2", deskIds: [DESK_CODEX], at: at + 1 }],
    })
    expect(api.activeTrip(DESK_CODEX)).toBeNull()
    expect(api.tripCount()).toBe(1)
    // reunião acabou ⇒ o evento reapresentado agora é atendido
    rig.settle()
    rig.snap({
      rooms: [roomSnap({})],
      deliveries: [],
      kickoffs: [{ projectId: "p2", deskIds: [DESK_CODEX], at: at + 1 }],
    })
    expect(api.activeTrip(DESK_CODEX)).not.toBeNull()
  })
})

describe("visita do reviewer", () => {
  const missionRoom = (status: "running" | "done"): RoomSnapshot =>
    roomSnap(
      { [DESK_CLAUDE]: "thinking" },
      {
        mission: {
          phases: [
            { label: "Planejar", persona: "planner", agent: "claude-code", status: "done" },
            { label: "Executar", persona: "executor", agent: "codex", status: "done" },
            { label: "Revisar", persona: "reviewer", agent: "claude-code", status },
          ],
          current: status === "running" ? 2 : 3,
          executorDeskId: status === "running" ? DESK_CLAUDE : undefined,
        },
      },
    )

  it("fase reviewer rodando: reviewer fica em pé na mesa do executor até a fase acabar", () => {
    const rig = makeRig()
    const api = rig.api()
    rig.states.set(DESK_CLAUDE, "thinking") // fase rodando = mesa ativa
    rig.snap({ rooms: [missionRoom("running")], deliveries: [] })
    const trip = api.activeTrip(DESK_CLAUDE)
    expect(trip).not.toBeNull()
    expect(trip!.priority).toBe(BEHAVIOR_PRIORITY.reviewerVisit)
    expect(rig.seated.get(DESK_CLAUDE)).toBe(false)

    // caminha até a mesa do executor (âncora do codex) e FICA (pausa infinita)
    for (let i = 0; i < 60 * 30 && trip!.phase !== "pause"; i++) rig.tick(1 / 60)
    expect(trip!.phase).toBe("pause")
    expect(trip!.walker.pos.x).toBeCloseTo(4.5, 1)
    for (let i = 0; i < 60; i++) rig.tick(1 / 60)
    expect(trip!.phase).toBe("pause") // segue lá enquanto a fase rodar

    // snapshot igual não duplica a visita
    rig.states.set(DESK_CLAUDE, "thinking")
    rig.snap({ rooms: [missionRoom("running")], deliveries: [] })
    expect(api.tripCount()).toBe(1)

    // fase terminou ⇒ volta ANDANDO (não teleporta) e restaura o sentado
    rig.states.set(DESK_CLAUDE, "idle")
    rig.snap({ rooms: [missionRoom("done")], deliveries: [] })
    expect(rig.seated.get(DESK_CLAUDE)).toBe(false) // ainda voltando
    rig.settle()
    expect(rig.seated.get(DESK_CLAUDE)).toBe(true)
    expect(api.tripCount()).toBe(0)
  })

  it("cenário da screenshot: executor no café é recalled, novo café negado — o reviewer nunca revisa cadeira vazia", () => {
    const rig = makeRig()
    const api = rig.api()
    const CAFE: Vec2 = { x: 20.5, y: 8.5 }
    const startCoffee = () =>
      api.beginTrip({
        deskId: DESK_CODEX, // o EXECUTOR da missão (mesa-alvo da visita)
        priority: BEHAVIOR_PRIORITY.coffee,
        idle: true,
        to: CAFE,
        pauseS: 600,
      })
    // executor idle sai pro café e já está longe da cadeira
    const coffee = startCoffee()
    expect(coffee).not.toBeNull()
    for (let i = 0; i < 30; i++) rig.tick()
    expect(rig.seated.get(DESK_CODEX)).toBe(false)

    // fase de review começa: a visita RESERVA a mesa do executor e o café em
    // voo é recalled graciosamente (o dono volta andando — nunca seco)
    rig.states.set(DESK_CLAUDE, "thinking")
    rig.snap({ rooms: [missionRoom("running")], deliveries: [] })
    const visitTrip = api.activeTrip(DESK_CLAUDE)
    expect(visitTrip).not.toBeNull()
    expect(api.deskReserved(DESK_CODEX)).toBe(true)
    expect(coffee!.phase).toBe("return")
    expect(coffee!.walker.done).toBe(false)

    // dono de volta na cadeira; novo café NEGADO enquanto a visita durar
    for (let i = 0; i < 60 * 60 && coffee!.phase !== "done"; i++) rig.tick(1 / 60)
    expect(rig.seated.get(DESK_CODEX)).toBe(true)
    expect(startCoffee()).toBeNull()

    // reviewer chega e revisa cadeira OCUPADA (a razão da reserva existir)
    for (let i = 0; i < 60 * 60 && visitTrip!.phase !== "pause"; i++)
      rig.tick(1 / 60)
    expect(visitTrip!.phase).toBe("pause")
    expect(rig.seated.get(DESK_CODEX)).toBe(true)

    // fase terminou ⇒ visita volta e a reserva LIBERA (sem deadlock): o café
    // do executor volta a poder sair
    rig.states.set(DESK_CLAUDE, "idle")
    rig.snap({ rooms: [missionRoom("done")], deliveries: [] })
    expect(api.deskReserved(DESK_CODEX)).toBe(true) // ainda voltando
    rig.settle()
    expect(api.deskReserved(DESK_CODEX)).toBe(false)
    expect(startCoffee()).not.toBeNull()
  })
})

describe("gate-visit — o agent vem até você", () => {
  /** Sala com mãos levantadas: mesas listadas ficam em "hand" com o motivo. */
  const handRoom = (hands: Record<string, "gate" | "approval">): RoomSnapshot => {
    const states = Object.fromEntries(
      Object.keys(hands).map((id) => [id, "hand" as DeskVisualState]),
    )
    const room = roomSnap(states)
    for (const d of room.desks) {
      const h = hands[d.id]
      if (h) d.hand = h
    }
    return room
  }
  const gateSnap = (hands: Record<string, "gate" | "approval">): OfficeSnapshot => ({
    rooms: [handRoom(hands)],
    deliveries: [],
  })

  it("gate abre ⇒ caminha até a mesa do Boss com reserva, ESPERA lá e volta quando resolvido", () => {
    const rig = makeRig()
    const api = rig.api()
    const events: (GateVisit | null)[] = []
    const off = onGateVisitChange((v) => events.push(v))

    rig.states.set(DESK_CLAUDE, "hand")
    rig.snap(gateSnap({ [DESK_CLAUDE]: "gate" }))
    const trip = api.activeTrip(DESK_CLAUDE)
    expect(trip).not.toBeNull()
    expect(trip!.priority).toBe(GATE_VISIT_PRIORITY)
    expect(api.deskReserved(BOSS_DESK_ID)).toBe(true) // posto reservado
    expect(rig.seated.get(DESK_CLAUDE)).toBe(false)
    expect(activeGateVisit()).toMatchObject({ deskId: DESK_CLAUDE, waiting: false })
    // espelho do store (ui) já inscrito no emissor
    expect(useOfficeUi.getState().gateVisit).toEqual({
      deskId: DESK_CLAUDE,
      waiting: false,
    })

    // snapshot igual não duplica a visita
    rig.snap(gateSnap({ [DESK_CLAUDE]: "gate" }))
    expect(api.tripCount()).toBe(1)

    // chega AO LADO do atendimento da mesa do Boss (bossDesk + GATE_WAIT_OFFSET
    // — o tile de atendimento fica livre pro boss) e ESPERA (pausa ∞)
    for (let i = 0; i < 60 * 60 && trip!.phase !== "pause"; i++) rig.tick(1 / 60)
    expect(trip!.phase).toBe("pause")
    expect(trip!.walker.pos.x).toBeCloseTo(20.5, 1)
    expect(trip!.walker.pos.y).toBeCloseTo(2.5 + 0.9, 1)
    expect(activeGateVisit()!.waiting).toBe(true) // balão "✋" acende na ui
    for (let i = 0; i < 60; i++) rig.tick(1 / 60)
    expect(trip!.phase).toBe("pause") // segue lá enquanto o gate viver

    // gate RESPONDIDO: a mesa sai de "hand" ⇒ volta ANDANDO (nunca teleporta)
    rig.states.set(DESK_CLAUDE, "typing")
    rig.snap({ rooms: [roomSnap({ [DESK_CLAUDE]: "typing" })], deliveries: [] })
    expect(trip!.phase).toBe("return")
    expect(rig.seated.get(DESK_CLAUDE)).toBe(false) // ainda voltando
    rig.settle()
    expect(rig.seated.get(DESK_CLAUDE)).toBe(true)
    expect(api.deskReserved(BOSS_DESK_ID)).toBe(false) // reserva liberada
    expect(activeGateVisit()).toBeNull()
    expect(useOfficeUi.getState().gateVisit).toBeNull()
    // emissor contou a história inteira: saiu → chegou → acabou
    expect(events).toEqual([
      { deskId: DESK_CLAUDE, waiting: false },
      { deskId: DESK_CLAUDE, waiting: true },
      null,
    ])
    off()
  })

  it("aborto durante a espera (clear) ⇒ sentado restaurado, reserva e emissor limpos", () => {
    const rig = makeRig()
    const api = rig.api()
    rig.states.set(DESK_CLAUDE, "hand")
    rig.snap(gateSnap({ [DESK_CLAUDE]: "gate" }))
    const trip = api.activeTrip(DESK_CLAUDE)
    for (let i = 0; i < 60 * 60 && trip!.phase !== "pause"; i++) rig.tick(1 / 60)
    expect(activeGateVisit()!.waiting).toBe(true)

    rig.behaviors.clear() // missão/cena derrubada no meio da espera
    expect(rig.seated.get(DESK_CLAUDE)).toBe(true) // invariante nº1
    expect(api.deskReserved(BOSS_DESK_ID)).toBe(false)
    expect(activeGateVisit()).toBeNull()
    expect(useOfficeUi.getState().gateVisit).toBeNull()
  })

  it("2 gates simultâneos ⇒ só 1 visita; o 2º fica de mão levantada e sai quando o posto vaga", () => {
    const rig = makeRig()
    const api = rig.api()
    rig.states.set(DESK_CLAUDE, "hand")
    rig.states.set(DESK_CODEX, "hand")
    rig.snap(gateSnap({ [DESK_CLAUDE]: "gate", [DESK_CODEX]: "gate" }))
    expect(api.tripCount()).toBe(1)
    expect(api.activeTrip(DESK_CLAUDE)).not.toBeNull() // 1º da lista viaja
    expect(api.activeTrip(DESK_CODEX)).toBeNull()
    expect(rig.seated.get(DESK_CODEX)).toBe(true) // mão levantada NA MESA

    // 1º gate resolvido: a visita volta; o 2º só sai quando o posto VAGAR
    rig.states.set(DESK_CLAUDE, "idle")
    rig.snap(gateSnap({ [DESK_CODEX]: "gate" }))
    expect(api.activeTrip(DESK_CODEX)).toBeNull() // visita anterior voltando
    rig.settle()
    rig.snap(gateSnap({ [DESK_CODEX]: "gate" }))
    const second = api.activeTrip(DESK_CODEX)
    expect(second).not.toBeNull()
    expect(activeGateVisit()?.deskId).toBe(DESK_CODEX)

    // limpeza: resolve o 2º também (módulo não vaza pro próximo teste)
    rig.states.set(DESK_CODEX, "idle")
    rig.snap(SNAP_EMPTY)
    rig.settle()
    expect(activeGateVisit()).toBeNull()
  })

  it("approval NÃO viaja: mão levantada fica na própria mesa (só gate visita)", () => {
    const rig = makeRig()
    const api = rig.api()
    rig.states.set(DESK_CLAUDE, "hand")
    rig.snap(gateSnap({ [DESK_CLAUDE]: "approval" }))
    expect(api.tripCount()).toBe(0)
    expect(rig.seated.get(DESK_CLAUDE)).toBe(true)
    expect(activeGateVisit()).toBeNull()
  })

  it("mesa ocupada por outra viagem: espera o recall gracioso terminar — nunca derruba seco", () => {
    const rig = makeRig()
    const api = rig.api()
    // dono no café (pausa longa), longe da cadeira
    const coffee = api.beginTrip({
      deskId: DESK_CLAUDE,
      priority: BEHAVIOR_PRIORITY.coffee,
      idle: true,
      to: { x: 12.5, y: 8.5 },
      pauseS: 600,
    })
    expect(coffee).not.toBeNull()
    for (let i = 0; i < 30; i++) rig.tick()

    // gate abre: o estado "hand" sai dos keepStates do café ⇒ recall gracioso
    // do ORQUESTRADOR; o pack NÃO derruba seco — espera a cadeira restaurar
    rig.states.set(DESK_CLAUDE, "hand")
    rig.snap(gateSnap({ [DESK_CLAUDE]: "gate" }))
    expect(api.activeTrip(DESK_CLAUDE)!.priority).toBe(BEHAVIOR_PRIORITY.coffee)
    expect(coffee!.phase).toBe("return")
    expect(activeGateVisit()).toBeNull()

    // café voltou e sentou ⇒ o próximo snapshot despacha a visita do gate
    rig.settle()
    expect(rig.seated.get(DESK_CLAUDE)).toBe(true)
    rig.snap(gateSnap({ [DESK_CLAUDE]: "gate" }))
    expect(api.activeTrip(DESK_CLAUDE)!.priority).toBe(GATE_VISIT_PRIORITY)

    // limpeza do módulo
    rig.states.set(DESK_CLAUDE, "idle")
    rig.snap(SNAP_EMPTY)
    rig.settle()
  })

  it("sem mesa do Boss na planta (noTargets): ninguém viaja — mão fica na mesa", () => {
    const rig = makeRig({ noTargets: true })
    const api = rig.api()
    rig.states.set(DESK_CLAUDE, "hand")
    rig.snap(gateSnap({ [DESK_CLAUDE]: "gate" }))
    expect(api.tripCount()).toBe(0)
    expect(activeGateVisit()).toBeNull()
  })

  it("reducedMotion ⇒ sem caminhada: mão levantada na mesa (notificação nativa cobre)", () => {
    const rig = makeRig({ reducedMotion: true })
    const api = rig.api()
    rig.states.set(DESK_CLAUDE, "hand")
    rig.snap(gateSnap({ [DESK_CLAUDE]: "gate" }))
    rig.tick()
    expect(api.tripCount()).toBe(0)
    expect(activeGateVisit()).toBeNull()
    expect(rig.seated.get(DESK_CLAUDE)).toBe(true)
  })
})

describe("sala de guerra (Fusion)", () => {
  const warRoom = (withWar: boolean): RoomSnapshot =>
    roomSnap(
      { [DESK_CLAUDE]: "typing", [DESK_CODEX]: "typing" },
      withWar ? { war: { deskIds: [DESK_CLAUDE, DESK_CODEX] } } : {},
    )

  it("candidatos vão ao mesão, ganham thought-dots e voltam quando a war some", () => {
    const rig = makeRig()
    const api = rig.api()
    rig.states.set(DESK_CLAUDE, "typing")
    rig.states.set(DESK_CODEX, "typing")
    rig.snap({ rooms: [warRoom(true)], deliveries: [] })
    const a = api.activeTrip(DESK_CLAUDE)
    const b = api.activeTrip(DESK_CODEX)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a!.priority).toBe(WAR_PRIORITY)

    // chegada: frente a frente (x da mesa ∓0.9) + balões anexados ao walker
    const childrenBefore = a!.walker.root.children.length
    for (let i = 0; i < 60 * 30 && (a!.phase !== "pause" || b!.phase !== "pause"); i++)
      rig.tick(1 / 60)
    expect(a!.walker.pos.x).toBeCloseTo(11.6, 1)
    expect(b!.walker.pos.x).toBeCloseTo(13.4, 1)
    expect(a!.walker.root.children.length).toBe(childrenBefore + 1)

    // war persiste ⇒ ninguém volta nem duplica
    rig.snap({ rooms: [warRoom(true)], deliveries: [] })
    expect(api.tripCount()).toBe(2)

    // war sumiu ⇒ voltam andando; sentados restaurados no fim
    rig.snap({ rooms: [warRoom(false)], deliveries: [] })
    rig.settle()
    expect(rig.seated.get(DESK_CLAUDE)).toBe(true)
    expect(rig.seated.get(DESK_CODEX)).toBe(true)
  })
})

describe("bastão de revezamento", () => {
  it("courier fromDesk→toDesk com prioridade de bastão; dedupe por from::to::at", () => {
    const rig = makeRig()
    const api = rig.api()
    const at = Date.now()
    const snap: OfficeSnapshot = {
      rooms: [roomSnap({})],
      deliveries: [],
      batons: [{ fromDeskId: DESK_CLAUDE, toDeskId: DESK_CODEX, at }],
    }
    rig.snap(snap)
    expect(api.tripCount()).toBe(1)
    expect(api.activeTrip(DESK_CLAUDE)?.priority).toBe(BEHAVIOR_PRIORITY.baton)
    expect(rig.seated.get(DESK_CODEX)).toBe(true) // destino nunca levanta
    rig.snap(snap)
    expect(api.tripCount()).toBe(1) // não duplica
    rig.settle()
    expect(rig.seated.get(DESK_CLAUDE)).toBe(true)
  })
})

describe("comemoração", () => {
  it("mesas idle da sala pulam na frente da mesa com confete; quem trabalha fica", () => {
    const rig = makeRig()
    const api = rig.api()
    rig.states.set(DESK_AGY, "typing")
    const at = Date.now()
    rig.snap({
      rooms: [roomSnap({ [DESK_AGY]: "typing" })],
      deliveries: [],
      celebrations: [{ projectId: PROJ, at }],
    })
    expect(api.tripCount()).toBe(2) // claude + codex; agy segue trabalhando
    const trip = api.activeTrip(DESK_CLAUDE)!
    expect(trip.priority).toBe(CELEBRATE_PRIORITY)

    // chegada imediata (from === to): confete anexado + bob transform-only
    const before = trip.walker.root.children.length
    rig.tick(1 / 60)
    expect(trip.phase).toBe("pause")
    expect(trip.walker.root.children.length).toBe(before + 1)
    const y0 = trip.walker.root.position.y
    rig.tick(HOP_SAMPLE)
    expect(trip.walker.root.position.y).toBeLessThan(y0) // pulando (sobe)

    // ~2s depois todo mundo volta a sentar
    rig.settle()
    expect(rig.seated.get(DESK_CLAUDE)).toBe(true)
    expect(rig.seated.get(DESK_CODEX)).toBe(true)
    expect(api.tripCount()).toBe(0)
  })
})

/** Meio pulo (HOP_S/2 = pico do |sin|) — amostra segura do bob. */
const HOP_SAMPLE = 0.2

describe("entrega na mesa do Boss", () => {
  it("courier leva o doc, DEIXA o papel (unseenDeliveries++) e volta; dedupe", () => {
    const rig = makeRig()
    const api = rig.api()
    let drops = 0
    const off = onBossDeskDrop(() => drops++)
    const at = Date.now()
    const snap: OfficeSnapshot = {
      rooms: [roomSnap({})],
      deliveries: [],
      bossDeliveries: [{ deskId: DESK_CLAUDE, convId: "c1", at }],
    }
    rig.snap(snap)
    expect(api.tripCount()).toBe(1)
    expect(api.activeTrip(DESK_CLAUDE)?.priority).toBe(BEHAVIOR_PRIORITY.handoff)
    rig.snap(snap)
    expect(api.tripCount()).toBe(1) // não duplica

    rig.settle()
    expect(drops).toBe(1)
    expect(useOfficeUi.getState().unseenDeliveries).toBe(1) // store inscrito
    expect(rig.seated.get(DESK_CLAUDE)).toBe(true)
    off()

    // Central aberta ⇒ contador zera (ação do store; BossCenter chama ao abrir)
    useOfficeUi.getState().clearUnseenDeliveries()
    expect(useOfficeUi.getState().unseenDeliveries).toBe(0)
  })

  it("sem mesa do boss na planta: marca visto e não retenta", () => {
    const rig = makeRig({ noTargets: true })
    const api = rig.api()
    rig.snap({
      rooms: [roomSnap({})],
      deliveries: [],
      bossDeliveries: [{ deskId: DESK_CLAUDE, convId: "c1", at: Date.now() }],
    })
    expect(api.tripCount()).toBe(0)
  })
})

describe("reducedMotion", () => {
  it("pack inteiro é no-op: nenhum walker pra nenhum evento", () => {
    const rig = makeRig({ reducedMotion: true })
    const api = rig.api()
    const at = Date.now()
    rig.snap({
      rooms: [
        roomSnap(
          { [DESK_CLAUDE]: "typing", [DESK_CODEX]: "typing" },
          { war: { deskIds: [DESK_CLAUDE, DESK_CODEX] } },
        ),
      ],
      deliveries: [],
      kickoffs: [{ projectId: PROJ, deskIds: [DESK_AGY], at }],
      celebrations: [{ projectId: PROJ, at }],
      batons: [{ fromDeskId: DESK_CLAUDE, toDeskId: DESK_CODEX, at }],
      bossDeliveries: [{ deskId: DESK_CODEX, convId: "c1", at }],
    })
    rig.tick()
    expect(api.tripCount()).toBe(0)
    expect(rig.seated.get(DESK_CLAUDE)).toBe(true)
  })
})
