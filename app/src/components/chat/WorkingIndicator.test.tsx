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

  it("troca o genérico por estado factual do processo quando o turno fica mudo", () => {
    const common = {
      agent: "codex",
      presetId: null,
      finalizing: false,
      running: true,
      startedAt: Date.now() - 20_000,
      stalledSince: Date.now() - 10 * 60_000,
    }
    const active = renderToStaticMarkup(
      createElement(WorkingIndicator, {
        ...common,
        runLiveness: {
          mainAlive: true,
          descendants: 2,
          rssMb: 180,
          lastByteAt: null,
          lastEventAt: common.stalledSince,
          observedAt: Date.now(),
        },
      }),
    )
    expect(active).toContain("Processo ativo,")
    expect(active).toContain("sem eventos")
    expect(active).toContain("2 descendentes · 180 MB no grupo")

    const dead = renderToStaticMarkup(
      createElement(WorkingIndicator, {
        ...common,
        runLiveness: {
          mainAlive: false,
          descendants: 0,
          rssMb: 0,
          lastByteAt: null,
          lastEventAt: common.stalledSince,
          observedAt: Date.now(),
        },
      }),
    )
    expect(dead).toContain("Processo encerrou sem concluir o turno")

    const unknown = renderToStaticMarkup(
      createElement(WorkingIndicator, { ...common }),
    )
    expect(unknown).toContain("Não foi possível confirmar o estado do processo,")
  })
})
