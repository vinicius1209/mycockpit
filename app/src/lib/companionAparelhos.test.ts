import { describe, expect, it } from "vitest"
import { rotuloDeExpiracao } from "./companionAparelhos"

const AGORA = 1_789_600_000_000
const DIA = 86_400_000

describe("rotuloDeExpiracao", () => {
  it("diz quantos dias faltam para o aparelho parado vencer", () => {
    expect(rotuloDeExpiracao(AGORA + 12 * DIA + 5_000, AGORA)).toBe("expira em 12 d sem uso")
    expect(rotuloDeExpiracao(AGORA + 3 * 3_600_000, AGORA)).toBe("expira hoje")
    expect(rotuloDeExpiracao(AGORA - 1, AGORA)).toBe("expirado")
  })

  it("sem prazo do servidor não inventa rótulo", () => {
    expect(rotuloDeExpiracao(undefined, AGORA)).toBeNull()
    expect(rotuloDeExpiracao(Number.NaN, AGORA)).toBeNull()
  })
})
