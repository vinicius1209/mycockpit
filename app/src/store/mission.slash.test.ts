// G2.1 (capability-registry-plan, correção 2 do review gate) — wiring do
// launcher de Missão: `/comando` digitado no campo de tarefa expande pro MOTOR
// de CADA fase (inventário por-agent, lido do cwd da missão), sempre EMBUTIDO
// (a task viaja dentro do prompt da fase, barra crua seria texto morto). O fio
// guarda a task DIGITADA — a expansão é só do prompt. Scaffolding no padrão do
// mission.history.test.ts: só runPhase, readHandoff, cancelAgent e o
// inventário de comandos são mocados.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult, RunPhaseArgs } from "@/lib/mission"
import type { HandoffDoc } from "@/lib/missionHandoff"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import type { SlashCommand } from "@/lib/sources"

const h = vi.hoisted(() => ({
  results: [] as PhaseResult[],
  handoffs: [] as (HandoffDoc | null)[],
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

// Inventário "/" POR AGENT (o read_project_commands real é por-agent): cada
// fase da missão enxerga só as fontes do SEU motor + a casa. Mock PARCIAL: o
// resto do módulo segue real (outros pontos do fluxo podem usá-lo).
vi.mock("@/lib/sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources")>()),
  readProjectCommands: vi.fn(
    async (_path: string, agent: string): Promise<SlashCommand[]> => {
      if (agent === "claude-code") {
        return [
          {
            name: "deploy",
            description: null,
            kind: "command",
            origin: "project",
            source: "claude",
            body: "corpo claude: deploy de $ARGUMENTS",
          },
        ]
      }
      if (agent === "codex") {
        return [
          {
            name: "deploy",
            description: null,
            kind: "command",
            origin: "project",
            source: "codex",
            body: "corpo codex: deploy de $ARGUMENTS",
          },
        ]
      }
      return []
    },
  ),
}))

import { runPhase } from "@/lib/mission"
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

function preset(phases: MissionPhaseDef[]): MissionPreset {
  return { id: "t", name: "Teste", phases, maxCostUsd: null }
}

function ok(): PhaseResult {
  return { ok: true, items: [], costUsd: 0, costSource: undefined }
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

function launch(pre: MissionPreset, task: string): Promise<void> {
  return useMission.getState().launch(CONV, pre, task, PROJ, "/tmp/proj", "padrao")
}

function phasePrompts(): { agent: string; prompt: string }[] {
  return vi.mocked(runPhase).mock.calls.map((c) => {
    const args = c[0] as RunPhaseArgs
    return { agent: args.agent, prompt: args.prompt }
  })
}

beforeEach(() => {
  vi.mocked(runPhase).mockClear()
  h.results = []
  h.handoffs = []
  useMission.setState({ byConv: {}, interrupted: {} })
  seedConv()
})

describe("Missão — /comando no campo de tarefa expande por fase (G2.1)", () => {
  it("cada fase recebe o corpo do inventário do SEU motor (nunca a barra crua)", async () => {
    h.results = [ok(), ok()]
    await launch(
      preset([
        phaseDef({ id: "plan", label: "Planejar", persona: "planner", agent: "claude-code" }),
        phaseDef({ id: "exec", label: "Executar", agent: "codex" }),
      ]),
      "/deploy prod",
    )

    const calls = phasePrompts()
    expect(calls).toHaveLength(2)
    // fase 1 (claude): embutido no prompt da fase → corpo, mesmo sendo nativo.
    expect(calls[0].agent).toBe("claude-code")
    expect(calls[0].prompt).toContain("corpo claude: deploy de prod")
    expect(calls[0].prompt).not.toContain("/deploy")
    // fase 2 (codex): o corpo vem do inventário DELE, não do da fase anterior.
    expect(calls[1].agent).toBe("codex")
    expect(calls[1].prompt).toContain("corpo codex: deploy de prod")
    expect(calls[1].prompt).not.toContain("/deploy")
  })

  it("o fio guarda a task DIGITADA (a expansão é só do prompt)", async () => {
    h.results = [ok()]
    await launch(preset([phaseDef()]), "/deploy prod")
    const user = (useChat.getState().byId[CONV]?.items ?? []).find(
      (it): it is Extract<ChatItem, { kind: "user" }> => it.kind === "user",
    )
    expect(user?.text).toBe("/deploy prod")
  })

  it("task sem match segue como texto em toda fase (fail-open)", async () => {
    h.results = [ok()]
    await launch(preset([phaseDef({ agent: "codex" })]), "/fantasma agora")
    expect(phasePrompts()[0].prompt).toContain("/fantasma agora")
  })

  it("task comum não toca no inventário nem muda o prompt", async () => {
    h.results = [ok()]
    await launch(preset([phaseDef()]), "conserta o build")
    expect(phasePrompts()[0].prompt).toContain("conserta o build")
  })
})
