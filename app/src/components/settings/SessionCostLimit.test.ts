import { describe, expect, it } from "vitest"
import { limitToInput, parseLimit } from "./SessionCostLimit"

describe("parseLimit (teto de custo por sessão)", () => {
  it("campo vazio é ausência de teto, não zero", () => {
    expect(parseLimit("")).toBeNull()
    expect(parseLimit("   ")).toBeNull()
  })

  it("aceita vírgula decimal do pt-BR", () => {
    expect(parseLimit("2,50")).toBe(2.5)
    expect(parseLimit("0,75")).toBe(0.75)
  })

  it("aceita ponto decimal (quem digita teclado numérico)", () => {
    expect(parseLimit("2.50")).toBe(2.5)
    expect(parseLimit("10")).toBe(10)
  })

  it("valor sem sentido como teto vira ausência de teto (nunca inventa)", () => {
    expect(parseLimit("0")).toBeNull()
    expect(parseLimit("-3")).toBeNull()
    expect(parseLimit("caro")).toBeNull()
    expect(parseLimit("1,2,3")).toBeNull()
  })
})

describe("limitToInput", () => {
  it("mostra o teto com vírgula, e vazio quando não há teto", () => {
    expect(limitToInput(2.5)).toBe("2,5")
    expect(limitToInput(10)).toBe("10")
    expect(limitToInput(null)).toBe("")
    expect(limitToInput(0)).toBe("")
  })
})
