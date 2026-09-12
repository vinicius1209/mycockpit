import { describe, expect, it } from "vitest"
import { MAX_RICH_LINE, MAX_RICH_TEXT, needsPlainText, plainTextPage, TEXT_PAGE_SIZE } from "./markdownBudget"

const output = Object.values(import.meta.glob("../../test/maclan-test-output.txt", {
  query: "?raw", import: "default", eager: true,
}))[0] as string

describe("leitura limitada da saída real do Maclan", () => {
  it("impede que a linha real que travou o app chegue ao parser", () => {
    expect(output.length).toBe(142_976)
    expect(needsPlainText(output)).toBe(true)
    expect(needsPlainText(output.slice(0, MAX_RICH_LINE + 1))).toBe(true)
  })

  it("permite ler o conteúdo inteiro com DOM limitado por parte", () => {
    const parts = Array.from({ length: plainTextPage(output, 0).count }, (_, i) => plainTextPage(output, i).text)
    expect(parts.join("")).toBe(output)
    expect(Math.max(...parts.map((part) => part.length))).toBeLessThanOrEqual(TEXT_PAGE_SIZE + 1)
    expect(plainTextPage(output, -1).page).toBe(0)
    expect(plainTextPage(output, 999).page).toBe(parts.length - 1)
  })

  it("mantém Markdown normal e protege também mensagens com muitas linhas", () => {
    expect(needsPlainText("**Olá**\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst n = 1\n```\nhttps://example.com")).toBe(false)
    const multiline = output.slice(0, 128).concat("\n").repeat(130)
    expect(multiline.length).toBeGreaterThan(MAX_RICH_TEXT)
    expect(needsPlainText(multiline)).toBe(true)
  })

  it("não perde emoji dividido entre partes nem após a mensagem encolher", () => {
    const text = output.slice(0, TEXT_PAGE_SIZE - 1) + "😀" + output.slice(0, 80)
    const first = plainTextPage(text, 0).text
    const second = plainTextPage(text, 1).text
    expect(first.endsWith("😀")).toBe(true)
    expect(first + second).toBe(text)
    expect(plainTextPage("fim", 20)).toEqual({ page: 0, count: 1, text: "fim" })
  })
})
