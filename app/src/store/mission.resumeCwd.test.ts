// MH1.4 — o caso residual do plano (MH4.3): missão ANTIGA, gravada na PASTA DO
// PROJETO antes do MH1.4 existir (a conversa nunca teve worktree). A retomada
// tem que respeitar o cwd antigo — run-state e handoffs moram lá — e NUNCA
// criar worktree no meio (mudaria o chão da missão e os artefatos ficariam
// órfãos). O missionWorktree.test.ts prova a guarda no helper; aqui se prova a
// COMPOSIÇÃO no launch: fases rodam no cwd antigo, conversa segue sem
// worktree, fio sem marco de isolamento.
//
// Modelado no mission.worktree.test.ts (runPhase e ensureMissionCwd mocados).

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult } from "@/lib/mission"
import type { EnsureMissionCwdResult } from "@/lib/missionWorktree"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import type { ChatItem, ConvState } from "./chat"

const h = vi.hoisted(() => ({
  cwds: [] as string[],
  ensureArgs: [] as {
    convId: string
    projectPath: string
    worktreePath: string | null
    resume: boolean
  }[],
}))

vi.mock("@/lib/mission", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/mission")>()
  return {
    ...mod,
    runPhase: vi.fn(async (args: import("@/lib/mission").RunPhaseArgs) => {
      h.cwds.push(args.cwd)
      return {
        ok: true,
        items: [],
        costUsd: 0,
        costSource: undefined,
      } satisfies PhaseResult
    }),
  }
})

vi.mock("@/lib/missionWorktree", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/missionWorktree")>()
  return {
    ...mod,
    // fiel ao contrato REAL provado no missionWorktree.test.ts: retomada nunca
    // cria — devolve o cwd que já existe (worktree da conversa ou projeto).
    ensureMissionCwd: vi.fn(
      async (args: {
        convId: string
        projectPath: string
        worktreePath: string | null
        resume: boolean
      }): Promise<EnsureMissionCwdResult> => {
        h.ensureArgs.push(args)
        return {
          ok: true,
          cwd: args.worktreePath ?? args.projectPath,
          created: false,
          fallback: false,
        }
      },
    ),
  }
})

vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, cancelAgent: vi.fn(async () => {}) }
})

import { useMission } from "./mission"
import { useChat } from "./chat"

const CONV = "c1"
const PROJ = "proj1"

const PHASE: MissionPhaseDef = {
  id: "build",
  label: "Executar",
  persona: "executor",
  agent: "claude-code",
  model: null,
  effort: null,
  maxRetries: 1,
}

const PRESET: MissionPreset = {
  id: "t",
  name: "Teste",
  phases: [PHASE],
  maxCostUsd: null,
}

function seedConv() {
  const conv: ConvState = {
    projectId: PROJ,
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null, // PRÉ-MH1.4: a conversa nunca foi isolada
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

function notices(): string[] {
  return (useChat.getState().byId[CONV]?.items ?? [])
    .filter((it) => it.kind === "notice")
    .map((it) => (it as Extract<ChatItem, { kind: "notice" }>).message)
}

beforeEach(() => {
  h.cwds = []
  h.ensureArgs = []
  vi.clearAllMocks()
  useMission.setState({ byConv: {}, interrupted: {} })
  seedConv()
})

describe("MH1.4 · retomada de missão PRÉ-MH1.4 (gravada na pasta do projeto)", () => {
  it("re-roda no cwd ANTIGO: sem worktree novo no meio, conversa intacta, fio sem marco de isolamento", async () => {
    // run-state como uma missão antiga deixou: dir sob a pasta do PROJETO.
    await useMission.getState().launch(
      CONV,
      PRESET,
      "tarefa antiga",
      PROJ,
      "/proj",
      "padrao",
      [],
      {
        version: 1,
        missionId: "m-old",
        dir: ".mycockpit/missions/m-old",
        convId: CONV,
        task: "tarefa antiga",
        preset: PRESET,
        current: 0,
        phases: [{ status: "running", costUsd: 0 }],
        costTotal: 0,
        maxCostUsd: null,
        gateDecisions: null,
        status: "running",
        updatedAt: 0,
      },
    )

    // o ensure viu a retomada SEM worktree — e a guarda (resume) não criou.
    expect(h.ensureArgs).toEqual([
      {
        convId: CONV,
        projectPath: "/proj",
        worktreePath: null,
        resume: true,
      },
    ])
    // a fase re-rodou no chão antigo (onde run-state e handoffs moram)...
    expect(h.cwds).toEqual(["/proj"])
    // ...a conversa NÃO foi religada num worktree que a missão não usou...
    expect(useChat.getState().byId[CONV].worktreePath).toBeNull()
    // ...e o fio não conta uma história de isolamento que não houve.
    expect(notices().some((m) => m.includes("isolada em worktree"))).toBe(false)
    expect(notices().some((m) => m.includes("worktree falhou"))).toBe(false)
    expect(useMission.getState().byConv[CONV].status).toBe("done")
  })
})
