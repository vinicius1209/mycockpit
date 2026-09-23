import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const chat = {
    byId: {} as Record<string, Record<string, unknown>>,
    beginPreparation: vi.fn((convId: string, runId: string) => {
      const conv = chat.byId[convId]
      if (conv) conv.preparing = { runId }
    }),
    clearPreparation: vi.fn((convId: string, runId: string) => {
      const conv = chat.byId[convId]
      const preparing = conv?.preparing as { runId?: string } | undefined
      if (conv && preparing?.runId === runId) delete conv.preparing
    }),
    cancelAutoResume: vi.fn(),
    invalidateSuggestions: vi.fn(),
    blockPreparation: vi.fn(),
    beginTransplant: vi.fn(),
    handleEvent: vi.fn(),
    recordInjectedFingerprint: vi.fn(),
    finish: vi.fn(),
    persist: vi.fn(async () => {}),
    scheduleSuggestions: vi.fn(),
  }

  return {
    chat,
    order: [] as string[],
    runAgent: vi.fn(),
    expandPendingForTarget: vi.fn(),
    prepareHybridHandoff: vi.fn(),
    markLessonsUsed: vi.fn(async () => {}),
    notifyTurnEnd: vi.fn(async () => {}),
    toastError: vi.fn(),
  }
})

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }))
vi.mock("@/lib/agent", () => ({
  agentLabel: (agent: string) => agent,
  runAgent: mocks.runAgent,
}))
vi.mock("@/lib/agents", () => ({
  agentDef: () => ({ systemChannel: false }),
  dispatchBlockReason: () => null,
}))
vi.mock("@/lib/doctrine", () => ({
  blocoDaDoutrina: () => "doutrina",
  doctrineFingerprint: () => "fp-doutrina",
  readDoctrine: async () => ({ content: "regra" }),
}))
vi.mock("@/lib/handoff", () => ({
  prepareHybridHandoff: mocks.prepareHybridHandoff,
}))
vi.mock("@/lib/learning", () => ({
  buildLearningBlocks: async () => ({
    lessons: "lições",
    lessonIds: ["lesson-1"],
  }),
  markLessonsUsed: mocks.markLessonsUsed,
}))
vi.mock("@/lib/notify", () => ({ notifyTurnEnd: mocks.notifyTurnEnd }))
vi.mock("@/lib/presets", () => ({ personaHandoffBlock: async () => null }))
vi.mock("@/lib/sessionMode", () => ({
  modoEfetivoDoSpawn: () => "default",
  permissaoDoSpawn: () => "default",
}))
vi.mock("@/lib/slashCommands", () => ({
  expandPendingForTarget: mocks.expandPendingForTarget,
}))
vi.mock("@/store/app", () => ({
  useApp: { getState: () => ({ settings: { detected: {} } }) },
}))
vi.mock("@/store/chat", () => ({
  useChat: { getState: () => mocks.chat },
}))

import { continueConversationWith } from "@/lib/chatHandoff"

const CONV = "conv-handoff"

function sourceConversation() {
  return {
    projectId: "project",
    agent: "codex",
    presetId: null,
    presetDigest: null,
    worktreePath: null,
    items: [
      {
        id: "u-executor",
        kind: "user",
        text: "Conclua a implementação",
        attachments: [{ kind: "image", path: "/tmp/evidence.png" }],
      },
      { id: "limit", kind: "limit", message: "Limite atingido" },
      {
        id: "u-advisor",
        kind: "user",
        text: "O que você acha?",
        advisorTo: { id: "reviewer", name: "Revisor" },
      },
    ],
    running: false,
    finalizing: false,
    runId: null,
    corrupt: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.order.length = 0
  mocks.chat.byId = { [CONV]: sourceConversation() }
  mocks.chat.beginPreparation.mockImplementation((convId, runId) => {
    mocks.order.push("preparing")
    const conv = mocks.chat.byId[convId]
    if (conv) conv.preparing = { runId }
  })
  mocks.expandPendingForTarget.mockResolvedValue({
    text: "Conclua a implementação",
    note: null,
    instructionSources: [],
  })
  mocks.prepareHybridHandoff.mockResolvedValue({
    prompt: "contexto compacto",
    paths: { transcript: "transcript.md", manifest: "handoff.json" },
  })
  mocks.runAgent.mockResolvedValue(undefined)
})

describe("continuação imediata entre agentes", () => {
  it("marca o preparo antes do primeiro await e limpa se ele falhar", async () => {
    mocks.expandPendingForTarget.mockImplementation(async () => {
      mocks.order.push("primeiro-await")
      throw new Error("falha de expansão")
    })

    await continueConversationWith({
      convId: CONV,
      projectId: "project",
      projectPath: "/repo",
      permissionMode: null,
      target: "agy",
      recordLessons: vi.fn(),
      onPrepared: () => mocks.order.push("feedback"),
    })

    expect(mocks.order).toEqual(["preparing", "feedback", "primeiro-await"])
    expect(mocks.chat.clearPreparation).toHaveBeenCalledOnce()
    expect(mocks.runAgent).not.toHaveBeenCalled()
  })

  it("retoma o pedido do executor com seus anexos, nunca a pergunta ao especialista", async () => {
    const recordLessons = vi.fn()
    mocks.runAgent.mockImplementation(async (...args: unknown[]) => {
      const onEvent = args[10] as (event: { type: string; manifest?: object }) => void
      onEvent({ type: "run_manifest", manifest: {} })
    })

    await continueConversationWith({
      convId: CONV,
      projectId: "project",
      projectPath: "/repo",
      permissionMode: null,
      target: "agy",
      recordLessons,
      onPrepared: vi.fn(),
    })

    expect(mocks.prepareHybridHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingUserIndex: 0,
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "u-executor",
            text: "Conclua a implementação",
          }),
        ]),
      }),
    )
    expect(mocks.runAgent.mock.calls[0]?.[9]).toEqual([
      { kind: "image", path: "/tmp/evidence.png" },
    ])
    expect(mocks.runAgent.mock.calls[0]?.[5]).toBe("contexto compacto")
    expect(recordLessons).toHaveBeenCalledWith(["lesson-1"])
    expect(mocks.markLessonsUsed).toHaveBeenCalledWith(["lesson-1"])
    expect(mocks.chat.beginTransplant).toHaveBeenCalledWith(
      CONV,
      expect.any(String),
      "agy",
    )
  })
})
