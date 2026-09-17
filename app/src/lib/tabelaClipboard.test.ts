import { describe, expect, it } from "vitest"
import {
  conteudoDaTabela,
  paraHtml,
  paraMarkdown,
  paraTsv,
  recorteDaSelecao,
  textoDaCelula,
  type TabelaCopiavel,
} from "./tabelaClipboard"

const custos: TabelaCopiavel = {
  cabecalho: true,
  linhas: [
    ["Motor", "Turnos", "Custo"],
    ["Claude Code", "12", "US$ 1,48"],
    ["Codex", "3", "US$ 0,20"],
  ],
}

describe("tabela copiada como tabela", () => {
  it("para planilha: uma linha por \\n e uma célula por tab", () => {
    expect(paraTsv(custos)).toBe("Motor\tTurnos\tCusto\nClaude Code\t12\tUS$ 1,48\nCodex\t3\tUS$ 0,20")
  })

  it("célula com tab, quebra ou aspas sai íntegra entre aspas", () => {
    const t: TabelaCopiavel = {
      cabecalho: false,
      linhas: [["a\tb", 'diz "oi"', "linha 1\nlinha 2", "simples"]],
    }
    expect(paraTsv(t)).toBe('"a\tb"\t"diz ""oi"""\t"linha 1\nlinha 2"\tsimples')
  })

  it("HTML limpo, com cabeçalho quando a tabela tem th, e texto escapado", () => {
    expect(paraHtml(custos)).toBe(
      "<table><thead><tr><th>Motor</th><th>Turnos</th><th>Custo</th></tr></thead>" +
        "<tbody><tr><td>Claude Code</td><td>12</td><td>US$ 1,48</td></tr>" +
        "<tr><td>Codex</td><td>3</td><td>US$ 0,20</td></tr></tbody></table>",
    )
    expect(paraHtml({ cabecalho: false, linhas: [["<b>&</b>", "a\nb"]] })).toBe(
      "<table><tbody><tr><td>&lt;b&gt;&amp;&lt;/b&gt;</td><td>a<br>b</td></tr></tbody></table>",
    )
  })

  it("Markdown GFM com pipe escapado e quebra como <br>", () => {
    expect(paraMarkdown(custos)).toBe(
      "| Motor | Turnos | Custo |\n| --- | --- | --- |\n| Claude Code | 12 | US$ 1,48 |\n| Codex | 3 | US$ 0,20 |",
    )
    expect(paraMarkdown({ cabecalho: true, linhas: [["a|b", "c"], ["x\ny", "z\\w"]] })).toBe(
      "| a\\|b | c |\n| --- | --- |\n| x<br>y | z\\\\w |",
    )
  })

  it("linha com menos células é completada, sem deslocar colunas", () => {
    const t: TabelaCopiavel = { cabecalho: true, linhas: [["a", "b", "c"], ["1"]] }
    expect(paraTsv(t)).toBe("a\tb\tc\n1\t\t")
    expect(paraMarkdown(t).split("\n")[2]).toBe("| 1 |  |  |")
  })

  it("texto da célula perde espaço de marcação mas guarda a quebra", () => {
    expect(textoDaCelula("  US$  1,48 \n   por turno ")).toBe("US$ 1,48\npor turno")
  })

  it("cada destino leva os formatos certos", () => {
    expect(conteudoDaTabela(custos, "planilha")).toEqual({ plain: paraTsv(custos), html: paraHtml(custos) })
    expect(conteudoDaTabela(custos, "markdown")).toEqual({ plain: paraMarkdown(custos) })
  })
})

describe("seleção que cruza a tabela (C-T2)", () => {
  const cel = (texto: string, selecionada = false) => ({ texto, selecionada })
  const tabela = [
    [cel("Motor"), cel("Turnos"), cel("Custo")],
    [cel("Claude Code"), cel("12"), cel("US$ 1,48")],
    [cel("Codex"), cel("3"), cel("US$ 0,20")],
    [cel("Agy"), cel("7"), cel("US$ 0,00")],
  ]
  const marcar = (coords: [number, number][]) =>
    tabela.map((linha, i) => linha.map((c, j) => ({ ...c, selecionada: coords.some(([a, b]) => a === i && b === j) })))

  it("três linhas selecionadas viram três linhas de planilha, com as células inteiras", () => {
    const t = recorteDaSelecao(marcar([[1, 1], [2, 0], [3, 2]]), true)
    expect(t).toEqual({
      cabecalho: false,
      linhas: [
        ["Claude Code", "12", "US$ 1,48"],
        ["Codex", "3", "US$ 0,20"],
        ["Agy", "7", "US$ 0,00"],
      ],
    })
    expect(paraTsv(t!)).toBe("Claude Code\t12\tUS$ 1,48\nCodex\t3\tUS$ 0,20\nAgy\t7\tUS$ 0,00")
  })

  it("recorte que começa no cabeçalho leva o cabeçalho", () => {
    expect(recorteDaSelecao(marcar([[0, 0], [1, 1]]), true)).toEqual({
      cabecalho: true,
      linhas: [["Motor", "Turnos"], ["Claude Code", "12"]],
    })
  })

  it("uma célula só, ou nada selecionado, fica com a cópia normal", () => {
    expect(recorteDaSelecao(marcar([[2, 2]]), true)).toBeNull()
    expect(recorteDaSelecao(marcar([]), true)).toBeNull()
  })
})
