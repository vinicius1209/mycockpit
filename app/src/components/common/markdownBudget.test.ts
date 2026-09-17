import { describe, expect, it } from "vitest"
import { fatiasDaMensagem, MAX_RICH_LINE, MAX_RICH_TEXT } from "./markdownBudget"

const output = Object.values(import.meta.glob("../../test/maclan-test-output.txt", {
  query: "?raw", import: "default", eager: true,
}))[0] as string

const inteiro = (texto: string) =>
  fatiasDaMensagem(texto).map((fatia) => fatia.texto).join("\n")

describe("fatias da mensagem antes do parser", () => {
  it("mensagem longa e normal continua inteira no Markdown", () => {
    // O caso que motivou a ADR-210: 18.130 caracteres, 555 linhas, maior linha
    // de 300 (medido na mensagem real do usuário em `conversation_items`).
    const secao = "## Título\n\nTexto com `código` e um [link](https://exemplo.com).\n\n```tsx\nconst a = 1\n```\n"
    const texto = secao.repeat(220)
    expect(texto.length).toBeGreaterThan(16_384)
    expect(fatiasDaMensagem(texto)).toEqual([{ tipo: "rico", texto }])
  })

  it("isola a linha real que travou o app e mantém o resto formatado", () => {
    const texto = `# Resultado\n\n${output}\n\nTerminei, 45 testes passando.`
    const fatias = fatiasDaMensagem(texto)
    expect(fatias.map((fatia) => fatia.tipo)).toEqual(["rico", "cru", "rico"])
    expect(fatias[1].texto).toBe(output)
    expect(fatias[2].texto).toContain("45 testes passando")
    expect(inteiro(texto)).toBe(texto)
  })

  it("linha pesada dentro de cerca leva o bloco de código inteiro, com as marcações", () => {
    const texto = `Olha:\n\n\`\`\`sh\nvitest\n${".".repeat(MAX_RICH_LINE + 1)}\n\`\`\`\n\nFim.`
    const fatias = fatiasDaMensagem(texto)
    expect(fatias.map((fatia) => fatia.tipo)).toEqual(["rico", "cru", "rico"])
    expect(fatias[1].texto.startsWith("```sh")).toBe(true)
    expect(fatias[1].texto.endsWith("```")).toBe(true)
    expect(inteiro(texto)).toBe(texto)
  })

  it("acima do teto de último recurso a mensagem sai crua, mas inteira e de uma vez", () => {
    const texto = "linha normal\n".repeat(MAX_RICH_TEXT / 4)
    expect(texto.length).toBeGreaterThan(MAX_RICH_TEXT)
    expect(fatiasDaMensagem(texto)).toEqual([{ tipo: "cru", texto }])
  })

  it("nunca perde, repete nem reordena conteúdo", () => {
    for (const texto of [
      "",
      "só uma linha",
      `${".".repeat(MAX_RICH_LINE + 1)}\n${".".repeat(MAX_RICH_LINE + 1)}`,
      `a\n\`\`\`\n${".".repeat(MAX_RICH_LINE + 1)}\n`,
      output,
    ]) {
      expect(inteiro(texto)).toBe(texto)
    }
  })
})
