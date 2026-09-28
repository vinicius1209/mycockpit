import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { caminhoAbsoluto, EntregasDoTurno, metaDaEntrega, relativoARaiz } from "./EntregasDoTurno"

const DIST = "/Users/viniciusmachado/projetos/prime/nova-lading-page/dist/prime-landing-v3"

describe("cartões do que o turno entregou", () => {
  it("o nome longo corta no meio e a extensão continua visível", () => {
    const html = renderToStaticMarkup(
      createElement(EntregasDoTurno, {
        entregas: [{ caminho: `${DIST}/relatorio-cartoes-setembro-de-2026-consolidado.pdf` }],
      }),
    )
    expect(html).toContain("…")
    expect(html).toContain("consolidado.pdf")
    expect(html).toContain('title="relatorio-cartoes-setembro-de-2026-consolidado.pdf"')
  })

  it("fora do app, sem ler o disco, a meta diz só o tipo (não inventa tamanho)", () => {
    const html = renderToStaticMarkup(createElement(EntregasDoTurno, { entregas: [{ caminho: `${DIST}/faturas.csv` }] }))
    expect(html).toContain(">CSV<")
    expect(html).not.toContain("não está mais no disco")
  })

  it("a meta junta tipo e tamanho lido", () => {
    expect(metaDaEntrega("/x/relatorio.pdf", 188_416)).toBe("PDF · 184.0 KB")
    expect(metaDaEntrega("/x/relatorio.pdf", null)).toBe("PDF")
  })

  it("caminho relativo resolve contra a raiz da conversa", () => {
    expect(caminhoAbsoluto("./relatorios/a.pdf", "/p/finance/")).toBe("/p/finance/relatorios/a.pdf")
    expect(caminhoAbsoluto("/tmp/a.pdf", "/p/finance")).toBe("/tmp/a.pdf")
    expect(caminhoAbsoluto("a.pdf", null)).toBe("a.pdf")
  })

  it("só arrasta como arquivo do projeto o que mora dentro da raiz", () => {
    expect(relativoARaiz("/p/finance/relatorios/a.pdf", "/p/finance")).toBe("relatorios/a.pdf")
    expect(relativoARaiz("/tmp/a.pdf", "/p/finance")).toBeNull()
    expect(relativoARaiz("/p/finance-2/a.pdf", "/p/finance")).toBeNull()
  })
})
