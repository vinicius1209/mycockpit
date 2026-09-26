// Especialistas E1 — ações do parecer no store do chat: "Trazer pro Executor"
// (enfileira o bloco p/ o próximo turno) e "Dispensar" (remove o item). Mocks no
// padrão da casa (sonner/notify/agent não vazam pro Tauri).

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/avisos", async () => (await import("@/test/avisosFalsos")).moduloDeAvisosFalsos())
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

// "Trazer pro Executor" deixou de morar na conversa em 21/09/2026: virou bloco
// do rascunho (pílula visível, removível e persistida). O comportamento tem
// teste em `lib/parecerTrazido.test.ts` e em `store/composerDrafts` — aqui
// sobrou o que é mesmo do fio.

describe("Dispensar (removeThreadItem)", () => {
  it("remove só o item de parecer do fio", () => {
    const user: ChatItem = { kind: "user", id: "u1", text: "oi" }
    useChat.setState({ byId: { c1: conv({ items: [user, advice("a1")] }) } })
    useChat.getState().removeThreadItem("c1", "a1")
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

  it("a fala que PEDIU o parecer também não é turno de executor", () => {
    // a consulta inteira é lateral: a pergunta endereçada à persona + o parecer.
    // Se a pergunta contasse, o 1º envio de verdade nasceria "travado" e perderia
    // a injeção de persona/doutrina do turno-1.
    const pergunta: ChatItem = {
      kind: "user",
      id: "u0",
      text: "@aline revisa isso",
      advisorTo: { id: "projeto:aline", name: "Aline" },
    }
    expect(hasExecutorTurn([pergunta, advice("a1")])).toBe(false)
    expect(executorItems([pergunta, advice("a1")])).toHaveLength(0)
    // e o envio seguinte, esse sim pro piloto, abre o turno de executor
    expect(hasExecutorTurn([pergunta, advice("a1"), user])).toBe(true)
    expect(executorItems([pergunta, advice("a1"), user])).toEqual([user])
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

  it("a consulta COMPLETA (pergunta + parecer) também não trava a identidade", () => {
    const pergunta: ChatItem = {
      kind: "user",
      id: "u0",
      text: "@aline revisa isso",
      advisorTo: { id: "projeto:aline", name: "Aline" },
    }
    useChat.setState({
      byId: {
        c1: conv({ agent: "claude-code", items: [pergunta, advice("a1")] }),
      },
    })
    useChat.getState().setConversationAgent("c1", "codex")
    expect(useChat.getState().byId.c1.agent).toBe("codex")
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
