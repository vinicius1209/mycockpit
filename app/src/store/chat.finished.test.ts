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
}))
vi.mock("@/lib/db/conversations", () => ({
  listConversations: vi.fn(async () => null),
  // o carimbo do agent persiste (linha vazia, sem histórico a atropelar), então
  // o mock precisa cobrir o caminho do persist — senão vira unhandled rejection.
  saveConversation: vi.fn(async () => {}),
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

  it("marca TAMBÉM na conversa que você está olhando (regra revista)", () => {
    // A 1ª versão suprimia este caso, com a teoria "o conteúdo aparecendo é o
    // feedback". A teoria tem furo: o texto chega em STREAMING, sem momento
    // nítido de fim — o spinner desaparecendo é sinal por AUSÊNCIA, que é
    // exatamente o que faltava. Visto em uso: o turno acabou na conversa ativa
    // e a sidebar não mudou nada.
    useChat.setState({ activeId: "c1", byId: { c1: conv({ items: [texto] }) } })
    useChat.getState().finish("c1")
    expect(useChat.getState().byId.c1.finishedUnseen).toBe("ok")
  })

  it("janela sem foco também marca (nada a ver com foco agora)", () => {
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

  it("enviar de novo limpa o selo (agir na conversa É reconhecer)", () => {
    // sem isto, o selo da conversa ATIVA só sairia se você trocasse de conversa
    // e voltasse — absurdo para quem está trabalhando nela.
    useChat.setState({
      activeId: "c1",
      byId: { c1: conv({ running: false, finishedUnseen: "ok" }) },
    })
    useChat.getState().start("c1", "próximo pedido", "r2", "claude-code", null, null, [])
    expect(useChat.getState().byId.c1.finishedUnseen).toBeUndefined()
    expect(useChat.getState().byId.c1.running).toBe(true)
  })

  it("conversa inexistente não quebra", () => {
    expect(() => useChat.getState().markSeen("fantasma")).not.toThrow()
  })
})

// ── agent carimbado ANTES do 1º envio ───────────────────────────────────────
// Sem isto o seletor do composer era estado local até a 1ª mensagem: você
// escolhia Antigravity e a sidebar seguia mostrando o logo do Claude Code.
describe("setConversationAgent", () => {
  it("conversa VAZIA aceita o carimbo (a sidebar reflete a escolha)", () => {
    useChat.setState({ byId: { c1: conv({ running: false, items: [] }) } })
    useChat.getState().setConversationAgent("c1", "agy")
    expect(useChat.getState().byId.c1.agent).toBe("agy")
  })

  it("conversa COM itens é NO-OP: o agent travou no 1º run", () => {
    // mexer aqui mentiria sobre quem produziu o histórico que já está no fio.
    const antes = conv({ running: false, items: [texto], agent: "claude-code" })
    useChat.setState({ byId: { c1: antes } })
    useChat.getState().setConversationAgent("c1", "agy")
    expect(useChat.getState().byId.c1.agent).toBe("claude-code")
    expect(useChat.getState().byId.c1).toBe(antes) // nem re-renderiza
  })

  it("escolher o mesmo agent não mexe no estado", () => {
    const antes = conv({ running: false, agent: "codex" })
    useChat.setState({ byId: { c1: antes } })
    useChat.getState().setConversationAgent("c1", "codex")
    expect(useChat.getState().byId.c1).toBe(antes)
  })

  it("conversa inexistente não quebra", () => {
    expect(() =>
      useChat.getState().setConversationAgent("fantasma", "agy"),
    ).not.toThrow()
  })
})
