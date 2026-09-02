import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { WorkingIndicator } from "./WorkingIndicator"

describe("WorkingIndicator — indicador de atividade viva", () => {
  it("renderiza standalone por padrão com avatar e nome do executor", () => {
    const html = renderToStaticMarkup(
      createElement(WorkingIndicator, {
        agent: "agy",
        presetId: null,
        finalizing: false,
        running: true,
        startedAt: Date.now() - 5000,
      }),
    )
    expect(html).toContain("Antigravity")
    expect(html).toContain("está trabalhando…")
    expect(html).toContain("w-7 shrink-0")
  })

  it("modo inline renderiza apenas a linha viva sem gutter nem nome duplicado", () => {
    const html = renderToStaticMarkup(
      createElement(WorkingIndicator, {
        agent: "agy",
        presetId: null,
        finalizing: false,
        running: true,
        startedAt: Date.now() - 5000,
        inline: true,
      }),
    )
    expect(html).toContain("está trabalhando…")
    expect(html).not.toContain("w-7 shrink-0")
    expect(html).not.toContain("Antigravity")
  })
})
