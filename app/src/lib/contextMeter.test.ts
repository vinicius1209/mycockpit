import { describe, expect, it } from "vitest"
import { contextMeter } from "./contextMeter"

describe("contextMeter", () => {
  it("prefere janela efetiva do runtime e calcula a última chamada", () => {
    expect(
      contextMeter({
        basis: "last_call",
        tokens: 211_547,
        runtimeWindow: 258_400,
        model: "gpt-5.6-sol",
      }),
    ).toEqual({
      kind: "ratio",
      tokens: 211_547,
      window: 258_400,
      free: 46_853,
      pct: 211_547 / 258_400,
      windowSource: "runtime",
    })
  })

  it("marca catálogo como estimativa quando o provider não manda janela", () => {
    const meter = contextMeter({
      basis: "last_call",
      tokens: 100_000,
      model: "claude-sonnet",
    })
    expect(meter).toMatchObject({
      kind: "ratio",
      window: 200_000,
      windowSource: "catalog",
    })
  })

  it("não transforma total maior que a janela em 100% ou em 1M", () => {
    expect(
      contextMeter({
        basis: "last_call",
        tokens: 1_540_542,
        runtimeWindow: 258_400,
        model: "gpt-5.6-sol",
      }),
    ).toEqual({
      kind: "incompatible",
      tokens: 1_540_542,
      window: 258_400,
      windowSource: "runtime",
    })
  })

  it("esconde legado sem procedência e explicita falha da fonte", () => {
    expect(contextMeter({ tokens: 1_540_542, model: "gpt-5.6-sol" })).toEqual({
      kind: "hidden",
    })
    expect(
      contextMeter({ basis: "unavailable", model: "gpt-5.6-sol" }),
    ).toEqual({ kind: "unavailable" })
  })

  it("mostra só absoluto quando nem runtime nem catálogo conhecem a janela", () => {
    expect(
      contextMeter({ basis: "last_call", tokens: 42_000, model: "modelo-x" }),
    ).toEqual({ kind: "absolute", tokens: 42_000 })
  })
})
