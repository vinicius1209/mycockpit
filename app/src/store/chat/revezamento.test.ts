import { beforeEach, describe, expect, it } from "vitest"
import { useChat } from "@/store/chat"
import { avisoDeRevezamento, commitTransplantState } from "@/store/chat/revezamento"
import type { ConvState } from "@/store/chat"

const base = (): ConvState => ({
  projectId: "p1",
  agent: "codex",
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
  startedAt: null,
  suggestions: [],
  suggesting: false,
})

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

describe("sessão guardada ao revezar (R5)", () => {
  it("o motor que sai deixa sessão, modelo e até onde viu o fio", () => {
    const cur = {
      ...base(),
      agent: "claude-code",
      sessionId: "sess-claude",
      model: "claude-opus-5",
      items: [
        { kind: "user" as const, id: "u1", text: "oi" },
        { kind: "result" as const, id: "r1", ok: true },
      ],
    }
    const depois = commitTransplantState(cur, { runId: "run-1", targetAgent: "codex" })
    expect(depois.agent).toBe("codex")
    expect(depois.sessionId).toBeNull()
    expect(depois.sessoesAnteriores).toEqual({
      "claude-code": {
        sessionId: "sess-claude",
        model: "claude-opus-5",
        ultimoItemId: "r1",
        at: expect.any(Number),
      },
    })
  })

  it("voltar guarda a sessão do outro sem perder a primeira", () => {
    const ida = commitTransplantState(
      { ...base(), agent: "claude-code", sessionId: "sess-claude", model: "claude-opus-5", items: [{ kind: "text" as const, id: "a", text: "x" }] },
      { runId: "r1", targetAgent: "codex" },
    )
    const volta = commitTransplantState(
      { ...ida, sessionId: "sess-codex", model: "gpt-6", items: [...ida.items, { kind: "text" as const, id: "b", text: "y" }] },
      { runId: "r2", targetAgent: "claude-code" },
    )
    expect(Object.keys(volta.sessoesAnteriores ?? {}).sort()).toEqual(["claude-code", "codex"])
    expect(volta.sessoesAnteriores?.codex.sessionId).toBe("sess-codex")
    expect(volta.sessoesAnteriores?.["claude-code"].sessionId).toBe("sess-claude")
  })
})
