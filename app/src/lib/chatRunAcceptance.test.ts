// A marca `retomada` no pedido que o app manda sozinho (ADR-250).

import { beforeEach, describe, expect, it, vi } from "vitest"
import { useChat, type ConvState } from "@/store/chat"
import { acceptChatTurn } from "./chatRunAcceptance"

vi.mock("@/lib/db", () => ({
  isTauri: () => false,
}))
vi.mock("@/lib/db/conversations", () => ({
  listConversations: vi.fn(async () => null),
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
    running: false,
    finalizing: false,
    runId: null,
    startedAt: 0,
    suggestions: [],
    suggesting: false,
    ...patch,
  }
}

function aceitar(text: string) {
  acceptChatTurn({
    convId: "c1",
    runId: "r2",
    agent: "claude-code",
    model: null,
    effort: null,
    text,
    attachments: [],
    wheelSwitch: false,
    lessonIds: [],
    recordLessons: () => {},
  })
}

function ultimoPedido() {
  return useChat.getState().byId.c1.items.findLast((it) => it.kind === "user")
}

describe("acceptChatTurn: quem escreveu o pedido", () => {
  beforeEach(() => {
    useChat.setState({ byId: {}, activeId: null })
  })

  it("o disparo da retomada automática marca o pedido como do app", () => {
    const timer = setTimeout(() => {}, 0)
    useChat.setState({
      byId: {
        c1: conv({
          autoResume: { tries: 1, maxTries: 3, nextAt: 0, reason: "limite da CLI atingido", timer, disparou: true },
        }),
      },
    })
    aceitar("O turno anterior parou num limite de uso/espera.")
    expect(ultimoPedido()).toMatchObject({ kind: "user", retomada: true })
  })

  it("retomada só agendada, sem disparo, não é o pedido que está nascendo", () => {
    const timer = setTimeout(() => {}, 0)
    useChat.setState({
      byId: {
        c1: conv({ autoResume: { tries: 1, maxTries: 3, nextAt: Date.now() + 60_000, reason: "limite da CLI atingido", timer } }),
      },
    })
    aceitar("mudei de ideia, faz outra coisa")
    expect(ultimoPedido()).not.toHaveProperty("retomada")
  })

  it("pedido seu, sem retomada nenhuma, fica sem marca", () => {
    useChat.setState({ byId: { c1: conv() } })
    aceitar("revisa o plano")
    expect(ultimoPedido()).not.toHaveProperty("retomada")
  })
})
