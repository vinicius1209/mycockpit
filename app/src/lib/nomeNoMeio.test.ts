import { describe, expect, it } from "vitest"
import { nomeCortadoNoMeio } from "./nomeNoMeio"

describe("nome cortado no meio", () => {
  it("nome que cabe fica intacto", () => {
    expect(nomeCortadoNoMeio("LEIA-ME.txt")).toBe("LEIA-ME.txt")
  })

  it("nome longo perde o meio e guarda a extensão e o fim", () => {
    const cortado = nomeCortadoNoMeio("relatorio-cartoes-setembro-2026.pdf", 26)
    expect(cortado.endsWith("2026.pdf")).toBe(true)
    expect(cortado.startsWith("relatorio-cart")).toBe(true)
    expect(cortado).toContain("…")
    expect(Array.from(cortado).length).toBe(26)
  })

  it("acento e emoji não partem ao meio", () => {
    const cortado = nomeCortadoNoMeio("relatório-de-gastos-por-categoria-📊-setembro.png", 24)
    expect(cortado.endsWith(".png")).toBe(true)
    expect(cortado).not.toContain("�")
  })

  it("sem extensão reconhecível, corta no meio do nome inteiro", () => {
    const cortado = nomeCortadoNoMeio("um-nome-muito-comprido-sem-extensao-nenhuma", 20)
    expect(cortado).toContain("…")
    expect(Array.from(cortado).length).toBe(20)
  })

  it("extensão maior que o espaço corta no fim, sem quebrar", () => {
    expect(nomeCortadoNoMeio("abcdefghij.tar", 6)).toBe("abcde…")
  })
})
