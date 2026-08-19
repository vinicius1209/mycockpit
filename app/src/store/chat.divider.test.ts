// S1.1 — divisor "novas mensagens": ao ABRIR uma conversa que terminou sem
// você ver (finishedUnseen), a fronteira do não-visto é capturada ANTES do
// markSeen apagar o selo e vira o divisor da visita. Ele morre ao trocar de
// conversa ou ao enviar um turno novo (agir É reconhecer).
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useChat, type ChatItem, type ConvState } from "./chat"

vi.mock("@/lib/db", () => ({
  isTauri: () => false,
}))
vi.mock("@/lib/db/conversations", () => ({
  listConversations: vi.fn(async () => null),
  loadConversation: vi.fn(async () => null),
  saveConversation: vi.fn(async () => {}),
  persistConversationOrder: vi.fn(async () => {}),
}))

function conv(patch: Partial<ConvState> = {}): ConvState {
  return {
    projectId: "px",
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
    startedAt: 0,
    suggestions: [],
    suggesting: false,
    ...patch,
  }
}

const pedido: ChatItem = { kind: "user", id: "u1", text: "faz aí" } as ChatItem
const resposta: ChatItem = { kind: "text", id: "t1", text: "feito" } as ChatItem

beforeEach(() => {
  useChat.setState({
    activeId: null,
    projectId: null,
    conversations: [],
    conversationsByProject: {},
    byId: {},
  })
})

describe("switchConversation → divisor 'novas mensagens'", () => {
  it("abrir conversa com selo captura a fronteira (e o selo sai)", async () => {
    useChat.setState({
      activeId: "outra",
      byId: {
        outra: conv(),
        c1: conv({ finishedUnseen: "ok", items: [pedido, resposta] }),
      },
    })
    await useChat.getState().switchConversation("c1")
    const c1 = useChat.getState().byId.c1
    expect(c1.unseenDividerId).toBe("t1") // primeiro item DEPOIS da sua mensagem
    expect(c1.finishedUnseen).toBeUndefined() // o selo cumpriu o papel
  })

  it("abrir conversa SEM selo não inventa divisor", async () => {
    useChat.setState({
      activeId: "outra",
      byId: { outra: conv(), c1: conv({ items: [pedido, resposta] }) },
    })
    await useChat.getState().switchConversation("c1")
    expect(useChat.getState().byId.c1.unseenDividerId).toBeUndefined()
  })

  it("trocar de conversa encerra a visita: o divisor da anterior morre", async () => {
    useChat.setState({
      activeId: "c1",
      byId: {
        c1: conv({ unseenDividerId: "t1", items: [pedido, resposta] }),
        c2: conv(),
      },
    })
    await useChat.getState().switchConversation("c2")
    expect(useChat.getState().byId.c1.unseenDividerId).toBeUndefined()
  })

  it("enviar um turno novo limpa o divisor (agir É reconhecer)", () => {
    useChat.setState({
      activeId: "c1",
      byId: { c1: conv({ unseenDividerId: "t1", items: [pedido, resposta] }) },
    })
    useChat
      .getState()
      .start("c1", "mais um pedido", "r2", "claude-code", null, null, [])
    expect(useChat.getState().byId.c1.unseenDividerId).toBeUndefined()
  })
})
