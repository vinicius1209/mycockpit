import { beforeEach, describe, expect, it, vi } from "vitest"
import { recordTurnCost } from "@/lib/db"
import { useChat, type ConvState } from "./chat"

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>()
  return {
    ...original,
    isTauri: () => false,
    recordTurnCost: vi.fn(async () => {}),
  }
})
vi.mock("@/lib/db/conversations", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db/conversations")>()
  return {
    ...original,
    saveConversation: vi.fn(async () => {}),
  }
})

vi.mock("@/store/cards", () => ({
  useCards: {
    getState: () => ({ noteConversationAgent: vi.fn() }),
  },
}))

const CONV = "conv-transplant"

function sourceConv(): ConvState {
  return {
    projectId: "project",
    agent: "claude-code",
    reqModel: "claude-opus-5[1m]",
    effort: "high",
    worktreePath: null,
    items: [{ kind: "user", id: "u1", text: "continue" }],
    sessionId: "claude-session",
    model: "claude-opus-5[1m]",
    contextTokens: 42_000,
    streamingTextId: null,
    running: false,
    finalizing: false,
    runId: null,
    startedAt: null,
    suggestions: [],
    suggesting: false,
  }
}

beforeEach(() => {
  vi.mocked(recordTurnCost).mockClear()
  useChat.setState({
    projectId: "project",
    activeId: CONV,
    conversations: [],
    conversationsByProject: {},
    byId: { [CONV]: sourceConv() },
  })
})

describe("revezamento transacional", () => {
  it("mantém piloto e sessão de origem enquanto o destino apenas inicia", () => {
    useChat.getState().beginTransplant(CONV, "run-codex", "codex")

    const pending = useChat.getState().byId[CONV]
    expect(pending.agent).toBe("claude-code")
    expect(pending.sessionId).toBe("claude-session")
    expect(pending.model).toBe("claude-opus-5[1m]")
    expect(pending.contextTokens).toBe(42_000)
    expect(pending.pendingTransplant).toEqual({
      runId: "run-codex",
      targetAgent: "codex",
    })
    expect(pending.running).toBe(true)
  })

  it("falha antes da sessão descarta a intenção e preserva a origem retomável", () => {
    const chat = useChat.getState()
    chat.beginTransplant(CONV, "run-codex", "codex", {
      model: null,
      effort: null,
      commitNotice: "Revezamento confirmado",
    })
    chat.handleEvent(CONV, {
      type: "error",
      message: "Não foi possível iniciar o Codex: configuração MCP inválida",
    })
    chat.finish(CONV)

    const failed = useChat.getState().byId[CONV]
    expect(failed.agent).toBe("claude-code")
    expect(failed.sessionId).toBe("claude-session")
    expect(failed.model).toBe("claude-opus-5[1m]")
    expect(failed.contextTokens).toBe(42_000)
    expect(failed.pendingTransplant).toBeUndefined()
    expect(failed.items.at(-1)).toMatchObject({ kind: "error" })
    expect(failed.items).not.toContainEqual(
      expect.objectContaining({
        kind: "notice",
        message: "Revezamento confirmado",
      }),
    )
  })

  it("confirma o novo piloto somente quando o destino emite session", () => {
    const chat = useChat.getState()
    chat.beginTransplant(CONV, "run-codex", "codex", {
      model: null,
      effort: null,
      commitNotice: "Revezamento confirmado",
    })
    expect(useChat.getState().byId[CONV].items).not.toContainEqual(
      expect.objectContaining({
        kind: "notice",
        message: "Revezamento confirmado",
      }),
    )
    chat.handleEvent(CONV, {
      type: "session",
      session_id: "codex-thread",
      model: "gpt-5.6-sol",
      tools: 3,
    })

    const committed = useChat.getState().byId[CONV]
    expect(committed.agent).toBe("codex")
    expect(committed.sessionId).toBe("codex-thread")
    expect(committed.model).toBe("gpt-5.6-sol")
    expect(committed.reqModel).toBeNull()
    expect(committed.effort).toBeNull()
    expect(committed.contextTokens).toBeUndefined()
    expect(committed.pendingTransplant).toBeUndefined()
    expect(committed.items).toContainEqual(
      expect.objectContaining({
        kind: "notice",
        message: "Revezamento confirmado",
      }),
    )
  })

  it("mantém modelo da origem fora da telemetria do destino pré-sessão", () => {
    const chat = useChat.getState()
    chat.beginTransplant(CONV, "run-codex", "codex")
    chat.handleEvent(CONV, {
      type: "result",
      ok: false,
      text: null,
      cost_usd: 1.25,
      cost_source: "reported",
      input_tokens: 100,
      output_tokens: 20,
      cache_read: 0,
      cache_creation: 0,
    })

    expect(recordTurnCost).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "codex", model: null }),
    )
    expect(useChat.getState().byId[CONV].items.at(-1)).toMatchObject({
      kind: "result",
      model: null,
    })
    expect(useChat.getState().byId[CONV].model).toBe("claude-opus-5[1m]")
  })

  it("torna a troca de piloto transacional e confirma modelo pedido no session", () => {
    const chat = useChat.getState()
    chat.beginTransplant(CONV, "run-wheel", "codex", {
      model: "gpt-5.6-sol",
      effort: "high",
      user: { text: "assuma daqui", attachments: [] },
    })

    const pending = useChat.getState().byId[CONV]
    expect(pending.agent).toBe("claude-code")
    expect(pending.sessionId).toBe("claude-session")
    expect(pending.model).toBe("claude-opus-5[1m]")
    expect(pending.items.at(-1)).toMatchObject({
      kind: "user",
      text: "assuma daqui",
    })

    chat.handleEvent(CONV, {
      type: "session",
      session_id: "codex-thread",
      model: "gpt-5.6-sol-20260801",
      tools: 3,
    })

    const committed = useChat.getState().byId[CONV]
    expect(committed.agent).toBe("codex")
    expect(committed.reqModel).toBe("gpt-5.6-sol")
    expect(committed.effort).toBe("high")
    expect(committed.sessionId).toBe("codex-thread")
    expect(committed.model).toBe("gpt-5.6-sol-20260801")
  })
})
