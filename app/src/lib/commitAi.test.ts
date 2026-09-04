import { describe, expect, it } from "vitest"
import {
  buildCommitPrompt,
  parseCommitSuggestion,
  MAX_DIFF_CHARS_FOR_AI,
} from "./commitAi"

describe("commitAi", () => {
  it("parseCommitSuggestion extrai título e corpo limpando cercas de código", () => {
    const raw = `\`\`\`
feat(git): adicionar suporte a staged changes e tree view

- Cria comandos Rust de staging
- Adiciona seções na interface
\`\`\``
    const res = parseCommitSuggestion(raw)
    expect(res.title).toBe(
      "feat(git): adicionar suporte a staged changes e tree view",
    )
    expect(res.body).toBe(
      "- Cria comandos Rust de staging\n- Adiciona seções na interface",
    )
  })

  it("parseCommitSuggestion lida com commit de linha única", () => {
    const raw = "fix(notes): corrigir altura do popover"
    const res = parseCommitSuggestion(raw)
    expect(res.title).toBe("fix(notes): corrigir altura do popover")
    expect(res.body).toBe("")
  })

  it("buildCommitPrompt trunca diffs gigantes para não estourar contexto", () => {
    const hugeDiff = "a".repeat(MAX_DIFF_CHARS_FOR_AI + 5000)
    const prompt = buildCommitPrompt(hugeDiff)
    expect(prompt).toContain("... [diff truncado]")
    expect(prompt).toContain("Conventional Commits")
  })
})
