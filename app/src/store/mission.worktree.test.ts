// MH1.4 no LAUNCH: sem worktree na conversa, a missão cria um ANTES de rodar
// (ensureMissionCwd) — o cwd das fases é o worktree novo, a conversa fica
// ligada nele (setWorktree) e o fio ganha o marco. Falha confirmada cai na
// pasta do projeto COM notice; recusa aborta o launch sem estado teatro
// (nenhum run "running" fica pra trás).
//
// Modelado no mission.history.test.ts: runPhase e ensureMissionCwd mocados.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult } from "@/lib/mission"
import type { EnsureMissionCwdResult } from "@/lib/missionWorktree"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import type { ChatItem, ConvState } from "./chat"

const h = vi.hoisted(() => ({
  results: [] as PhaseResult[],
  cwds: [] as string[],
  ensure: null as EnsureMissionCwdResult | null,
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

vi.mock("@/lib/missionWorktree", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/missionWorktree")>()
  return {
    ...mod,
    ensureMissionCwd: vi.fn(
      async (args: {
        convId: string
        projectPath: string
        worktreePath: string | null
        resume: boolean
      }) => {
        h.ensureArgs.push(args)
        return (
          h.ensure ?? {
            ok: true,
            cwd: args.worktreePath ?? args.projectPath,
            created: false,
            fallback: false,
          }
        )
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

const PRESET: MissionPreset = {
  id: "t",
  name: "Teste",
  phases: [phaseDef()],
  maxCostUsd: null,
}

const CONV = "c1"
const PROJ = "proj1"
const WT = "/proj/.mycockpit/worktrees/c1"

function seedConv(worktreePath: string | null = null) {
  const conv: ConvState = {
    projectId: PROJ,
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath,
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
          worktreePath,
          agent: "claude-code",
        },
      ],
    },
    byId: { [CONV]: conv },
  })
}

function launch(): Promise<void> {
  return useMission
    .getState()
    .launch(CONV, PRESET, "tarefa", PROJ, "/proj", "padrao")
}

function notices(): string[] {
  return (useChat.getState().byId[CONV]?.items ?? [])
    .filter((it) => it.kind === "notice")
    .map((it) => (it as Extract<ChatItem, { kind: "notice" }>).message)
}

beforeEach(() => {
  h.results = []
  h.cwds = []
  h.ensure = null
  h.ensureArgs = []
  vi.clearAllMocks()
  useMission.setState({ byConv: {} })
  seedConv()
})

describe("MH1.4 · launch cria o worktree que o modal promete", () => {
  it("worktree criado: vira o cwd das fases, liga na conversa e grava o marco no fio", async () => {
    h.ensure = {
      ok: true,
      cwd: WT,
      created: true,
      branch: "mycockpit/c1",
      fallback: false,
    }
    await launch()

    // o ensure recebeu a conversa SEM worktree (o gatilho da criação)
    expect(h.ensureArgs[0]).toEqual({
      convId: CONV,
      projectPath: "/proj",
      worktreePath: null,
      resume: false,
    })
    // TODAS as fases rodam no worktree novo, não na pasta do projeto
    expect(h.cwds).toEqual([WT])
    // a conversa ficou ligada no worktree (mesmo efeito do toggle da sidebar)
    expect(useChat.getState().byId[CONV].worktreePath).toBe(WT)
    // e o fio conta a verdade
    expect(
      notices().some((m) => m.includes("isolada em worktree")),
    ).toBe(true)
    expect(notices().some((m) => m.includes("mycockpit/c1"))).toBe(true)
  })

  it("conversa JÁ isolada: usa o worktree existente (nada muda)", async () => {
    seedConv(WT)
    await launch()
    expect(h.ensureArgs[0].worktreePath).toBe(WT)
    expect(h.cwds).toEqual([WT])
    expect(notices().some((m) => m.includes("isolada em worktree"))).toBe(false)
  })

  it("fallback confirmado: roda na pasta do projeto COM notice (nunca silencioso)", async () => {
    h.ensure = { ok: true, cwd: "/proj", created: false, fallback: true }
    await launch()

    expect(h.cwds).toEqual(["/proj"])
    expect(useChat.getState().byId[CONV].worktreePath).toBeNull()
    const aviso = notices().find((m) => m.includes("criação do worktree falhou"))
    expect(aviso).toBeTruthy()
    expect(aviso).toContain("pasta do projeto")
  })

  it("usuário recusou o fallback: a missão NÃO larga (sem run, sem fase, com notice)", async () => {
    h.ensure = { ok: false, cwd: "/proj", created: false, fallback: false }
    await launch()

    expect(useMission.getState().byConv[CONV]).toBeUndefined()
    expect(h.cwds).toEqual([]) // nenhuma fase rodou
    expect(
      notices().some((m) => m.includes("Missão não lançada")),
    ).toBe(true)
  })

  it("retomada passa resume=true pro ensure (que nunca cria worktree novo)", async () => {
    h.results = []
    // launch com resume direto (o resumeInterrupted delega pra cá)
    await useMission.getState().launch(
      CONV,
      PRESET,
      "tarefa",
      PROJ,
      "/proj",
      "padrao",
      [],
      {
        version: 1,
        missionId: "m-old",
        dir: ".mycockpit/missions/x",
        convId: CONV,
        task: "tarefa",
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
    expect(h.ensureArgs[0].resume).toBe(true)
  })
})
