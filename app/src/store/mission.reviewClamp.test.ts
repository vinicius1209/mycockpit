// Contrato v2: o plano desenha o retorno reviewer → executor e o histórico de
// transições aplica maxTraversals=2. O runtime nunca inventa fases corretivas.
//
// Modelado no mission.resume.test.ts (FS fake do run-state, round-trip real
// runToState→JSON→parseRunState) e no mission.review.test.ts (pareceres no
// formato REAL que o template do reviewer produz).

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult } from "@/lib/mission"
import type {
  MissionPhaseDef,
  MissionPreset,
  MissionTransition,
} from "@/lib/missionTypes"
import {
  RUN_STATE_VERSION,
  type MissionRunState,
} from "@/lib/missionState"
import type { ChatItem } from "@/store/chat"

const h = vi.hoisted(() => ({
  results: [] as PhaseResult[],
  calls: [] as { agent: string; prompt: string }[],
  /** FS fake: cwd → run-state.json serializado. */
  disk: new Map<string, string>(),
}))

vi.mock("@/lib/mission", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/mission")>()
  return {
    ...mod,
    runPhase: vi.fn(async (args: import("@/lib/mission").RunPhaseArgs) => {
      h.calls.push({ agent: args.agent, prompt: args.prompt })
      return (
        h.results.shift() ?? {
          ok: true,
          items: [],
          costUsd: 0,
          costSource: undefined,
        }
      )
    }),
  }
})

vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, cancelAgent: vi.fn(async () => {}) }
})

// destilação/entrega: espiona sem tocar no Tauri (as correções deste arquivo
// geram `corrections` — o distill real invocaria o agent helper).
vi.mock("@/lib/learning", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/learning")>()
  return {
    ...mod,
    buildLearningBlocks: vi.fn(async () => ({
      recall: null,
      lessons: null,
      lessonIds: [],
    })),
    markLessonsUsed: vi.fn(async () => {}),
    distillLesson: vi.fn(async () => {}),
  }
})
vi.mock("@/lib/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/db")>()
  return {
    ...mod,
    insertDelivery: vi.fn(async () => {}),
    upsertMission: vi.fn(async () => {}),
    recordTurnCost: vi.fn(async () => {}),
  }
})

// FS fake do run-state (padrão mission.resume.test.ts): parser REAL.
vi.mock("@/lib/missionState", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/missionState")>()
  return {
    ...mod,
    writeRunState: vi.fn(async (cwd: string, state: MissionRunState) => {
      h.disk.set(cwd, JSON.stringify(state))
    }),
    readRunState: vi.fn(async (cwd: string) => {
      const raw = h.disk.get(cwd)
      return raw ? mod.parseRunState(raw) : null
    }),
    writeActivePointer: vi.fn(async () => {}),
    ensureMissionsGitignore: vi.fn(async () => {}),
    readInterruptedFor: vi.fn(async (cwd: string) => {
      const raw = h.disk.get(cwd)
      return raw ? mod.parseRunState(raw) : null
    }),
  }
})

import { useMission } from "./mission"

const CONV = "c1"
const CWD = "/tmp/proj"

function phaseDef(over: Partial<MissionPhaseDef> = {}): MissionPhaseDef {
  return {
    id: "p",
    label: "Fase",
    persona: "executor",
    agent: "claude-code",
    model: null,
    effort: null,
    maxRetries: 1,
    ...over,
  }
}

function preset(phases: [MissionPhaseDef, MissionPhaseDef]): MissionPreset {
  const [executor, reviewer] = phases
  return {
    id: "t",
    revision: 1,
    name: "Teste",
    mode: "graph",
    phases,
    graph: {
      version: 1,
      entryNodeId: `node-${executor.id}`,
      nodes: phases.map((phase, index) => ({
        id: `node-${phase.id}`,
        phaseId: phase.id,
        position: { x: index * 240, y: 0 },
      })),
      edges: [
        {
          id: "executor-reviewer",
          source: `node-${executor.id}`,
          target: `node-${reviewer.id}`,
          condition: "success",
          // Também é interna ao ciclo; três idas cobrem a execução inicial e
          // as duas correções permitidas.
          maxTraversals: 3,
        },
        {
          id: "reviewer-executor",
          source: `node-${reviewer.id}`,
          target: `node-${executor.id}`,
          condition: "failure",
          maxTraversals: 2,
        },
      ],
    },
    maxCostUsd: null,
  }
}

function transition(
  edgeId: string,
  sourceNodeId: string,
  targetNodeId: string,
  sourceVisit: number,
  targetVisit: number,
  outcome: "success" | "failure",
): MissionTransition {
  return {
    edgeId,
    sourceNodeId,
    targetNodeId,
    sourceVisit,
    targetVisit,
    outcome,
    at: targetVisit + 1,
  }
}

function textItem(text: string): ChatItem {
  return { kind: "text", id: crypto.randomUUID(), text }
}

function ok(costUsd = 0, items: ChatItem[] = []): PhaseResult {
  return { ok: true, items, costUsd, costSource: undefined }
}

/** Parecer REPROVADO no formato real do parecer do template do reviewer. */
function reprova(texto: string): PhaseResult {
  return ok(0.1, [textItem(texto)])
}

function launch(pre: MissionPreset): Promise<void> {
  return useMission
    .getState()
    .launch(CONV, pre, "tarefa", "proj1", CWD, "padrao")
}

function run() {
  return useMission.getState().byConv[CONV]
}

async function waitFor(cond: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 0))
  }
  throw new Error("condição não satisfeita a tempo")
}

beforeEach(() => {
  h.results = []
  h.calls = []
  h.disk.clear()
  vi.clearAllMocks()
  useMission.setState({ byConv: {}, interrupted: {} })
})

describe("grafo v2 · retorno do reviewer limitado", () => {
  it("duas voltas são executadas e a terceira reprovação esgota a aresta, sem fase inventada", async () => {
    h.results = [
      ok(0.5), // executor
      reprova("NÃO APROVADO: falta o teste do caso vazio em src/sync.ts."),
      ok(0.3), // executor, visita 3
      reprova("Ainda não está aprovado: o retry segue sem teste de regressão."),
      ok(0.3), // executor, visita 5
      reprova("NÃO APROVADO: o caso de erro de rede continua sem cobertura."),
    ]
    await launch(
      preset([
        phaseDef({ id: "build", label: "Executar" }),
        phaseDef({ id: "review", label: "Revisar", persona: "reviewer" }),
      ]),
    )

    const r = run()
    expect(r.status).toBe("done")
    // A aresta de retorno foi consumida duas vezes, nunca uma terceira.
    expect(h.calls).toHaveLength(6)
    expect(r.phases.map((p) => p.def.label)).toEqual([
      "Executar",
      "Revisar",
      "Executar",
      "Revisar",
      "Executar",
      "Revisar",
    ])
    expect(
      r.execution?.transitions.filter(
        (item) => item.edgeId === "reviewer-executor",
      ),
    ).toHaveLength(2)
    // O snapshot continua sendo o plano que decolou: duas defs, sem append.
    expect(r.execution?.planSnapshot.phases.map((phase) => phase.label)).toEqual([
      "Executar",
      "Revisar",
    ])
    expect(r.reviewCaveat?.rounds).toBe(2)
  })

  it("retomada v2 na terceira visita do reviewer conserva as duas travessias já consumidas", async () => {
    const build = phaseDef({ id: "build", label: "Executar" })
    const review = phaseDef({ id: "review", label: "Revisar", persona: "reviewer" })
    const mid = "m-crash-1234"
    const snapshot = preset([build, review])
    const transitions: MissionTransition[] = [
      transition("executor-reviewer", "node-build", "node-review", 0, 1, "success"),
      transition("reviewer-executor", "node-review", "node-build", 1, 2, "failure"),
      transition("executor-reviewer", "node-build", "node-review", 2, 3, "success"),
      transition("reviewer-executor", "node-review", "node-build", 3, 4, "failure"),
      transition("executor-reviewer", "node-build", "node-review", 4, 5, "success"),
    ]
    const visits: MissionRunState["phases"] = [
      { def: build, visitId: `${mid}:visit:0`, nodeId: "node-build", enteredViaEdgeId: null, outcome: "success", status: "done", costUsd: 0.5 },
      { def: review, visitId: `${mid}:visit:1`, nodeId: "node-review", enteredViaEdgeId: "executor-reviewer", outcome: "failure", status: "done", costUsd: 0.1 },
      { def: build, visitId: `${mid}:visit:2`, nodeId: "node-build", enteredViaEdgeId: "reviewer-executor", outcome: "success", status: "done", costUsd: 0.3 },
      { def: review, visitId: `${mid}:visit:3`, nodeId: "node-review", enteredViaEdgeId: "executor-reviewer", outcome: "failure", status: "done", costUsd: 0.1 },
      { def: build, visitId: `${mid}:visit:4`, nodeId: "node-build", enteredViaEdgeId: "reviewer-executor", outcome: "success", status: "done", costUsd: 0.3 },
      { def: review, visitId: `${mid}:visit:5`, nodeId: "node-review", enteredViaEdgeId: "executor-reviewer", status: "running", costUsd: 0 },
    ]
    const state: MissionRunState = {
      version: RUN_STATE_VERSION,
      missionId: mid,
      dir: ".mycockpit/missions/m-crash",
      convId: CONV,
      task: "tarefa",
      preset: snapshot,
      execution: {
        version: 2,
        planId: snapshot.id,
        planRevision: snapshot.revision ?? 1,
        planSnapshot: snapshot,
        transitions,
      },
      current: 5,
      phases: visits,
      costTotal: 1.3,
      maxCostUsd: null,
      gateDecisions: null,
      gate: null,
      recovery: null,
      reviewLoops: 2,
      lastReview: {
        approved: false,
        feedback: "Ainda não está aprovado: o retry segue sem teste de regressão.",
      },
      status: "running",
      updatedAt: 123,
    }
    h.disk.set(CWD, JSON.stringify(state))
    await useMission.getState().detectInterrupted(CONV, CWD)
    expect(useMission.getState().interrupted[CONV]).toBeDefined()

    // A visita corrente caiu durante o CLI e re-roda; nenhuma visita anterior
    // nem transição já persistida é paga novamente.
    h.results = [
      reprova("NÃO APROVADO: o retry segue engolindo a exceção em src/sync.ts."),
    ]
    useMission.getState().resumeInterrupted(CONV, "proj1", CWD, "padrao")
    await waitFor(() => run()?.status === "done")

    expect(h.calls).toHaveLength(1)
    expect(run().phases).toHaveLength(6)
    expect(run().execution?.transitions).toEqual(transitions)
    expect(run().execution?.planSnapshot.phases).toHaveLength(2)
    expect(run().reviewCaveat).toBeTruthy()
    expect(run().reviewCaveat?.feedback).toContain("NÃO APROVADO")
  })
})
