// G2.1 (capability-registry-plan) — o campo de tarefa do Fusion expande
// `/comando` POR CANDIDATO: cada lane pode rodar num motor diferente, e a
// semântica (cru nativo × corpo expandido) vem do REGISTRY do agent efetivo da
// lane, nunca de comparação de nome. Com preâmbulo/doutrina o pedido viaja
// EMBUTIDO — aí até o comando nativo precisa do corpo.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SlashCommand } from "@/lib/sources"

vi.mock("@/lib/agent", () => ({
  runAgent: vi.fn(async () => {}),
  cancelAgent: vi.fn(async () => {}),
  suggest: vi.fn(async () => []),
}))

vi.mock("@/lib/sources", () => ({
  readProjectCommands: vi.fn(async () => []),
}))

vi.mock("@/lib/db", () => ({
  isTauri: () => false,
  saveConversation: vi.fn(async () => {}),
  saveFusionRun: vi.fn(async () => {}),
  loadPendingFusion: vi.fn(async () => null),
  clearPendingFusion: vi.fn(async () => {}),
  recordTurnCost: vi.fn(async () => {}),
}))

vi.mock("@/lib/doctrine", () => ({
  readDoctrine: vi.fn(async () => ({ exists: false, content: "", bytes: 0 })),
  buildDoctrineBlock: (content: string) =>
    content ? `## Regras do projeto\n\n${content}` : null,
}))

// juiz mockado: a disputa dos testes termina sem gastar num run de verdade.
vi.mock("@/lib/fusion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fusion")>()),
  runJudge: vi.fn(async () => ({
    judge: {
      status: "unavailable" as const,
      suggestedId: null,
      rationale: null,
      agreement: null,
      runnerupId: null,
      passes: [],
      notes: {},
    },
    cost: 0,
  })),
}))

import { runAgent } from "@/lib/agent"
import { readProjectCommands } from "@/lib/sources"
import { readDoctrine } from "@/lib/doctrine"
import { useFusion, type LeagueConfig } from "./fusion"

/** Inventário POR MOTOR (o read_project_commands real é por-agent): o claude
 *  enxerga o comando de fonte claude, o codex o de fonte codex. */
function inventarioPorAgent(agent: string): SlashCommand[] {
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
}

const LIGA: LeagueConfig = {
  scope: "read-only",
  judgeModel: "sonnet",
  candidates: [
    { agent: "claude-code", model: null, effort: null },
    { agent: "codex", model: null, effort: null },
  ],
}

function promptsPorAgent(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const call of vi.mocked(runAgent).mock.calls) {
    // runAgent(runId, convId, agent, model, effort, prompt, …)
    out[call[2] as string] = call[5] as string
  }
  return out
}

beforeEach(() => {
  vi.mocked(runAgent).mockClear()
  vi.mocked(readProjectCommands).mockImplementation(async (_path, agent) =>
    inventarioPorAgent(agent as string),
  )
  useFusion.setState({ byConv: {} })
})

describe("Fusion — expansão de /comando por candidato (G2.1)", () => {
  it("com doutrina (pedido embutido), CADA lane recebe o corpo do SEU inventário", async () => {
    vi.mocked(readDoctrine).mockResolvedValue({
      exists: true,
      content: "fale pt-BR",
      bytes: 10,
    })
    await useFusion
      .getState()
      .launch("conv-f1", LIGA, "/deploy prod", [], "/repo", "padrao")

    const prompts = promptsPorAgent()
    expect(Object.keys(prompts)).toHaveLength(2)
    // embutido atrás da doutrina: nem o claude (native_slash) viaja cru.
    expect(prompts["claude-code"]).toContain("corpo claude: deploy de prod")
    expect(prompts["claude-code"]).not.toContain("/deploy")
    expect(prompts["codex"]).toContain("corpo codex: deploy de prod")
    expect(prompts["codex"]).not.toContain("/deploy")
    for (const p of Object.values(prompts)) {
      expect(p.startsWith("## Regras do projeto")).toBe(true)
    }
  })

  it("sem preâmbulo/doutrina, a lane com native_slash manda cru e a outra expande", async () => {
    vi.mocked(readDoctrine).mockResolvedValue({ exists: false, content: "", bytes: 0 })
    await useFusion
      .getState()
      .launch("conv-f2", LIGA, "/deploy prod", [], "/repo", "padrao")

    const prompts = promptsPorAgent()
    // decisão vem do registry (nativeSlash), não do nome no código do store.
    expect(prompts["claude-code"]).toBe("/deploy prod")
    expect(prompts["codex"]).toBe("corpo codex: deploy de prod")
  })

  it("sem match no inventário, o texto segue intacto em todas as lanes (fail-open)", async () => {
    vi.mocked(readDoctrine).mockResolvedValue({ exists: false, content: "", bytes: 0 })
    await useFusion
      .getState()
      .launch("conv-f3", LIGA, "/inexistente agora", [], "/repo", "padrao")

    const prompts = promptsPorAgent()
    expect(prompts["claude-code"]).toBe("/inexistente agora")
    expect(prompts["codex"]).toBe("/inexistente agora")
  })
})
