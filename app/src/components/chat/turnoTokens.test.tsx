// A guarda de um componente tem que perguntar pelo que SE VÊ.
//
// Achado de review: quando o cache lido saiu do texto e virou tooltip, a guarda
// continuou aceitando `d.lido > 0` como razão para existir. Resultado: num turno
// com cache lido mas sem I/O e sem reconstrução, o componente devolvia um
// `<span>` vazio — elemento invisível pendurado num tooltip que ninguém acha,
// porque não há alvo pra pairar.

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TurnoTokens } from "./turnoTokens"

function render(usage?: {
  input: number
  output: number
  cacheRead: number
  cacheCreation?: number
}) {
  return renderToStaticMarkup(createElement(TurnoTokens, { usage }))
}

describe("TurnoTokens", () => {
  it("sem uso nenhum não renderiza", () => {
    expect(render()).toBe("")
    expect(render({ input: 0, output: 0, cacheRead: 0 })).toBe("")
  })

  it("só cache lido NÃO rende elemento vazio: sem texto, sem span", () => {
    expect(render({ input: 0, output: 0, cacheRead: 9000 })).toBe("")
  })

  it("entrada e saída aparecem como texto", () => {
    const html = render({ input: 1200, output: 340, cacheRead: 0 })
    expect(html).toContain("↓")
    expect(html).toContain("↑")
  })

  it("o cache lido vive no tooltip, junto da quebra de entrada e saída", () => {
    const html = render({ input: 1200, output: 340, cacheRead: 9000 })
    expect(html).toContain("Cache lido:")
    expect(html).toContain("Entrada:")
    expect(html).toContain("Saída:")
  })

  it("cache RECONSTRUÍDO continua visível: ele é o que custou caro", () => {
    const html = render({
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheCreation: 5000,
    })
    expect(html).toContain("reconstruído")
    expect(html).toContain("text-st-warning")
  })

  it("reconstrução sozinha sustenta o componente", () => {
    const html = render({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 5000,
    })
    expect(html).not.toBe("")
    expect(html).toContain("reconstruído")
  })
})
