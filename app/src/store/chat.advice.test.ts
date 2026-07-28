// Especialistas E1 — ações do parecer no store do chat: "Trazer pro Executor"
// (enfileira o bloco p/ o próximo turno) e "Dispensar" (remove o item). Mocks no
// padrão da casa (sonner/notify/agent não vazam pro Tauri).

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))
vi.mock("@/lib/notify", () => ({
  notifyTurnStalled: vi.fn(),
  notifyCardStalled: vi.fn(),
  notifyUnattendedTimeout: vi.fn(),
  notifyApproval: vi.fn(),
  notifyQuestion: vi.fn(),
  nativeNotify: vi.fn(async () => {}),
}))
vi.mock("@/lib/agent", async (io) => ({
  ...(await io<typeof import("@/lib/agent")>()),
  cancelAgent: vi.fn(async () => {}),
  suggest: vi.fn(async () => ""),
}))

import {
  useChat,
  executorItems,
  hasExecutorTurn,
  type ChatItem,
  type ConvState,
} from "@/store/chat"

const T0 = 1_700_000_000_000

function conv(over: Partial<ConvState> = {}): ConvState {
  return {
    projectId: "p1",
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
    startedAt: T0,
    suggestions: [],
    suggesting: false,
    ...over,
  }
}

function advice(id: string): Extract<ChatItem, { kind: "advice" }> {
  return {
    kind: "advice",
    id,
    personaId: "projeto:aline",
    personaName: "Aline",
    personaVersion: 2,
    digest: "deadbeef",
    question: "tem risco?",
    text: "use bcrypt",
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useChat.setState({ byId: {} })
})

describe("Trazer pro Executor (bring/take)", () => {
  it("enfileira o bloco e o consome UMA vez no próximo turno", () => {
    useChat.setState({ byId: { c1: conv() } })
    useChat.getState().bringAdviceToExecutor("c1", "BLOCO-A")
    expect(useChat.getState().byId.c1.pendingAdvice).toBe("BLOCO-A")

    const taken = useChat.getState().takePendingAdvice("c1")
    expect(taken).toBe("BLOCO-A")
    // consumido: o próximo turno não repete o parecer.
    expect(useChat.getState().byId.c1.pendingAdvice).toBeUndefined()
    expect(useChat.getState().takePendingAdvice("c1")).toBeNull()
  })

  it("acumula quando mais de um parecer é trazido", () => {
    useChat.setState({ byId: { c1: conv() } })
    useChat.getState().bringAdviceToExecutor("c1", "BLOCO-A")
    useChat.getState().bringAdviceToExecutor("c1", "BLOCO-B")
    expect(useChat.getState().takePendingAdvice("c1")).toBe("BLOCO-A\n\nBLOCO-B")
  })
})

describe("Dispensar (dismissAdvice)", () => {
  it("remove só o item de parecer do fio", () => {
    const user: ChatItem = { kind: "user", id: "u1", text: "oi" }
    useChat.setState({ byId: { c1: conv({ items: [user, advice("a1")] }) } })
    useChat.getState().dismissAdvice("c1", "a1")
    const items = useChat.getState().byId.c1.items
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe("u1")
  })
})

describe("executorItems / hasExecutorTurn (fonte única do 1º turno)", () => {
  const user: ChatItem = { kind: "user", id: "u1", text: "oi" }

  it("um parecer (advice) NÃO conta como turno de executor", () => {
    expect(hasExecutorTurn([advice("a1")])).toBe(false)
    expect(executorItems([advice("a1")])).toHaveLength(0)
  })

  it("conversa vazia também não tem turno de executor", () => {
    expect(hasExecutorTurn([])).toBe(false)
  })

  it("com um item do usuário/executor → tem turno", () => {
    expect(hasExecutorTurn([advice("a1"), user])).toBe(true)
    expect(executorItems([advice("a1"), user])).toEqual([user])
  })
})

describe("advice antes do 1º turno NÃO trava a identidade (setConversationAgent)", () => {
  it("com só um parecer no fio, ainda dá pra escolher o agent do 1º turno", () => {
    useChat.setState({
      byId: { c1: conv({ agent: "claude-code", items: [advice("a1")] }) },
    })
    useChat.getState().setConversationAgent("c1", "codex")
    // não travou: a seleção de identidade valeu, pois advice não é turno.
    expect(useChat.getState().byId.c1.agent).toBe("codex")
  })

  it("com um turno de executor no fio, a identidade TRAVA (no-op)", () => {
    const user: ChatItem = { kind: "user", id: "u1", text: "roda" }
    useChat.setState({
      byId: { c1: conv({ agent: "claude-code", items: [advice("a1"), user] }) },
    })
    useChat.getState().setConversationAgent("c1", "codex")
    expect(useChat.getState().byId.c1.agent).toBe("claude-code")
  })
})

describe("indicador de consulta (setAdvising)", () => {
  it("marca e limpa a persona em consulta", () => {
    useChat.setState({ byId: { c1: conv() } })
    useChat.getState().setAdvising("c1", { id: "aline", name: "Aline" })
    expect(useChat.getState().byId.c1.advising).toEqual({
      id: "aline",
      name: "Aline",
    })
    useChat.getState().setAdvising("c1", null)
    expect(useChat.getState().byId.c1.advising).toBeNull()
  })
})
