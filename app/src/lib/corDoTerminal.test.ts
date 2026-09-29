import { describe, expect, it } from "vitest"
import { limparLinha, somarTexto, SAIDA_VAZIA } from "./bastidores"
import { semCor, trechosComCor } from "./corDoTerminal"

// Saída real de `git -c color.ui=always diff`: reset como `ESC[m`, sem número.
const gitDiff = Object.values(
  import.meta.glob("../test/git-diff-com-cor.txt", { query: "?raw", import: "default", eager: true }),
)[0] as string

describe("trechosComCor", () => {
  it("pinta a saída real do git diff com os tokens do terminal", () => {
    const saida = somarTexto(SAIDA_VAZIA, gitDiff)
    const trechos = trechosComCor(saida.linhas.join("\n"))
    const de = (texto: string) => trechos.find((t) => t.texto.includes(texto))?.classe
    expect(de("diff --git")).toBe("font-semibold")
    expect(de("@@ -1,2 +1,2 @@")).toBe("text-terminal-info")
    expect(de("-dois")).toBe("text-terminal-error")
    expect(de("DOIS")).toBe("text-terminal-success")
    expect(de(" um")).toBe("")
    expect(trechos.map((t) => t.texto).join("")).toBe(semCor(saida.linhas.join("\n")))
  })

  it("sem ESC, um trecho só e sem classe", () => {
    expect(trechosComCor("ok")).toEqual([{ texto: "ok", classe: "" }])
    expect(trechosComCor("")).toEqual([])
  })

  it("a cor atravessa a quebra de linha até o reset, como no terminal", () => {
    expect(trechosComCor("\u001b[33maviso\nainda\u001b[0m fim")).toEqual([
      { texto: "aviso\nainda", classe: "text-terminal-warning" },
      { texto: " fim", classe: "" },
    ])
  })

  it("cinza claro, esmaecido e 256 cores das 16 primeiras; o resto é neutro", () => {
    expect(trechosComCor("\u001b[90mx")[0].classe).toBe("text-terminal-dim")
    expect(trechosComCor("\u001b[2mx")[0].classe).toBe("text-terminal-dim")
    expect(trechosComCor("\u001b[38;5;9mx")[0].classe).toBe("text-terminal-error")
    expect(trechosComCor("\u001b[38;5;208mx")[0].classe).toBe("")
    expect(trechosComCor("\u001b[38;2;255;0;0mx")[0].classe).toBe("")
    // Fundo não pinta o texto, e os parâmetros do 48 não viram código.
    expect(trechosComCor("\u001b[48;5;1mx")[0].classe).toBe("")
  })

  it("sequência cortada no fim da linha some, sem sujar o texto", () => {
    expect(trechosComCor("\u001b[31merro\u001b[3")).toEqual([{ texto: "erro", classe: "text-terminal-error" }])
  })
})

describe("limparLinha com cor", () => {
  it("guarda o SGR e tira o resto, igual ao Rust", () => {
    const bruta = "\u001b]0;titulo\u0007\u001b[2K\u001b[32m✓\u001b[0m 12 testes\u001b[?25l"
    expect(limparLinha(bruta, { cor: true })).toBe("\u001b[32m✓\u001b[0m 12 testes")
    expect(limparLinha(bruta)).toBe("✓ 12 testes")
  })
})
