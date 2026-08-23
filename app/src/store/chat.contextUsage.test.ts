import { describe, expect, it } from "vitest"
import { emptyConv, reduceItems } from "./chat"

describe("snapshot normalizado de contexto", () => {
  it("guarda última chamada, janela efetiva e procedência juntas", () => {
    const conv = emptyConv("p")
    expect(
      reduceItems(conv, {
        type: "context_usage",
        tokens: 211_547,
        window_tokens: 258_400,
      }),
    ).toEqual({
      contextTokens: 211_547,
      contextWindow: 258_400,
      contextBasis: "last_call",
    })
  })

  it("falha da fonte limpa o snapshot anterior", () => {
    const conv = {
      ...emptyConv("p"),
      contextTokens: 211_547,
      contextWindow: 258_400,
      contextBasis: "last_call" as const,
    }
    expect(reduceItems(conv, { type: "context_unavailable" })).toEqual({
      contextTokens: undefined,
      contextWindow: undefined,
      contextBasis: "unavailable",
    })
  })
})
