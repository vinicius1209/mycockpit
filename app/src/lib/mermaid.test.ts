/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest"
import { linhaDoErro, resumoDoErro, variaveisDoTema } from "./mermaid"

// O erro de verdade do parser do Mermaid 12 para uma seta inválida, colhido
// rodando `mermaid.parse` (o teste abaixo confere que continua assim).
const FONTE_RUIM = "flowchart LR\n  A[Composer] --> B[handleSend]\n  B -->> C{cota ok?}\n"

describe("erro do diagrama", () => {
  it("a mensagem real do parser dá a linha, e o resumo não repete jargão", async () => {
    const mermaid = (await import("mermaid")).default
    const erro = await mermaid.parse(FONTE_RUIM).then(
      () => null,
      (e: unknown) => (e as Error).message,
    )
    expect(erro).toMatch(/^Parse error on line 3:/)
    expect(linhaDoErro(erro!)).toBe(3)
    expect(resumoDoErro(erro!)).toBeNull()
  })

  it("erro sem linha diz a primeira frase", () => {
    expect(linhaDoErro("No diagram type detected matching given configuration for text: oi")).toBeNull()
    expect(resumoDoErro("No diagram type detected matching given configuration for text: oi")).toBe(
      "No diagram type detected matching given configuration for text: oi",
    )
  })

  it("diagrama válido passa no parser real", async () => {
    const mermaid = (await import("mermaid")).default
    await expect(mermaid.parse("flowchart LR\n  A --> B\n")).resolves.toMatchObject({ diagramType: "flowchart-v2" })
  })
})

describe("tema", () => {
  it("usa os tokens do app, e a reserva quando falta um", () => {
    const tokens: Record<string, string> = { "--card": "#141619", "--foreground": " #e7e8ea", "--muted-foreground": "#9aa0a7" }
    const t = variaveisDoTema((n) => tokens[n] ?? "")
    expect(t.primaryColor).toBe("#141619")
    expect(t.primaryTextColor).toBe("#e7e8ea")
    expect(t.lineColor).toBe("#9aa0a7")
    expect(t.primaryBorderColor).toBe("rgba(0,0,0,.14)")
  })
})
