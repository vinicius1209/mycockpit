// O grafo v2 não inventa fases no meio do voo. Correção e re-review pertencem
// ao Plano de voo congelado no lançamento; o que cresce é somente o ledger
// cronológico de VISITAS quando uma aresta de retorno é atravessada.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult } from "@/lib/mission"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import { phaseProvenance } from "@/lib/missionTypes"

const h = vi.hoisted(() => ({
  results: [] as PhaseResult[],
}))

vi.mock("@/lib/mission", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/mission")>()
  return {
    ...mod,
    runPhase: vi.fn(async () => {
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

import { useMission } from "./mission"
import { useChat, type ChatItem, type ConvState } from "./chat"

const CONV = "c1"
const PROJ = "proj1"

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

function preset(phases: MissionPhaseDef[]): MissionPreset {
  return { id: "t", name: "Teste", phases, maxCostUsd: null }
}

function textItem(text: string): ChatItem {
  return { kind: "text", id: crypto.randomUUID(), text }
}

function ok(costUsd = 0, items: ChatItem[] = []): PhaseResult {
  return { ok: true, items, costUsd, costSource: undefined }
}

function reprova(texto: string): PhaseResult {
  return ok(0.1, [textItem(texto)])
}
function aprova(texto: string): PhaseResult {
  return ok(0.1, [textItem(texto)])
}

/** Revisor no meio, com retorno explícito para uma fase de correção. */
function planoComRevisorNoMeio(): MissionPreset {
  const phases = [
    phaseDef({ id: "build", label: "Migrar o schema" }),
    phaseDef({ id: "review", label: "Revisar o schema", persona: "reviewer" }),
    phaseDef({ id: "fix", label: "Corrigir" }),
    phaseDef({ id: "port", label: "Portar o checkout" }),
    phaseDef({ id: "hist", label: "Portar o histórico" }),
  ]
  return {
    ...preset(phases),
    revision: 1,
    mode: "graph",
    graph: {
      version: 1,
      entryNodeId: "node-build",
      nodes: phases.map((phase, index) => ({
        id: `node-${phase.id}`,
        phaseId: phase.id,
        position: { x: 80 + index * 220, y: phase.id === "fix" ? 260 : 80 },
      })),
      edges: [
        { id: "build-review", source: "node-build", target: "node-review", condition: "success" },
        { id: "review-port", source: "node-review", target: "node-port", condition: "success" },
        { id: "review-fix", source: "node-review", target: "node-fix", condition: "failure", maxTraversals: 2 },
        { id: "fix-review", source: "node-fix", target: "node-review", condition: "success", maxTraversals: 2 },
        { id: "port-hist", source: "node-port", target: "node-hist", condition: "success" },
      ],
    },
  }
}

function seedConv() {
  const conv: ConvState = {
    projectId: PROJ,
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [],
    sessionId: null,
    model: null,
    streamingTextId: null,
    running: false,
    finalizing: false,
    runId: null,
    startedAt: null,
    suggestions: [],
    suggesting: false,
  }
  useChat.setState({
    projectId: PROJ,
    activeId: CONV,
    conversations: [],
    conversationsByProject: {
      [PROJ]: [
        {
          id: CONV,
          title: "Missão · Teste",
          updatedAt: 0,
          color: null,
          worktreePath: null,
          agent: "claude-code",
        },
      ],
    },
    byId: { [CONV]: conv },
  })
}

function launch(pre: MissionPreset): Promise<void> {
  return useMission
    .getState()
    .launch(CONV, pre, "tarefa", PROJ, "/tmp/proj", "padrao")
}

function run() {
  return useMission.getState().byConv[CONV]
}

function notices(): string[] {
  return (useChat.getState().byId[CONV]?.items ?? [])
    .filter((it) => it.kind === "notice")
    .map((it) => (it as Extract<ChatItem, { kind: "notice" }>).message)
}

beforeEach(() => {
  h.results = []
  vi.clearAllMocks()
  useMission.setState({ byConv: {}, interrupted: {} })
  seedConv()
})

describe("rota de correção declarada", () => {
  it("uma reprovação percorre Corrigir e volta ao mesmo nó de revisão", async () => {
    h.results = [
      ok(0.5),
      reprova("NÃO APROVADO: a migração perde os contratos vigentes."),
      ok(0.3),
      aprova("APROVADO. Os contratos seguem válidos."),
      ok(0.2),
      ok(0.2),
    ]
    await launch(planoComRevisorNoMeio())

    expect(run().phases.map((phase) => phase.def.label)).toEqual([
      "Migrar o schema",
      "Revisar o schema",
      "Corrigir",
      "Revisar o schema",
      "Portar o checkout",
      "Portar o histórico",
    ])
    expect(run().execution?.transitions.map((transition) => transition.edgeId)).toEqual([
      "build-review",
      "review-fix",
      "fix-review",
      "review-port",
      "port-hist",
    ])
    expect(notices().some((m) => m.includes("O plano de voo cresceu"))).toBe(false)
  })

  it("duas reprovações atravessam o ciclo duas vezes, sem alterar o snapshot", async () => {
    h.results = [
      ok(0.5),
      reprova("NÃO APROVADO: perde os contratos vigentes."),
      ok(0.3),
      reprova("Ainda não está aprovado: o rollback segue sem teste."),
      ok(0.3),
      aprova("APROVADO. O rollback está coberto."),
      ok(0.2),
      ok(0.2),
    ]
    await launch(planoComRevisorNoMeio())

    expect(run().phases.map((phase) => phase.def.label)).toEqual([
      "Migrar o schema",
      "Revisar o schema",
      "Corrigir",
      "Revisar o schema",
      "Corrigir",
      "Revisar o schema",
      "Portar o checkout",
      "Portar o histórico",
    ])
    expect(run().execution?.planSnapshot.phases).toHaveLength(5)
    expect(run().execution?.transitions.filter((transition) => transition.edgeId === "review-fix")).toHaveLength(2)
  })

  it("revisor aprovou → nenhum marco de crescimento (aviso falso é ruído)", async () => {
    h.results = [ok(0.5), aprova("APROVADO. A migração preserva os contratos."), ok(0.2), ok(0.2)]
    await launch(planoComRevisorNoMeio())

    expect(notices().some((m) => m.includes("O plano de voo cresceu"))).toBe(
      false,
    )
    expect(run().phases).toHaveLength(4)
  })
})

describe("snapshot e procedência", () => {
  it("nenhuma visita é carimbada como fase inventada durante o voo", async () => {
    h.results = [
      ok(0.5),
      reprova("NÃO APROVADO: a migração perde os contratos vigentes."),
      ok(0.3),
      aprova("APROVADO. Os contratos seguem válidos."),
      ok(0.2),
      ok(0.2),
    ]
    await launch(planoComRevisorNoMeio())

    const defs = run().phases.map((p) => p.def)
    expect(defs.every((def) => phaseProvenance(def) === null)).toBe(true)
    expect(run().execution?.planSnapshot.phases.map((phase) => phase.label)).toEqual([
      "Migrar o schema",
      "Revisar o schema",
      "Corrigir",
      "Portar o checkout",
      "Portar o histórico",
    ])
  })
})
