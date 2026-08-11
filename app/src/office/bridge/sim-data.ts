// Fixtures do office pro BROWSER PURO (vite dev, isTauri() === false): 3
// projetos fake com estados variados e um "roteiro" que alterna as cenas a
// cada ~8s — a cena parece viva sem Tauri nenhum (decisão O8 do design doc).
// MESMA interface do startDeriving: o OfficeMode escolhe a fonte por isTauri().
//
// O roteiro estendido (12 cenas × 8s ≈ 96s de ciclo) exercita TODOS os sinais
// do snapshot: kickoff → fases com personas → handoff → reviewer → celebração
// → bastão → arrival → descanso (restUntil) → guerra Fusion → entrega ao Boss.
//
// Só importa engine/types — zero stores (fixture não deriva nada).

import {
  OFFICE_AGENTS,
  roomAggregate,
  type DeskSnapshot,
  type DeskVisualState,
  type OfficeMissionPhaseStatus,
  type OfficePersona,
  type OfficeSnapshot,
  type RoomMission,
  type RoomSnapshot,
} from "@/lib/fleet/types"

/** Projetos fake — passe direto pro buildFloorPlan no dev de browser. */
export const simProjects: { id: string; name: string; color: string }[] = [
  { id: "sim-frota", name: "Frota", color: "#e4a862" }, // brass (dark)
  { id: "sim-maclan", name: "MacLan BI", color: "#5bb8e8" }, // st-running
  { id: "sim-lab", name: "Lab de ideias", color: "#5bd6a0" }, // st-success
]

/** Troca de cena do roteiro (~8s: dá tempo de ler a cena antes de mudar). */
export const SIM_SCENE_MS = 8000

/** Agendamentos fake pro quadro de avisos no browser puro (O8): 2 itens com
 *  next_run relativo a `now` — o balão "Agendado" tem vida em dev. Estrutural-
 *  mente compatíveis com SchedulableLike + nome (o que o quadro lista). */
export function simSchedules(
  now: number,
): { id: string; name: string; enabled: boolean; nextRun: number | null }[] {
  return [
    {
      id: "sim-sched-1",
      name: "Resumo diário do BI",
      enabled: true,
      nextRun: now + 2 * 60 * 60_000, // em ~2h
    },
    {
      id: "sim-sched-2",
      name: "Varredura semanal de PRs",
      enabled: true,
      nextRun: now + 3 * 24 * 60 * 60_000, // em ~3d
    },
  ]
}

type DeskOverride = {
  state: DeskVisualState
  label: string
  detail?: string
  hand?: "gate" | "approval"
  convId?: string
  /** Persona da fase de missão hospedada na mesa. */
  persona?: OfficePersona
  /** Descanso no sofá: restUntil = now + restInMs (relativo pro dev). */
  restInMs?: number
}

type Scene = {
  /** Overrides por mesa (`${projectId}::${agent}`); ausente = idle. */
  desks: Record<string, DeskOverride>
  /** Balão de entrega que "acabou de chegar" nesta cena. */
  delivery?: { deskId: string; text: string }
  /** Handoff físico de missão (courier mesa→mesa no stage). */
  handoff?: { fromDeskId: string; toDeskId: string }
  /** Reunião de kickoff de missão (mesas das fases). */
  kickoff?: { projectId: string; deskIds: string[] }
  /** Celebração de missão done na sala. */
  celebration?: { projectId: string }
  /** Bastão de revezamento (o agent da conversa mudou). */
  baton?: { fromDeskId: string; toDeskId: string }
  /** Chegada: mesa saiu de off → disponível. */
  arrival?: { deskId: string }
  /** Courier de resultado até a mesa do Boss. */
  bossDelivery?: { deskId: string; convId: string }
  /** Kanban do whiteboard por sala (`projectId` → missão). */
  missions?: Record<string, RoomMission>
  /** Guerra Fusion por sala (`projectId` → mesas em disputa). */
  wars?: Record<string, { deskIds: string[] }>
}

/** Mesa apagada do começo do roteiro: agy "não instalado" no Lab — é a fixture
 *  do estado off (e da chegada: a cena 7 liga a mesa com evento arrival). */
const OFF_DESKS: Record<string, DeskOverride> = {
  "sim-lab::agy": { state: "off", label: "Não detectado" },
}

/** agy do Lab já chegou (cenas pós-arrival sobrescrevem o OFF_DESKS). */
const AGY_CHEGOU: Record<string, DeskOverride> = {
  "sim-lab::agy": { state: "idle", label: "Disponível" },
}

/** Fases da missão fake do MacLan (preset "Feature completa"). */
const MACLAN_FASES = [
  { label: "Planejar", persona: "planner", agent: "claude-code" },
  { label: "Executar", persona: "executor", agent: "codex" },
  { label: "Revisar", persona: "reviewer", agent: "claude-code" },
] as const

/** Kanban do MacLan num estágio: statuses por fase + fase corrente. */
function maclanMission(
  current: number,
  statuses: [
    OfficeMissionPhaseStatus,
    OfficeMissionPhaseStatus,
    OfficeMissionPhaseStatus,
  ],
): RoomMission {
  const cur = MACLAN_FASES[current]
  return {
    phases: MACLAN_FASES.map((f, i) => ({ ...f, status: statuses[i] })),
    current,
    executorDeskId: cur ? `sim-maclan::${cur.agent}` : undefined,
  }
}

/** Fases da missão-relâmpago do Lab (a disputa Fusion é a fase de execução) —
 *  dá kanban a uma sala COM whiteboard (o sorteio de decor do MacLan não tem). */
const LAB_FASES = [
  { label: "Executar", persona: "executor", agent: "claude-code" },
  { label: "Revisar", persona: "reviewer", agent: "claude-code" },
] as const

function labMission(
  current: number,
  statuses: [OfficeMissionPhaseStatus, OfficeMissionPhaseStatus],
): RoomMission {
  const cur = LAB_FASES[current]
  return {
    phases: LAB_FASES.map((f, i) => ({ ...f, status: statuses[i] })),
    current,
    executorDeskId: cur ? `sim-lab::${cur.agent}` : undefined,
  }
}

/** O roteiro: 12 cenas em loop (~96s), cobrindo todos os sinais do snapshot. */
const SCRIPT: Scene[] = [
  // 0 — KICKOFF: a missão do MacLan decola; reunião nas mesas das fases.
  {
    desks: {
      "sim-maclan::claude-code": {
        state: "thinking",
        label: "Planejando",
        detail: "Planejar",
        persona: "planner",
        convId: "sim-conv-m",
      },
    },
    kickoff: {
      projectId: "sim-maclan",
      deskIds: ["sim-maclan::claude-code", "sim-maclan::codex"],
    },
    missions: { "sim-maclan": maclanMission(0, ["running", "queued", "queued"]) },
  },
  // 1 — planner produzindo; Frota trabalha em paralelo.
  {
    desks: {
      "sim-maclan::claude-code": {
        state: "typing",
        label: "Planejando",
        detail: "Read",
        persona: "planner",
        convId: "sim-conv-m",
      },
      "sim-frota::claude-code": {
        state: "typing",
        label: "Digitando",
        detail: "Edit",
        convId: "sim-conv-1",
      },
    },
    missions: { "sim-maclan": maclanMission(0, ["running", "queued", "queued"]) },
  },
  // 2 — HANDOFF planner→executor: courier atravessa a sala com o documento.
  {
    desks: {
      "sim-maclan::codex": {
        state: "typing",
        label: "Executando",
        detail: "Executar",
        persona: "executor",
        convId: "sim-conv-m",
      },
      "sim-frota::claude-code": {
        state: "thinking",
        label: "Pensando",
        convId: "sim-conv-1",
      },
    },
    delivery: {
      deskId: "sim-maclan::claude-code",
      text: "Plano pronto: 3 etapas, começa pelo parser de pedidos.",
    },
    handoff: {
      fromDeskId: "sim-maclan::claude-code",
      toDeskId: "sim-maclan::codex",
    },
    missions: { "sim-maclan": maclanMission(1, ["done", "running", "queued"]) },
  },
  // 3 — GATE de missão: o executor do MacLan precisa de uma DECISÃO — levanta
  //     a mão e VAI até a mesa do Boss esperar (gate-visit da cena). O
  //     approval do Frota, em contraste, fica de mão levantada NA MESA.
  {
    desks: {
      "sim-maclan::codex": {
        state: "hand",
        hand: "gate",
        label: "Precisa de você",
        detail: "Executor",
        persona: "executor",
        convId: "sim-conv-m",
      },
      "sim-frota::claude-code": {
        state: "hand",
        hand: "approval",
        label: "Aguardando aprovação",
        detail: "bun test",
        convId: "sim-conv-1",
      },
    },
    missions: { "sim-maclan": maclanMission(1, ["done", "running", "queued"]) },
  },
  // 4 — VISITA DO REVIEWER: handoff executor→reviewer, revisão em curso.
  {
    desks: {
      "sim-maclan::claude-code": {
        state: "thinking",
        label: "Revisando",
        detail: "Revisar",
        persona: "reviewer",
        convId: "sim-conv-m",
      },
    },
    handoff: {
      fromDeskId: "sim-maclan::codex",
      toDeskId: "sim-maclan::claude-code",
    },
    missions: { "sim-maclan": maclanMission(2, ["done", "done", "running"]) },
  },
  // 5 — CELEBRAÇÃO: missão done + entrega + courier até a mesa do Boss.
  {
    desks: {},
    celebration: { projectId: "sim-maclan" },
    delivery: {
      deskId: "sim-maclan::claude-code",
      text: "Missão concluída: parser novo revisado e aprovado.",
    },
    bossDelivery: { deskId: "sim-maclan::claude-code", convId: "sim-conv-m" },
    missions: { "sim-maclan": maclanMission(3, ["done", "done", "done"]) },
  },
  // 6 — BASTÃO no Frota: a conversa trocou de agent (claude → codex).
  {
    desks: {
      "sim-frota::codex": {
        state: "typing",
        label: "Digitando",
        detail: "Write",
        convId: "sim-conv-1",
      },
    },
    baton: {
      fromDeskId: "sim-frota::claude-code",
      toDeskId: "sim-frota::codex",
    },
    missions: { "sim-maclan": maclanMission(3, ["done", "done", "done"]) },
  },
  // 7 — ARRIVAL: o agy do Lab foi detectado — entra pela porta.
  {
    desks: {
      ...AGY_CHEGOU,
      "sim-frota::codex": {
        state: "thinking",
        label: "Pensando",
        convId: "sim-conv-1",
      },
    },
    arrival: { deskId: "sim-lab::agy" },
    missions: { "sim-maclan": maclanMission(3, ["done", "done", "done"]) },
  },
  // 8 — DESCANSO: auto-resume agendado no Frota — codex vai pro sofá.
  {
    desks: {
      ...AGY_CHEGOU,
      "sim-frota::codex": {
        state: "idle",
        label: "Disponível",
        convId: "sim-conv-1",
        restInMs: 90_000,
      },
    },
    missions: { "sim-maclan": maclanMission(3, ["done", "done", "done"]) },
  },
  // 9 — GUERRA no Lab: disputa Fusion entre claude e codex.
  {
    desks: {
      ...AGY_CHEGOU,
      "sim-lab::claude-code": {
        state: "typing",
        label: "Disputando",
        convId: "sim-conv-4",
      },
      "sim-lab::codex": {
        state: "typing",
        label: "Disputando",
        convId: "sim-conv-4",
      },
    },
    wars: {
      "sim-lab": { deskIds: ["sim-lab::claude-code", "sim-lab::codex"] },
    },
    missions: {
      "sim-maclan": maclanMission(3, ["done", "done", "done"]),
      "sim-lab": labMission(0, ["running", "queued"]),
    },
  },
  // 10 — guerra decidida: vencedor entrega + courier até o Boss.
  {
    desks: {
      ...AGY_CHEGOU,
      "sim-lab::claude-code": {
        state: "thinking",
        label: "Pensando",
        convId: "sim-conv-4",
      },
    },
    delivery: {
      deskId: "sim-lab::claude-code",
      text: "Venci a disputa: proposta com cache incremental.",
    },
    bossDelivery: { deskId: "sim-lab::claude-code", convId: "sim-conv-4" },
    missions: {
      "sim-maclan": maclanMission(3, ["done", "done", "done"]),
      "sim-lab": labMission(1, ["done", "running"]),
    },
  },
  // 11 — calmaria: todo mundo disponível, quadro da missão ainda no whiteboard.
  {
    desks: { ...AGY_CHEGOU },
    missions: {
      "sim-maclan": maclanMission(3, ["done", "done", "done"]),
      "sim-lab": labMission(2, ["done", "done"]),
    },
  },
]

/** Custo base por projeto (US$) — cresce um tico a cada cena (parece vivo). */
const BASE_COST: Record<string, number> = {
  "sim-frota": 12.34,
  "sim-maclan": 3.21,
  "sim-lab": 0.87,
}

/** Monta o snapshot da cena `idx` (puro; `now` carimba balões e eventos). */
export function buildSimScene(idx: number, now: number): OfficeSnapshot {
  const scene = SCRIPT[idx % SCRIPT.length]
  const rooms: RoomSnapshot[] = simProjects.map((p) => {
    const desks = OFFICE_AGENTS.map((agent): DeskSnapshot => {
      const key = `${p.id}::${agent}`
      const over = scene.desks[key] ?? OFF_DESKS[key]
      return {
        id: key,
        projectId: p.id,
        agent,
        state: over?.state ?? "idle",
        label: over?.label ?? "Disponível",
        detail: over?.detail,
        convId: over?.convId,
        hand: over?.hand,
        persona: over?.persona,
        restUntil:
          over?.restInMs !== undefined ? now + over.restInMs : undefined,
      }
    })
    return {
      projectId: p.id,
      name: p.name,
      color: p.color,
      agg: roomAggregate(desks),
      costUsd:
        Math.round(((BASE_COST[p.id] ?? 0) + idx * 0.37) * 100) / 100,
      desks,
      mission: scene.missions?.[p.id],
      war: scene.wars?.[p.id],
    }
  })
  return {
    rooms,
    deliveries: scene.delivery ? [{ ...scene.delivery, at: now }] : [],
    handoffs: scene.handoff ? [{ ...scene.handoff, at: now }] : [],
    kickoffs: scene.kickoff ? [{ ...scene.kickoff, at: now }] : [],
    celebrations: scene.celebration ? [{ ...scene.celebration, at: now }] : [],
    batons: scene.baton ? [{ ...scene.baton, at: now }] : [],
    arrivals: scene.arrival ? [{ ...scene.arrival, at: now }] : [],
    bossDeliveries: scene.bossDelivery
      ? [{ ...scene.bossDelivery, at: now }]
      : [],
  }
}

/** MESMA interface do startDeriving: entrega a 1ª cena já e alterna a cada
 *  ~8s via timer. Retorna o stop (limpa o timer). Dev: localStorage
 *  mc.office.simScene=N CONGELA o roteiro na cena N (capturas/depuração —
 *  mesmo espírito do mc.office.coffeeFast); o snapshot segue re-emitido
 *  (carimbo `now` novo) pros sinais efêmeros continuarem vivos. */
export function startSimData(cb: (s: OfficeSnapshot) => void): () => void {
  let pinned: number | null = null
  try {
    const raw = localStorage.getItem("mc.office.simScene")
    if (raw !== null && raw !== "") {
      const n = Number(raw)
      if (Number.isFinite(n)) {
        pinned = ((Math.trunc(n) % SCRIPT.length) + SCRIPT.length) % SCRIPT.length
      }
    }
  } catch {
    /* localStorage indisponível — roteiro normal */
  }
  let idx = pinned ?? 0
  cb(buildSimScene(idx, Date.now()))
  const timer = setInterval(() => {
    if (pinned === null) idx = (idx + 1) % SCRIPT.length
    cb(buildSimScene(idx, Date.now()))
  }, SIM_SCENE_MS)
  return () => clearInterval(timer)
}
