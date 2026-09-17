import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }))

import { emptyConv, useChat, type ConvState } from "@/store/chat"
import {
  ceilingFrom,
  entryFor,
  medirCompactacao,
  refreshEngineContext,
  useEngineContext,
  type EngineContext,
} from "./engineContext"

// Campos da leitura real (testdata/claude-2.1.270/context-usage.jsonl).
const LEITURA: EngineContext = {
  totalTokens: 322_236,
  engineEstimate: null,
  maxTokens: 1_000_000,
  autoCompactThreshold: 967_000,
  autoCompactEnabled: true,
  source: "model-default",
  origin: "engine-report",
  model: "claude-opus-5[1m]",
  categories: [{ name: "Autocompact buffer", tokens: 33_000, kind: "buffer" }],
  observedAt: 1,
}

function conv(patch: Partial<ConvState>) {
  useChat.setState({
    byId: {
      c1: {
        ...emptyConv("p"),
        agent: "claude-code",
        sessionId: "s1",
        reqModel: "opus",
        ...patch,
      },
    },
  })
}

beforeEach(() => {
  h.invoke.mockReset()
  useEngineContext.setState({ byConv: {} })
})

describe("engineContext", () => {
  it("compactação ligada vira o limiar do motor; desligada vira a janela como teto", () => {
    expect(ceilingFrom(LEITURA)).toEqual({
      kind: "autocompact",
      tokens: 967_000,
      origin: "engine-report",
    })
    expect(
      ceilingFrom({ ...LEITURA, autoCompactEnabled: false, autoCompactThreshold: null }),
    ).toEqual({ kind: "sem-autocompact", tokens: 1_000_000, origin: "engine-report" })
    expect(ceilingFrom({ ...LEITURA, autoCompactThreshold: null })).toBeNull()
  })

  it("a leitura vale só para a sessão e o modelo em que foi feita", () => {
    const entry = { sessionId: "s1", model: "opus", contextTokens: 10, reading: LEITURA, error: null }
    expect(entryFor({ sessionId: "s1", reqModel: "opus" }, entry)).toBe(entry)
    expect(entryFor({ sessionId: "s1", reqModel: "sonnet" }, entry)).toBeNull()
    expect(entryFor({ sessionId: "s2", reqModel: "opus" }, entry)).toBeNull()
  })

  it("estimativa própria do motor vale só para o nível de contexto em que foi lida", () => {
    // agy 1.2.4 real: 244.639 de 256.000 na conversa "nuvem".
    const agy: EngineContext = {
      ...LEITURA,
      totalTokens: null,
      engineEstimate: 244_639,
      maxTokens: null,
      autoCompactThreshold: 256_000,
      origin: "engine-record",
    }
    const entry = { sessionId: "s1", model: "gemini-3.8-flash-high", contextTokens: 248_850, reading: agy, error: null }
    const conv = { sessionId: "s1", reqModel: "gemini-3.8-flash-high" }
    expect(entryFor({ ...conv, contextTokens: 248_850 }, entry)).toBe(entry)
    expect(entryFor({ ...conv, contextTokens: 255_334 }, entry)).toBeNull()
    expect(ceilingFrom(agy)).toEqual({
      kind: "autocompact",
      tokens: 256_000,
      origin: "engine-record",
      engineCount: 244_639,
    })
  })

  it("nunca pergunta com turno da sessão rodando, nem a motor sem sonda", async () => {
    conv({ running: true })
    expect(await refreshEngineContext("c1", "/p")).toBeNull()
    conv({ agent: "opencode" })
    expect(await refreshEngineContext("c1", "/p")).toBeNull()
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it("pedidos simultâneos sobem uma sonda só", async () => {
    conv({})
    h.invoke.mockResolvedValue(LEITURA)
    await Promise.all([refreshEngineContext("c1", "/p"), refreshEngineContext("c1", "/p")])
    expect(h.invoke).toHaveBeenCalledTimes(1)
    expect(h.invoke).toHaveBeenCalledWith("read_engine_context", {
      agent: "claude-code",
      cwd: "/p",
      sessionId: "s1",
      model: "opus",
      resolvedModel: null,
    })
  })

  it("falha guarda o motivo e preserva a última leitura boa", async () => {
    conv({})
    h.invoke.mockResolvedValueOnce(LEITURA)
    await refreshEngineContext("c1", "/p")
    h.invoke.mockRejectedValueOnce("a leitura de contexto do motor estourou o prazo de 8s")
    expect(await refreshEngineContext("c1", "/p")).toBeNull()
    const entry = useEngineContext.getState().byConv.c1
    expect(entry.reading).toEqual(LEITURA)
    expect(entry.error).toContain("prazo de 8s")
  })

  it("fim de compactação mede antes → depois e atualiza o anel", async () => {
    conv({
      running: true,
      contextBasis: "last_call",
      contextTokens: 882_525,
      contextWindow: 1_000_000,
    })
    h.invoke.mockResolvedValue({ ...LEITURA, totalTokens: 34_995 })
    const msg = await medirCompactacao("c1", "/p", "Contexto compactado.", 882_525)
    expect(msg).toBe(
      "Contexto compactado · 882.525 → 34.995 tokens, medido pelo Claude Code.",
    )
    expect(useChat.getState().byId.c1.contextTokens).toBe(34_995)
  })

  it("sem leitura, o marco da compactação fica como sempre foi", async () => {
    conv({ running: true })
    h.invoke.mockRejectedValue("get_context_usage is not supported in this context")
    expect(await medirCompactacao("c1", "/p", "Contexto compactado.", 882_525)).toBe(
      "Contexto compactado.",
    )
  })
})
