// Ressalva do gate MH1+MH2 — teto furado NA ÚLTIMA fase: o checkBudget é gate
// de fase NOVA, então depois da última fase ninguém checava e a missão fechava
// "done" com costTotal > teto em SILÊNCIO. O desfecho não muda (o gasto já
// ocorreu e o trabalho foi entregue); o que entra é o REGISTRO honesto: notice
// no fio com o custo final vs o teto.
//
// Modelado no mission.review.test.ts (conversa semeada pro fio; só runPhase
// mocado).

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult } from "@/lib/mission"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"

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

import { useMission } from "./mission"
import { useChat, type ChatItem, type ConvState } from "./chat"

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
  maxCostUsd: number | null,
): MissionPreset {
  return { id: "t", name: "Teste", phases, maxCostUsd }
}

function ok(costUsd = 0): PhaseResult {
  return { ok: true, items: [], costUsd, costSource: undefined }
}

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
  useMission.setState({ byConv: {} })
  seedConv()
})

describe("teto furado na ÚLTIMA fase: done com registro honesto, nunca silêncio", () => {
  it("custo final acima do teto → missão segue done, mas o fio ganha o notice do estouro", async () => {
    // teto 1.0; a fase 2 entra com 0.6 (< teto, o gate de fase deixa passar)
    // e termina com o total em 1.3 — depois dela não havia mais check nenhum.
    h.results = [ok(0.6), ok(0.7)]
    await launch(preset([phaseDef(), phaseDef({ id: "p2" })], 1.0))

    const r = run()
    expect(r.status).toBe("done") // o desfecho NÃO muda (o gasto já ocorreu)
    expect(r.costTotal).toBeCloseTo(1.3, 5)
    const aviso = notices().find((m) => m.includes("passou o teto"))
    expect(aviso).toBeTruthy()
    expect(aviso).toContain("US$ 1.30")
    expect(aviso).toContain("US$ 1.00")
  })

  it("custo final DENTRO do teto → nenhum aviso falso", async () => {
    h.results = [ok(0.3), ok(0.4)]
    await launch(preset([phaseDef(), phaseDef({ id: "p2" })], 1.0))

    expect(run().status).toBe("done")
    expect(notices().some((m) => m.includes("passou o teto"))).toBe(false)
  })

  it("sem teto (null) → nenhum aviso (não há o que furar)", async () => {
    h.results = [ok(5)]
    await launch(preset([phaseDef()], null))

    expect(run().status).toBe("done")
    expect(notices().some((m) => m.includes("passou o teto"))).toBe(false)
  })
})
