import { beforeEach, describe, expect, it, vi } from "vitest"
import { emptyConv, useChat } from "./chat"
import type { McpPreflightGate } from "@/lib/tooling"

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  isTauri: () => false,
}))

vi.mock("@/store/cards", () => ({
  useCards: {
    getState: () => ({ noteConversationAgent: vi.fn() }),
  },
}))

const CONV = "conv-preflight"
const gate: McpPreflightGate = {
  fingerprint: "gate-1",
  issues: [
    {
      sourceId: "playwright",
      sourceLabel: "Playwright",
      code: "browser-offline",
      disposition: "needs-decision",
      detail: "o navegador deste projeto está desligado",
    },
  ],
  allowedRecoveries: [
    { kind: "start-project-browser", sourceId: "playwright" },
  ],
}

beforeEach(() => {
  useChat.setState({
    projectId: "project",
    activeId: CONV,
    conversations: [],
    conversationsByProject: {},
    byId: { [CONV]: emptyConv("project") },
  })
})

describe("preflight antes do turno", () => {
  it("não cria mensagem, run ou conclusão enquanto verifica", () => {
    useChat.getState().beginPreparation(CONV, "run-1")

    const preparing = useChat.getState().byId[CONV]
    expect(preparing.preparing?.runId).toBe("run-1")
    expect(preparing.running).toBe(false)
    expect(preparing.runId).toBeNull()
    expect(preparing.items).toEqual([])
    expect(preparing.finishedUnseen).toBeUndefined()
  })

  it("gate conserva o pedido fora do fio e não fabrica falha", () => {
    const chat = useChat.getState()
    chat.beginPreparation(CONV, "run-1")
    chat.blockPreparation(CONV, "run-1", gate)

    const blocked = useChat.getState().byId[CONV]
    expect(blocked.preparing).toBeUndefined()
    expect(blocked.preflightGate).toEqual({ runId: "run-1", gate })
    expect(blocked.items).toEqual([])
    expect(blocked.running).toBe(false)
    expect(blocked.finishedUnseen).toBeUndefined()
  })

  it("run aceito limpa o gate e só então grava o pedido", () => {
    const chat = useChat.getState()
    chat.beginPreparation(CONV, "run-1")
    chat.start(CONV, "Revise as branches", "run-1", "codex", null, null, [])

    const accepted = useChat.getState().byId[CONV]
    expect(accepted.preparing).toBeUndefined()
    expect(accepted.preflightGate).toBeUndefined()
    expect(accepted.running).toBe(true)
    expect(accepted.runId).toBe("run-1")
    expect(accepted.items).toHaveLength(1)
    expect(accepted.items[0]).toMatchObject({
      kind: "user",
      text: "Revise as branches",
    })
  })

  it("falha de startup vira marco neutro, nunca incidente de execução", () => {
    const chat = useChat.getState()
    chat.beginPreparation(CONV, "run-startup")
    chat.start(
      CONV,
      "Continue a conversa",
      "run-startup",
      "codex",
      null,
      null,
      [],
    )
    chat.handleEvent(CONV, {
      type: "startup_failed",
      message: "binário não encontrado",
    })

    const state = useChat.getState().byId[CONV]
    expect(state.running).toBe(false)
    expect(state.items).toHaveLength(2)
    expect(state.items[1]).toMatchObject({
      kind: "notice",
      message: "Turno não iniciado. binário não encontrado",
    })
    expect(state.items.some((item) => item.kind === "error")).toBe(false)
  })
})
