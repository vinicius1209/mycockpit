import { describe, expect, it } from "vitest"
import { evidenceMeta, presentTool, resultMeta } from "./toolview"

// O prompt é o `revisedPrompt` real da geração de 29/07/2026 (codex 0.144.6),
// cortado: a linha do fio mostra a primeira linha, o hover o resto.
const PROMPT_REAL =
  "Use case: ads-marketing\nAsset type: landscape social preview card for the PWA Nossa Casa"

describe("imagem gerada pelo motor (GenerateImage)", () => {
  it("vira a ação Gerar imagem com a primeira linha do prompt como objeto", () => {
    const v = presentTool("GenerateImage", { prompt: PROMPT_REAL })
    expect(v.kind).toBe("image")
    expect(v.verb).toBe("Gerar imagem")
    expect(v.object).toEqual({ kind: "text", text: "Use case: ads-marketing" })
    expect(v.narration).toContain("Nossa Casa")
    expect(v.category).toBe("execute")
  })

  it("sem prompt, a ação continua dizendo o que fez", () => {
    const v = presentTool("GenerateImage", { prompt: null })
    expect(v.verb).toBe("Gerar imagem")
    expect(v.object).toBeNull()
  })

  it("a falha mostra o motivo, não só erro", () => {
    const falha = { ok: false, text: "Limite de geração de imagem atingido. Volta em 2h 10min.", lines: 1 }
    expect(resultMeta("GenerateImage", falha)).toBe("Limite de geração de imagem atingido. Volta em 2h 10min.")
    expect(resultMeta("Bash", falha)).toBe("erro")
  })

  it("a imagem gerada conta como imagem, a captura de MCP como captura", () => {
    expect(evidenceMeta(["evidence/c/call-0.png"], "GenerateImage")).toBe("1 imagem")
    expect(evidenceMeta(["evidence/c/t-0.png", "evidence/c/t-1.png"], "mcp__playwright__browser_take_screenshot")).toBe("2 capturas")
  })
})
