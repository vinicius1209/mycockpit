// Fixtures do office pro BROWSER PURO (vite dev, isTauri() === false): 3
// projetos fake com estados variados e um "roteiro" que alterna as cenas a
// cada ~8s — a cena parece viva sem Tauri nenhum (decisão O8 do design doc).
// MESMA interface do startDeriving: o OfficeMode escolhe a fonte por isTauri().
//
// Só importa engine/types — zero stores (fixture não deriva nada).

import {
  OFFICE_AGENTS,
  roomAggregate,
  type DeskSnapshot,
  type DeskVisualState,
  type OfficeSnapshot,
  type RoomSnapshot,
} from "@/office/engine/types"

/** Projetos fake — passe direto pro buildFloorPlan no dev de browser. */
export const simProjects: { id: string; name: string; color: string }[] = [
  { id: "sim-frota", name: "Frota", color: "#e4a862" }, // brass (dark)
  { id: "sim-maclan", name: "MacLan BI", color: "#5bb8e8" }, // st-running
  { id: "sim-lab", name: "Lab de ideias", color: "#5bd6a0" }, // st-success
]

/** Troca de cena do roteiro (~8s: dá tempo de ler a cena antes de mudar). */
export const SIM_SCENE_MS = 8000

type DeskOverride = {
  state: DeskVisualState
  label: string
  detail?: string
  hand?: "gate" | "approval"
  convId?: string
}

type Scene = {
  /** Overrides por mesa (`${projectId}::${agent}`); ausente = idle. */
  desks: Record<string, DeskOverride>
  /** Balão de entrega que "acabou de chegar" nesta cena. */
  delivery?: { deskId: string; text: string }
}

/** Mesa apagada permanente do roteiro: agy "não instalado" no Lab — é a
 *  fixture do estado off no browser (fora do Tauri não há detecção real). */
const OFF_DESKS: Record<string, DeskOverride> = {
  "sim-lab::agy": { state: "off", label: "Não detectado" },
}

/** O roteiro: 4 cenas em loop, cobrindo typing/thinking/hand(gate)/
 *  hand(approval)/off/idle e um balão de entrega. */
const SCRIPT: Scene[] = [
  {
    desks: {
      "sim-frota::claude-code": {
        state: "typing",
        label: "Digitando",
        detail: "Edit",
        convId: "sim-conv-1",
      },
      "sim-frota::codex": { state: "thinking", label: "Pensando", convId: "sim-conv-2" },
      "sim-maclan::claude-code": { state: "thinking", label: "Planejando", detail: "Planejar" },
    },
  },
  {
    desks: {
      "sim-frota::claude-code": {
        state: "hand",
        hand: "approval",
        label: "Aguardando aprovação",
        detail: "bun test",
        convId: "sim-conv-1",
      },
      "sim-maclan::codex": {
        state: "typing",
        label: "Executando",
        detail: "Executar",
      },
    },
    delivery: {
      deskId: "sim-maclan::claude-code",
      text: "Plano pronto: 3 etapas, começa pelo parser de pedidos.",
    },
  },
  {
    desks: {
      "sim-frota::claude-code": {
        state: "typing",
        label: "Digitando",
        detail: "Write",
        convId: "sim-conv-1",
      },
      "sim-frota::agy": {
        state: "hand",
        hand: "gate",
        label: "Precisa de você",
        detail: "Executando",
        convId: "sim-conv-3",
      },
      "sim-maclan::codex": { state: "thinking", label: "Revisando", detail: "Revisar" },
    },
  },
  {
    desks: {
      "sim-lab::claude-code": { state: "thinking", label: "Pensando", convId: "sim-conv-4" },
    },
    delivery: {
      deskId: "sim-frota::claude-code",
      text: "Pronto! Timeline da missão agora colapsa as fases concluídas.",
    },
  },
]

/** Custo base por projeto (US$) — cresce um tico a cada cena (parece vivo). */
const BASE_COST: Record<string, number> = {
  "sim-frota": 12.34,
  "sim-maclan": 3.21,
  "sim-lab": 0.87,
}

/** Monta o snapshot da cena `idx` (puro; `now` carimba os balões). */
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
    }
  })
  return {
    rooms,
    deliveries: scene.delivery ? [{ ...scene.delivery, at: now }] : [],
  }
}

/** MESMA interface do startDeriving: entrega a 1ª cena já e alterna a cada
 *  ~8s via timer. Retorna o stop (limpa o timer). */
export function startSimData(cb: (s: OfficeSnapshot) => void): () => void {
  let idx = 0
  cb(buildSimScene(idx, Date.now()))
  const timer = setInterval(() => {
    idx = (idx + 1) % SCRIPT.length
    cb(buildSimScene(idx, Date.now()))
  }, SIM_SCENE_MS)
  return () => clearInterval(timer)
}
