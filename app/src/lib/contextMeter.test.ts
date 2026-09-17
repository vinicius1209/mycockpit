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

describe("contextMeter com o limiar do motor (ADR-196)", () => {
  // Leitura real do Claude Code 2.1.270 (testdata/claude-2.1.270/context-usage.jsonl):
  // janela de 1.000.000 e compactação automática em 967.000.
  const base = { basis: "last_call" as const, runtimeWindow: 1_000_000, model: "claude-opus-5[1m]" }

  it("mede contra o ponto em que o motor compacta, não contra a janela", () => {
    const meter = contextMeter({ ...base, tokens: 882_525, ceiling: { kind: "autocompact", tokens: 967_000 } })
    expect(meter).toMatchObject({ kind: "ratio", window: 1_000_000, free: 84_475, ceiling: { kind: "autocompact" } })
    expect(meter.kind === "ratio" && Math.round(meter.pct * 100)).toBe(91)
  })

  it("janela de compactação reduzida pela pessoa muda o anel de 37% para perto do fim", () => {
    const meter = contextMeter({ ...base, tokens: 367_000, ceiling: { kind: "autocompact", tokens: 367_000 } })
    expect(meter.kind === "ratio" && meter.pct).toBe(1)
    const semLeitura = contextMeter({ ...base, tokens: 367_000 })
    expect(semLeitura.kind === "ratio" && Math.round(semLeitura.pct * 100)).toBe(37)
  })

  it("teto maior que a janela é contradição: ignora o teto em vez de inventar", () => {
    const meter = contextMeter({ ...base, tokens: 100_000, ceiling: { kind: "autocompact", tokens: 2_000_000 } })
    expect(meter).toMatchObject({ kind: "ratio", pct: 0.1 })
    expect(meter.kind === "ratio" && meter.ceiling).toBeUndefined()
  })
})
