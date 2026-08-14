// O plano de voo cresce em VOO quando o revisor reprova (o motor acrescenta
// Corrigir + Revisar). O crescimento é correto; o SILÊNCIO é que era o defeito:
// "fase 2 de 4" virava "fase 2 de 6" no mesmo render, sem uma palavra, e o
// número novo ia assim pro banco.
//
// Este arquivo prova os dois registros que fecham o silêncio no motor:
// (1) o MARCO no fio, com autor, causa, o que entrou, onde e de quanto pra
// quanto; (2) a PROCEDÊNCIA carimbada na def das fases acrescentadas, que é o
// que sustenta a marca na tela e o contador com os dois números.
//
// Modelado no mission.budgetNotice.test.ts (conversa semeada pro fio, só o
// runPhase mocado) com os pareceres no formato real do template do reviewer.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult } from "@/lib/mission"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import { phaseProvenance, planCounts } from "@/lib/missionTypes"

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

/** Revisor NO MEIO: 4 fases no lançamento, duas delas depois do revisor. */
function planoComRevisorNoMeio(): MissionPreset {
  return preset([
    phaseDef({ id: "build", label: "Migrar o schema" }),
    phaseDef({ id: "review", label: "Revisar o schema", persona: "reviewer" }),
    phaseDef({ id: "port", label: "Portar o checkout" }),
    phaseDef({ id: "hist", label: "Portar o histórico" }),
  ])
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

describe("o plano cresceu · o marco no fio", () => {
  it("reprovação acrescenta fases → marco com o autor, a causa, o que entrou, onde e os dois números", async () => {
    h.results = [
      ok(0.5),
      reprova("NÃO APROVADO: a migração perde os contratos vigentes."),
      ok(0.3),
      aprova("APROVADO. Os contratos seguem válidos."),
      ok(0.2),
      ok(0.2),
    ]
    await launch(planoComRevisorNoMeio())

    const marco = notices().find((m) => m.includes("O plano de voo cresceu"))
    expect(marco).toBeTruthy()
    // quem mudou e por quê
    expect(marco).toContain("o revisor reprovou a fase 2 (Revisar o schema)")
    expect(marco).toContain("o motor acrescentou")
    // o que entrou
    expect(marco).toContain("Corrigir (rodada 1)")
    expect(marco).toContain("Revisar (rodada 1)")
    // onde entrou (é a correção do outro defeito, e o texto não pode mentir)
    expect(marco).toContain("logo depois dela")
    // de quanto pra quanto: o denominador não muda calado
    expect(marco).toContain("O plano foi de 4 para 6 fases.")
    // sem travessão em prosa de UI (regra do STYLEGUIDE)
    expect(marco).not.toContain("—")
  })

  it("duas rodadas → dois marcos, cada um com o salto da SUA rodada (4→6 e 6→8)", async () => {
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

    const marcos = notices().filter((m) => m.includes("O plano de voo cresceu"))
    expect(marcos).toHaveLength(2)
    expect(marcos[0]).toContain("O plano foi de 4 para 6 fases.")
    expect(marcos[1]).toContain("O plano foi de 6 para 8 fases.")
    expect(marcos[1]).toContain("Corrigir (rodada 2)")
  })

  it("revisor aprovou → nenhum marco de crescimento (aviso falso é ruído)", async () => {
    h.results = [ok(0.5), aprova("APROVADO. A migração preserva os contratos."), ok(0.2), ok(0.2)]
    await launch(planoComRevisorNoMeio())

    expect(notices().some((m) => m.includes("O plano de voo cresceu"))).toBe(
      false,
    )
    expect(planCounts(run().phases.map((p) => p.def)).appended).toBe(0)
  })
})

describe("o plano cresceu · a procedência na fase", () => {
  it("só as fases acrescentadas carregam o carimbo, e o contador sabe dizer com quantas a missão decolou", async () => {
    h.results = [
      ok(0.5),
      reprova("NÃO APROVADO: a migração perde os contratos vigentes."),
      ok(0.3),
      aprova("APROVADO. Os contratos seguem válidos."),
      ok(0.2),
      ok(0.2),
    ]
    const antes = Date.now()
    await launch(planoComRevisorNoMeio())

    const defs = run().phases.map((p) => p.def)
    expect(
      defs.filter((d) => phaseProvenance(d) !== null).map((d) => d.label),
    ).toEqual(["Corrigir (rodada 1)", "Revisar (rodada 1)"])
    const carimbo = phaseProvenance(defs[2])!
    expect(carimbo.round).toBe(1)
    expect(carimbo.at).toBeGreaterThanOrEqual(antes)
    // o contador honesto: 6 agora, 4 no lançamento
    expect(planCounts(defs)).toEqual({ total: 6, launched: 4, appended: 2 })
  })
})
