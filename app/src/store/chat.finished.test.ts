// Testes do selo "terminou e você não viu" (ConvState.finishedUnseen).
//
// O buraco: enquanto o turno roda a linha da conversa mostra spinner; quando
// acaba, o spinner some e NÃO entra nada. O fim do trabalho não deixava sinal
// algum na navegação — você só descobria abrindo a conversa. A notificação
// nativa não cobre isso porque ela mesma depende de autorização do SO (e, em
// build ad-hoc, nunca chega).

import { beforeEach, describe, expect, it, vi } from "vitest"
import { useChat, type ChatItem, type ConvState } from "./chat"

vi.mock("@/lib/db", () => ({
  isTauri: () => false,
  listConversations: vi.fn(async () => null),
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
    running: true,
    finalizing: false,
    runId: "r1",
    startedAt: 0,
    suggestions: [],
    suggesting: false,
    ...patch,
  }
}

const texto: ChatItem = { kind: "text", id: "t1", text: "pronto" } as ChatItem
const erro: ChatItem = { kind: "error", id: "e1", message: "estourou" } as ChatItem
const limite: ChatItem = { kind: "limit", id: "l1", message: "limite" } as ChatItem

/** `document.hasFocus` é a régua de "você estava olhando". Injetável no teste. */
function setFoco(focado: boolean) {
  vi.stubGlobal("document", { hasFocus: () => focado })
}

beforeEach(() => {
  useChat.setState({ activeId: null, byId: {} })
  setFoco(true)
})

describe("finish → selo de concluído", () => {
  it("turno de OUTRA conversa termina ⇒ marca 'ok' (é o caso que importa)", () => {
    useChat.setState({ activeId: "outra", byId: { c1: conv({ items: [texto] }) } })
    useChat.getState().finish("c1")
    expect(useChat.getState().byId.c1.finishedUnseen).toBe("ok")
    expect(useChat.getState().byId.c1.running).toBe(false)
  })

  it("terminou COM ERRO ⇒ marca 'error' (selo diferente, não some no meio)", () => {
    useChat.setState({ activeId: "outra", byId: { c1: conv({ items: [erro] }) } })
    useChat.getState().finish("c1")
    expect(useChat.getState().byId.c1.finishedUnseen).toBe("error")
  })

  it("limite de uso também é 'error' (o turno não entregou)", () => {
    useChat.setState({ activeId: "outra", byId: { c1: conv({ items: [limite] }) } })
    useChat.getState().finish("c1")
    expect(useChat.getState().byId.c1.finishedUnseen).toBe("error")
  })

  it("você ESTAVA olhando (conversa ativa + janela focada) ⇒ NÃO marca", () => {
    // o próprio conteúdo aparecendo é o feedback; selo ali seria ruído.
    useChat.setState({ activeId: "c1", byId: { c1: conv({ items: [texto] }) } })
    useChat.getState().finish("c1")
    expect(useChat.getState().byId.c1.finishedUnseen).toBeUndefined()
  })

  it("conversa ativa MAS janela sem foco ⇒ marca (você estava noutro app)", () => {
    setFoco(false)
    useChat.setState({ activeId: "c1", byId: { c1: conv({ items: [texto] }) } })
    useChat.getState().finish("c1")
    expect(useChat.getState().byId.c1.finishedUnseen).toBe("ok")
  })
})

describe("markSeen → o selo cumpriu o papel", () => {
  it("limpa o selo", () => {
    useChat.setState({
      activeId: "outra",
      byId: { c1: conv({ running: false, finishedUnseen: "ok" }) },
    })
    useChat.getState().markSeen("c1")
    expect(useChat.getState().byId.c1.finishedUnseen).toBeUndefined()
  })

  it("é no-op em conversa sem selo (não cria estado do nada)", () => {
    const antes = conv({ running: false })
    useChat.setState({ byId: { c1: antes } })
    useChat.getState().markSeen("c1")
    // mesma REFERÊNCIA: sem patch, sem re-render da sidebar inteira
    expect(useChat.getState().byId.c1).toBe(antes)
  })

  it("conversa inexistente não quebra", () => {
    expect(() => useChat.getState().markSeen("fantasma")).not.toThrow()
  })
})
