import { describe, expect, it } from "vitest"
import { fmtBytes, fmtCost, fmtDuration, fmtTokens } from "./format"

describe("fmtCost", () => {
  it("usa vírgula decimal e 2 casas para valores ≥ 1 (nunca 'US$12.000')", () => {
    expect(fmtCost(12)).toBe("US$ 12,00")
    expect(fmtCost(13.039)).toBe("US$ 13,04")
    expect(fmtCost(30.463)).toBe("US$ 30,46")
  })
  it("mantém 3 casas para custo sub-dólar (não esconde sub-centavo)", () => {
    expect(fmtCost(0.043)).toBe("US$ 0,043")
    expect(fmtCost(0.001)).toBe("US$ 0,001")
  })
  it("prefixa ~ quando estimado e vazio quando ausente", () => {
    expect(fmtCost(3.65, "estimated")).toBe("~US$ 3,65")
    expect(fmtCost(undefined)).toBe("")
  })
})

describe("fmtDuration", () => {
  it("segundos puros", () => {
    expect(fmtDuration(12_000)).toBe("12s")
    expect(fmtDuration(0)).toBe("0s")
  })
  it("minutos com unidade explícita (não '26:41')", () => {
    expect(fmtDuration(26 * 60_000 + 41_000)).toBe("26min 41s")
    expect(fmtDuration(60_000)).toBe("1min 00s")
  })
  it("horas", () => {
    expect(fmtDuration(65 * 60_000)).toBe("1h 05min")
  })
})

describe("fmtTokens", () => {
  it("faixas", () => {
    expect(fmtTokens(950)).toBe("950")
    expect(fmtTokens(1200)).toBe("1.2k")
    expect(fmtTokens(12_000)).toBe("12k")
    expect(fmtTokens(3_100_000)).toBe("3.1M")
  })
})

describe("fmtBytes", () => {
  it("faixas", () => {
    expect(fmtBytes(512)).toBe("512 B")
    expect(fmtBytes(1536)).toBe("1.5 KB")
    expect(fmtBytes(2.3 * 1024 * 1024)).toBe("2.3 MB")
  })
})
