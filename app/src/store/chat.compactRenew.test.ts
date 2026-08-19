// /compactar em motor SEM compactação nativa: transplante PARA SI MESMO na
// máquina do revezamento (lib/compact → beginTransplant + commit no `session`).
// O que este teste trava: o fio (items) continua o MESMO, só o sessionId
// renova — e falha antes do `session` novo deixa a sessão de origem intacta
// (nada de "sessão renovada" falsa). Scaffolding espelha chat.transplant.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest"
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

const CONV = "conv-compact-renew"

function codexConv(): ConvState {
  return {
    projectId: "project",
    agent: "codex",
    reqModel: "gpt-5.6-sol",
    effort: "high",
    worktreePath: null,
    items: [
      { kind: "user", id: "u1", text: "implementa o login" },
      { kind: "text", id: "t1", text: "Implementado; testes verdes." },
    ],
    sessionId: "thread-antiga",
    model: "gpt-5.6-sol-20260801",
    contextTokens: 210_000,
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
  useChat.setState({
    projectId: "project",
    activeId: CONV,
    conversations: [],
    conversationsByProject: {},
    byId: { [CONV]: codexConv() },
  })
})

describe("transplante para si mesmo (/compactar sem compactação nativa)", () => {
  it("preserva TODOS os items do fio e renova o sessionId no `session` novo", () => {
    const chat = useChat.getState()
    chat.beginTransplant(CONV, "run-compact", "codex", {
      model: "gpt-5.6-sol",
      effort: "high",
      user: { text: "/compactar", attachments: [] },
    })

    // duas fases: antes do `session`, a sessão de ORIGEM é a verdade.
    const pending = useChat.getState().byId[CONV]
    expect(pending.agent).toBe("codex")
    expect(pending.sessionId).toBe("thread-antiga")
    expect(pending.items.map((i) => i.id)).toEqual(["u1", "t1", pending.items[2].id])
    expect(pending.items.at(-1)).toMatchObject({
      kind: "user",
      text: "/compactar",
    })

    chat.handleEvent(CONV, {
      type: "session",
      session_id: "thread-renovada",
      model: "gpt-5.6-sol-20260801",
      tools: 3,
    })

    const renewed = useChat.getState().byId[CONV]
    // MESMO motor, MESMA conversa: só a sessão nativa mudou.
    expect(renewed.agent).toBe("codex")
    expect(renewed.sessionId).toBe("thread-renovada")
    expect(renewed.reqModel).toBe("gpt-5.6-sol")
    expect(renewed.effort).toBe("high")
    // o fio continua inteiro (o transplante não recorta histórico).
    expect(renewed.items.slice(0, 2).map((i) => i.id)).toEqual(["u1", "t1"])
    // o anel zera: o footprint da sessão antiga não vale pra nova.
    expect(renewed.contextTokens).toBeUndefined()
    expect(renewed.pendingTransplant).toBeUndefined()
  })

  it("falha ANTES do `session` novo descarta a intenção: sessão antiga intacta e retomável", () => {
    const chat = useChat.getState()
    chat.beginTransplant(CONV, "run-compact", "codex", {
      model: "gpt-5.6-sol",
      effort: "high",
      user: { text: "/compactar", attachments: [] },
    })
    chat.handleEvent(CONV, {
      type: "error",
      message: "Falha ao renovar a sessão",
    })
    chat.finish(CONV)

    const failed = useChat.getState().byId[CONV]
    expect(failed.sessionId).toBe("thread-antiga")
    expect(failed.contextTokens).toBe(210_000)
    expect(failed.pendingTransplant).toBeUndefined()
    expect(failed.items.at(-1)).toMatchObject({ kind: "error" })
  })
})
