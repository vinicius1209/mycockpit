// MH3.3 — política de gate NO MOTOR (store/mission.launch): o ponto onde o
// gate abre consulta preset.gatePolicy. "agente" (ou ausente) = clássico;
// "nunca" = nunca pausa e as open_questions viram notice no fio (informação
// nunca some); "sempre-apos-planejar" = gate obrigatório após a fase 1 mesmo
// SEM perguntas, com a pergunta padrão de revisão do plano.
//
// Modelado no mission.gateAnswers.test.ts: runPhase (agent real), readHandoff
// (FS) e lib/notify (Tauri) mocados; helpers puros de @/lib/mission reais.
// Fixture de handoff no formato REAL do blackboard .mission/*.json.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult } from "@/lib/mission"
import type { HandoffDoc } from "@/lib/missionHandoff"
import type {
  MissionGatePolicy,
  MissionPhaseDef,
  MissionPreset,
} from "@/lib/missionTypes"

const h = vi.hoisted(() => ({
  results: [] as PhaseResult[],
  handoffs: [] as (HandoffDoc | null)[],
  calls: [] as { agent: string; prompt: string }[],
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

// readHandoff mocado: fora do Tauri o real devolve null e o gate nunca abre.
vi.mock("@/lib/missionHandoff", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/missionHandoff")>()
  return {
    ...mod,
    readHandoff: vi.fn(async () => h.handoffs.shift() ?? null),
  }
})

vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, cancelAgent: vi.fn(async () => {}) }
})

vi.mock("@/lib/notify", () => ({
  notifyGate: vi.fn(),
  notifyTurnEnd: vi.fn(),
  nativeNotify: vi.fn(),
  notifyMissionEnd: vi.fn(),
  notifyMissionRecovery: vi.fn(),
}))

import { useMission } from "./mission"
import { useChat, type ChatItem, type ConvState } from "./chat"
import { notifyGate } from "@/lib/notify"

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
  gatePolicy?: MissionGatePolicy,
): MissionPreset {
  return {
    id: "t",
    name: "Teste",
    phases,
    maxCostUsd: null,
    ...(gatePolicy ? { gatePolicy } : {}),
  }
}

function ok(costUsd = 0): PhaseResult {
  return { ok: true, items: [], costUsd, costSource: undefined }
}

/** Handoff no formato REAL do blackboard (o planner emitiu open_questions). */
function gateHandoff(questions: string[]): HandoffDoc {
  return {
    intent: "implementar o parser de eventos",
    decisions: [
      {
        choice: "usar o reducer existente em store/chat",
        rejected: "escrever um parser novo",
        reason: "o reducer já cobre os eventos do stream",
      },
    ],
    open_questions: questions,
    files_touched: ["src/lib/parser.ts"],
    for_next_agent: "rode os testes antes de mexer no reducer",
  }
}

const REAL_QUESTIONS = [
  "Devo usar a porta 5175 do dev server ou a 1420 do Tauri?",
]

const CONV = "c1"
const PROJ = "proj1"

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
    .launch(CONV, pre, "tarefa da missão", PROJ, "/tmp/proj", "padrao")
}

function run() {
  return useMission.getState().byConv[CONV]
}

function notices(): string[] {
  return (useChat.getState().byId[CONV]?.items ?? [])
    .filter((it) => it.kind === "notice")
    .map((it) => (it as Extract<ChatItem, { kind: "notice" }>).message)
}

async function waitFor(cond: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 0))
  }
  throw new Error("condição não satisfeita a tempo")
}

beforeEach(() => {
  h.results = []
  h.handoffs = []
  h.calls = []
  vi.mocked(notifyGate).mockClear()
  useMission.setState({ byConv: {} })
  seedConv()
})

describe("política 'nunca' — nunca pausa, perguntas viram notice", () => {
  it("handoff COM open_questions: sem gate, missão conclui e as perguntas ficam no fio", async () => {
    h.results = [ok(0.1), ok(0.2)]
    h.handoffs = [gateHandoff(REAL_QUESTIONS)]
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2" })], "nunca"))
    await p

    expect(run().status).toBe("done")
    expect(run().gate ?? null).toBeNull()
    expect(notifyGate).not.toHaveBeenCalled()
    expect(h.calls).toHaveLength(2) // as duas fases rodaram sem pausa
    // as perguntas NÃO somem: notice informativo no fio.
    const notice = notices().find((m) => m.includes("perguntas em aberto"))
    expect(notice).toBeTruthy()
    expect(notice).toContain(REAL_QUESTIONS[0])
    expect(notice).toContain("não pausa")
  })

  it("sem open_questions: nenhum notice de gate (nada a avisar)", async () => {
    h.results = [ok(), ok()]
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2" })], "nunca"))
    await p
    expect(run().status).toBe("done")
    expect(notices().find((m) => m.includes("perguntas em aberto"))).toBeUndefined()
  })
})

describe("política 'sempre-apos-planejar' — gate obrigatório após a fase 1", () => {
  it("fase 1 SEM open_questions: gate abre com a pergunta padrão e a resposta viaja pro prompt da fase 2", async () => {
    h.results = [ok(0.1), ok(0.2)]
    // handoff da fase 1 SEM perguntas (o caso que hoje não gataria).
    h.handoffs = [gateHandoff([])]
    const p = launch(
      preset(
        [phaseDef({ id: "plan", persona: "planner" }), phaseDef({ id: "p2" })],
        "sempre-apos-planejar",
      ),
    )

    await waitFor(() => !!run()?.gate)
    expect(run().gate?.questions).toEqual(["Revise o plano antes de executar"])
    expect(notifyGate).toHaveBeenCalledTimes(1)

    useMission.getState().answerGate(CONV, ["plano ok, siga"])
    await waitFor(() => run()?.status === "done")
    await p

    expect(h.calls).toHaveLength(2)
    expect(h.calls[1].prompt).toContain("P: Revise o plano antes de executar")
    expect(h.calls[1].prompt).toContain("R: plano ok, siga")
  })

  it("fase 1 COM open_questions: o gate usa as perguntas do planner (a padrão não entra)", async () => {
    h.results = [ok(), ok()]
    h.handoffs = [gateHandoff(REAL_QUESTIONS)]
    const p = launch(
      preset(
        [phaseDef({ id: "plan", persona: "planner" }), phaseDef({ id: "p2" })],
        "sempre-apos-planejar",
      ),
    )

    await waitFor(() => !!run()?.gate)
    expect(run().gate?.questions).toEqual(REAL_QUESTIONS)
    expect(run().gate?.questions).not.toContain(
      "Revise o plano antes de executar",
    )

    useMission.getState().answerGate(CONV, ["5175"])
    await waitFor(() => run()?.status === "done")
    await p
  })

  it("fase 2 sem perguntas NÃO gata de novo (obrigatório é só após a fase 1)", async () => {
    h.results = [ok(), ok(), ok()]
    h.handoffs = [gateHandoff([])]
    const p = launch(
      preset(
        [phaseDef({ id: "plan" }), phaseDef({ id: "p2" }), phaseDef({ id: "p3" })],
        "sempre-apos-planejar",
      ),
    )

    await waitFor(() => !!run()?.gate)
    useMission.getState().answerGate(CONV, ["segue"])
    await waitFor(() => run()?.status === "done")
    await p

    expect(h.calls).toHaveLength(3)
    expect(notifyGate).toHaveBeenCalledTimes(1) // um único gate na missão toda
  })
})

describe("política 'agente' (ausente) — comportamento clássico preservado", () => {
  it("preset SEM gatePolicy (salvo antes do campo): open_questions abrem gate como sempre", async () => {
    h.results = [ok(), ok()]
    h.handoffs = [gateHandoff(REAL_QUESTIONS)]
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2" })]))

    await waitFor(() => !!run()?.gate)
    expect(run().gate?.questions).toEqual(REAL_QUESTIONS)

    useMission.getState().answerGate(CONV, ["5175"])
    await waitFor(() => run()?.status === "done")
    await p
    expect(h.calls[1].prompt).toContain("R: 5175")
  })

  it("'agente' explícito sem perguntas: segue direto (sem gate, sem notice)", async () => {
    h.results = [ok(), ok()]
    h.handoffs = [gateHandoff([])]
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2" })], "agente"))
    await p
    expect(run().status).toBe("done")
    expect(notifyGate).not.toHaveBeenCalled()
    expect(notices().find((m) => m.includes("perguntas em aberto"))).toBeUndefined()
  })
})
