// A correção do revisor entra LOGO DEPOIS da fase que reprovou, não no fim da
// fila. O defeito só aparece com o revisor NO MEIO do plano (nos três presets
// de fábrica ele é a última fase, e aí as duas posições coincidem): com o
// apêndice no fim, as fases seguintes rodavam em cima de um trabalho JÁ
// reprovado e a correção chegava depois de tudo.
//
// Aqui a prova é FIM-A-FIM (a suíte pura mora em lib/missionEngine.test.ts):
// a ORDEM REAL de execução das fases, a coerência do índice `current` e do
// run persistido depois de uma inserção no meio.
//
// Modelado no mission.reviewClamp.test.ts (mesmos mocks, FS fake do run-state
// com parser REAL, pareceres no formato que o template do reviewer produz).

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult } from "@/lib/mission"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
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

function preset(phases: MissionPhaseDef[]): MissionPreset {
  return { id: "t", name: "Teste", phases, maxCostUsd: null }
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
  return preset([
    phaseDef({ id: "build", label: "Migrar o schema" }),
    phaseDef({ id: "review", label: "Revisar o schema", persona: "reviewer" }),
    phaseDef({ id: "port", label: "Portar o checkout" }),
    phaseDef({ id: "hist", label: "Portar o histórico" }),
  ])
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

describe("posição da correção · revisor no MEIO do plano", () => {
  it("a correção roda ANTES das fases seguintes do plano (elas não rodam mais sobre o que foi reprovado)", async () => {
    h.results = [
      ok(0.5), // 0 Migrar o schema
      reprova("NÃO APROVADO: a migração perde os contratos vigentes."),
      ok(0.3), // Corrigir (rodada 1)
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
      "Corrigir (rodada 1)",
      "Revisar (rodada 1)",
      "Portar o checkout",
      "Portar o histórico",
    ])
    // a ORDEM REAL de execução segue os índices do plano já corrigido: as duas
    // fases da cauda rodam por ÚLTIMO, depois da correção aprovada.
    expect(ordemExecutada()).toEqual([0, 1, 2, 3, 4, 5])
    // a fase corretiva levou o parecer como instrução (é ela que corrige)
    expect(h.calls[2].prompt).toContain("perde os contratos vigentes")
    // desfecho limpo: a última revisão aprovou
    expect(r.reviewCaveat ?? null).toBeNull()
    expect(r.current).toBe(6)
  })

  it("o run persistido acompanha a inserção no meio: preset efetivo, status por fase e `current` continuam paralelos", async () => {
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
    expect(st.preset.phases.map((p) => p.label)).toEqual([
      "Migrar o schema",
      "Revisar o schema",
      "Corrigir (rodada 1)",
      "Revisar (rodada 1)",
      "Portar o checkout",
      "Portar o histórico",
    ])
    // uma linha de status por fase, na MESMA ordem, todas concluídas
    expect(st.phases).toHaveLength(6)
    expect(st.phases.every((p) => p.status === "done")).toBe(true)
    expect(st.current).toBe(6)
    expect(st.reviewLoops).toBe(1)
  })

  it("retomada de um plano que cresceu no meio: continua na fase corrente do arquivo, sem re-rodar as anteriores nem reordenar o plano", async () => {
    h.results = [
      ok(0.5),
      reprova("NÃO APROVADO: a migração perde os contratos vigentes."),
      ok(0.3),
      aprova("APROVADO. Os contratos seguem válidos."),
    ]
    await launch(planoComRevisorNoMeio())
    // a missão terminou; o disco guarda o plano de 6 fases. Forjamos o crash
    // logo depois da correção aprovada (fase 4 = Portar o checkout, running).
    const feito = parseRunState(h.disk.get(CWD)!)!
    const crash: MissionRunState = {
      ...feito,
      current: 4,
      phases: [
        { status: "done", costUsd: 0.5 },
        { status: "done", costUsd: 0.1 },
        { status: "done", costUsd: 0.3 },
        { status: "done", costUsd: 0.1 },
        { status: "running", costUsd: 0 },
        { status: "queued", costUsd: 0 },
      ],
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

    // só as duas fases que faltavam rodaram, e nos índices que já tinham
    expect(ordemExecutada()).toEqual([4, 5])
    expect(run().phases.map((p) => p.def.label)).toEqual([
      "Migrar o schema",
      "Revisar o schema",
      "Corrigir (rodada 1)",
      "Revisar (rodada 1)",
      "Portar o checkout",
      "Portar o histórico",
    ])
  })
})

describe("posição da correção · revisor na ÚLTIMA fase", () => {
  it("plano de fábrica (revisor por último): a correção continua no fim, porque ali o fim É logo depois do revisor", async () => {
    h.results = [
      ok(0.5), // Executar
      reprova("NÃO APROVADO: o handler engole a exceção em src/sync.ts."),
      ok(0.3), // Corrigir (rodada 1)
      aprova("APROVADO. O handler propaga a exceção."),
    ]
    await launch(
      preset([
        phaseDef({ id: "build", label: "Executar" }),
        phaseDef({ id: "review", label: "Revisar", persona: "reviewer" }),
      ]),
    )
    expect(run().phases.map((p) => p.def.label)).toEqual([
      "Executar",
      "Revisar",
      "Corrigir (rodada 1)",
      "Revisar (rodada 1)",
    ])
    expect(ordemExecutada()).toEqual([0, 1, 2, 3])
  })
})
