import { beforeEach, describe, expect, it } from "vitest"
import { useChat } from "@/store/chat"
import { avisoDeRevezamento } from "@/store/chat/revezamento"

describe("stageAgent (revezamento engatilhado na store)", () => {
  beforeEach(() => {
    useChat.setState({
      byId: {
        c1: {
          projectId: "p1",
          agent: "codex",
          reqModel: null,
          effort: null,
          worktreePath: null,
          items: [
            { kind: "user", id: "u1", text: "olá", ts: Date.now() },
            { kind: "text", id: "t1", text: "resposta" },
          ],
          sessionId: "sess-1",
          model: "gpt-5",
          streamingTextId: null,
          running: false,
          finalizing: false,
          runId: null,
          startedAt: null,
          suggestions: [],
          suggesting: false,
        },
      },
    })
  })

  it("registra o stagedAgent quando difere do agent atual", () => {
    useChat.getState().stageAgent("c1", "claude-code")
    expect(useChat.getState().byId.c1?.stagedAgent).toBe("claude-code")
  })

  it("limpa o stagedAgent quando recebe o mesmo agente da conversa", () => {
    useChat.getState().stageAgent("c1", "claude-code")
    expect(useChat.getState().byId.c1?.stagedAgent).toBe("claude-code")

    useChat.getState().stageAgent("c1", "codex")
    expect(useChat.getState().byId.c1?.stagedAgent).toBeUndefined()
  })

  it("limpa o stagedAgent quando recebe null", () => {
    useChat.getState().stageAgent("c1", "claude-code")
    expect(useChat.getState().byId.c1?.stagedAgent).toBe("claude-code")

    useChat.getState().stageAgent("c1", null)
    expect(useChat.getState().byId.c1?.stagedAgent).toBeUndefined()
  })
})
describe("avisoDeRevezamento", () => {
  it("formata aviso de revezamento preparado", () => {
    const msg = avisoDeRevezamento("claude-code", "codex")
    expect(msg).toBe("Revezamento preparado: próximo envio usará Claude Code")
    expect(msg).not.toContain("—")
  })

  it("formata aviso de cancelamento", () => {
    const msg = avisoDeRevezamento(null, "codex")
    expect(msg).toBe("Revezamento cancelado: mantendo Codex")
    expect(msg).not.toContain("—")
  })
})
