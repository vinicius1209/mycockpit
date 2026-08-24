// Contrato v2: com o reviewer no meio, `failure` retorna ao executor e somente
// `success` libera a cauda. A ordem vem do grafo congelado, sem fases apendadas.
//
// Aqui a prova é FIM-A-FIM (a suíte pura mora em lib/missionEngine.test.ts):
// a ORDEM REAL de execução das fases, a coerência do índice `current` e do
// run persistido depois de uma inserção no meio.
//
// Modelado no mission.reviewClamp.test.ts (mesmos mocks, FS fake do run-state
// com parser REAL, pareceres no formato que o template do reviewer produz).

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult } from "@/lib/mission"
import type {
  MissionPhaseDef,
  MissionPlanEdge,
  MissionPreset,
} from "@/lib/missionTypes"
import type { MissionRunState } from "@/lib/missionState"
import type { ChatItem } from "@/store/chat"

const h = vi.hoisted(() => ({
  results: [] as PhaseResult[],
  /** Uma entrada por invocação do runPhase, na ordem: o runId carrega o
   *  ÍNDICE da fase (`<missionId>::phase-<i>`), que é o que prova a ordem. */
  calls: [] as { runId: string; prompt: string }[],
  /** FS fake: cwd → run-state.json serializado. */
  disk: new Map<string, string>(),
}))

vi.mock("@/lib/mission", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/mission")>()
  return {
    ...mod,
    runPhase: vi.fn(async (args: import("@/lib/mission").RunPhaseArgs) => {
      h.calls.push({ runId: args.runId, prompt: args.prompt })
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
import { parseRunState } from "@/lib/missionState"

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

function preset(
  phases: MissionPhaseDef[],
  edges: MissionPlanEdge[],
): MissionPreset {
  return {
    id: "t",
    revision: 1,
    name: "Teste",
    mode: "graph",
    phases,
    graph: {
      version: 1,
      entryNodeId: `node-${phases[0].id}`,
      nodes: phases.map((phase, index) => ({
        id: `node-${phase.id}`,
        phaseId: phase.id,
        position: { x: index * 240, y: 0 },
      })),
      edges,
    },
    maxCostUsd: null,
  }
}

function textItem(text: string): ChatItem {
  return { kind: "text", id: crypto.randomUUID(), text }
}

function ok(costUsd = 0, items: ChatItem[] = []): PhaseResult {
  return { ok: true, items, costUsd, costSource: undefined }
}

/** Parecer no formato real do template do reviewer. */
function reprova(texto: string): PhaseResult {
  return ok(0.1, [textItem(texto)])
}
function aprova(texto: string): PhaseResult {
  return ok(0.1, [textItem(texto)])
}

/** Plano de 4 fases com o revisor NO MEIO (fase 2 de 4). */
function planoComRevisorNoMeio(): MissionPreset {
  return preset(
    [
      phaseDef({ id: "build", label: "Migrar o schema" }),
      phaseDef({ id: "review", label: "Revisar o schema", persona: "reviewer" }),
      phaseDef({ id: "port", label: "Portar o checkout" }),
      phaseDef({ id: "hist", label: "Portar o histórico" }),
    ],
    [
      {
        id: "build-review",
        source: "node-build",
        target: "node-review",
        condition: "success",
        maxTraversals: 3,
      },
      {
        id: "review-build",
        source: "node-review",
        target: "node-build",
        condition: "failure",
        maxTraversals: 2,
      },
      {
        id: "review-port",
        source: "node-review",
        target: "node-port",
        condition: "success",
      },
      {
        id: "port-hist",
        source: "node-port",
        target: "node-hist",
        condition: "success",
      },
    ],
  )
}

function planoComRevisorNoFim(): MissionPreset {
  return preset(
    [
      phaseDef({ id: "build", label: "Executar" }),
      phaseDef({ id: "review", label: "Revisar", persona: "reviewer" }),
    ],
    [
      {
        id: "build-review",
        source: "node-build",
        target: "node-review",
        condition: "success",
        maxTraversals: 3,
      },
      {
        id: "review-build",
        source: "node-review",
        target: "node-build",
        condition: "failure",
        maxTraversals: 2,
      },
    ],
  )
}

function launch(pre: MissionPreset): Promise<void> {
  return useMission
    .getState()
    .launch(CONV, pre, "tarefa", "proj1", CWD, "padrao")
}

function run() {
  return useMission.getState().byConv[CONV]
}

/** Índice da fase de cada invocação, na ordem (runId = `…::phase-<i>`). */
function ordemExecutada(): number[] {
  return h.calls.map((c) => Number(c.runId.slice(c.runId.indexOf("phase-") + 6)))
}

beforeEach(() => {
  h.results = []
  h.calls = []
  h.disk.clear()
  vi.clearAllMocks()
  useMission.setState({ byConv: {}, interrupted: {} })
})

describe("rota explícita · revisor no MEIO do plano", () => {
  it("failure retorna ao executor antes da cauda; success libera as fases seguintes", async () => {
    h.results = [
      ok(0.5), // 0 Migrar o schema
      reprova("NÃO APROVADO: a migração perde os contratos vigentes."),
      ok(0.3), // Migrar o schema, segunda visita
      aprova("APROVADO. A migração preserva os contratos."),
      ok(0.2), // Portar o checkout
      ok(0.2), // Portar o histórico
    ]
    await launch(planoComRevisorNoMeio())

    const r = run()
    expect(r.status).toBe("done")
    expect(r.phases.map((p) => p.def.label)).toEqual([
      "Migrar o schema",
      "Revisar o schema",
      "Migrar o schema",
      "Revisar o schema",
      "Portar o checkout",
      "Portar o histórico",
    ])
    // a ORDEM REAL de execução segue os índices do plano já corrigido: as duas
    // fases da cauda rodam por ÚLTIMO, depois da correção aprovada.
    expect(ordemExecutada()).toEqual([0, 1, 2, 3, 4, 5])
    // A segunda visita do executor recebe o parecer pelo handoff/fallback.
    expect(h.calls[2].prompt).toContain("perde os contratos vigentes")
    // desfecho limpo: a última revisão aprovou
    expect(r.reviewCaveat ?? null).toBeNull()
    expect(r.current).toBe(6)
  })

  it("o run-state mantém o snapshot original e um ledger cronológico de visitas", async () => {
    h.results = [
      ok(0.5),
      reprova("NÃO APROVADO: a migração perde os contratos vigentes."),
      ok(0.3),
      aprova("APROVADO. Os contratos seguem válidos."),
      ok(0.2),
      ok(0.2),
    ]
    await launch(planoComRevisorNoMeio())

    const st = parseRunState(h.disk.get(CWD)!)!
    expect(st.execution?.planSnapshot.phases.map((p) => p.label)).toEqual([
      "Migrar o schema",
      "Revisar o schema",
      "Portar o checkout",
      "Portar o histórico",
    ])
    expect(st.preset.phases.map((p) => p.label)).toEqual([
      "Migrar o schema",
      "Revisar o schema",
      "Portar o checkout",
      "Portar o histórico",
    ])
    expect(st.phases.map((visit) => visit.def?.label)).toEqual([
      "Migrar o schema",
      "Revisar o schema",
      "Migrar o schema",
      "Revisar o schema",
      "Portar o checkout",
      "Portar o histórico",
    ])
    expect(st.phases).toHaveLength(6)
    expect(st.phases.every((p) => p.status === "done")).toBe(true)
    expect(st.current).toBe(6)
    expect(st.reviewLoops).toBe(1)
    expect(st.execution?.transitions.map((item) => item.edgeId)).toEqual([
      "build-review",
      "review-build",
      "build-review",
      "review-port",
      "port-hist",
    ])
  })

  it("retoma a visita de cauda já criada pela transição, sem repetir o reviewer", async () => {
    h.results = [
      ok(0.5),
      reprova("NÃO APROVADO: a migração perde os contratos vigentes."),
      ok(0.3),
      aprova("APROVADO. Os contratos seguem válidos."),
    ]
    await launch(planoComRevisorNoMeio())
    // Forjamos o crash depois de review-port pousar com a visita 4, mas antes de
    // o CLI de Portar o checkout concluir. A transição não pode ser repetida.
    const feito = parseRunState(h.disk.get(CWD)!)!
    const crash: MissionRunState = {
      ...feito,
      current: 4,
      execution: {
        ...feito.execution!,
        transitions: feito.execution!.transitions.slice(0, 4),
      },
      phases: feito.phases.slice(0, 5).map((visit, index) =>
        index === 4
          ? {
              ...visit,
              status: "running" as const,
              outcome: undefined,
              costUsd: 0,
              endedAt: undefined,
            }
          : visit,
      ),
      costTotal: 1,
      status: "running",
    }
    h.disk.set(CWD, JSON.stringify(crash))
    useMission.setState({ byConv: {}, interrupted: {} })
    h.calls = []
    h.results = [ok(0.2), ok(0.2)]

    await useMission.getState().detectInterrupted(CONV, CWD)
    expect(useMission.getState().interrupted[CONV]).toBeDefined()
    useMission.getState().resumeInterrupted(CONV, "proj1", CWD, "padrao")
    await vi.waitFor(() => expect(run()?.status).toBe("done"))

    // Só a visita corrente e a sucessora rodam; o reviewer já transicionado não.
    expect(ordemExecutada()).toEqual([4, 5])
    expect(run().phases.map((p) => p.def.label)).toEqual([
      "Migrar o schema",
      "Revisar o schema",
      "Migrar o schema",
      "Revisar o schema",
      "Portar o checkout",
      "Portar o histórico",
    ])
    expect(
      run().execution?.transitions.filter(
        (item) => item.edgeId === "review-port",
      ),
    ).toHaveLength(1)
  })
})

describe("rota explícita · revisor na ÚLTIMA fase", () => {
  it("o retorno repete as defs originais e a aprovação termina a missão", async () => {
    h.results = [
      ok(0.5), // Executar
      reprova("NÃO APROVADO: o handler engole a exceção em src/sync.ts."),
      ok(0.3), // Corrigir (rodada 1)
      aprova("APROVADO. O handler propaga a exceção."),
    ]
    await launch(planoComRevisorNoFim())
    expect(run().phases.map((p) => p.def.label)).toEqual([
      "Executar",
      "Revisar",
      "Executar",
      "Revisar",
    ])
    expect(ordemExecutada()).toEqual([0, 1, 2, 3])
  })
})
