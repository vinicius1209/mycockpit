import { describe, expect, it } from "vitest"
import { fmtCheckedAt } from "./format"

describe("fmtCheckedAt", () => {
  const agora = Date.parse("2026-08-12T12:00:00Z")

  it("timestamp zerado (nunca verificado) não vira 'agora'", () => {
    expect(fmtCheckedAt(0, agora)).toBe("nunca")
  })

  it("menos de um minuto é 'agora'", () => {
    expect(fmtCheckedAt(agora - 30_000, agora)).toBe("agora")
  })

  it("minutos, horas e dias em pt-BR", () => {
    expect(fmtCheckedAt(agora - 5 * 60_000, agora)).toBe("há 5 min")
    expect(fmtCheckedAt(agora - 3 * 3_600_000, agora)).toBe("há 3 h")
    expect(fmtCheckedAt(agora - 50 * 3_600_000, agora)).toBe("há 2 d")
  })
})
