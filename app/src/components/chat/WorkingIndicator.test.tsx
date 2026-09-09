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

  it("mantém está trabalhando… quando há ferramenta em andamento", () => {
    const html = renderToStaticMarkup(
      createElement(WorkingIndicator, {
        agent: "agy",
        presetId: null,
        finalizing: false,
        running: true,
        startedAt: Date.now() - 5000,
        nodes: [
          {
            type: "tools",
            key: "group-1",
            tools: [
              {
                kind: "tool" as const,
                id: "t1",
                toolId: "t1",
                name: "grep_search",
                input: {},
                result: undefined,
              },
            ],
          },
        ],
      }),
    )
    expect(html).toContain("está trabalhando…")
  })

  it("mostra sintetizando resposta após N ações quando todas as ferramentas terminaram", () => {
    const html = renderToStaticMarkup(
      createElement(WorkingIndicator, {
        agent: "agy",
        presetId: null,
        finalizing: false,
        running: true,
        startedAt: Date.now() - 5000,
        nodes: [
          {
            type: "tools",
            key: "group-1",
            tools: Array.from({ length: 14 }, (_, i) => ({
              kind: "tool" as const,
              id: `t${i}`,
              toolId: `t${i}`,
              name: "read_file",
              input: {},
              result: { ok: true, text: "ok", lines: 1 },
            })),
          },
        ],
      }),
    )
    expect(html).toContain("sintetizando resposta após 14 ações…")
  })
})
