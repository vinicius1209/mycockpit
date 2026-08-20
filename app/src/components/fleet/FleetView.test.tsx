// Rollup "Frota": a lógica de "quais linhas mostrar" (parseFleetKey) e o
// RENDER de uma linha (FleetRowItem) são testados isolados da store — ver o
// comentário no topo de FleetView.tsx pro motivo (useSyncExternalStore em SSR
// lê getInitialState do zustand v5, não o estado atual; testar o container
// conectado via renderToStaticMarkup daria falso positivo, sempre vazio).

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { FleetRowItem, parseFleetKey } from "./FleetView"

describe("parseFleetKey", () => {
  it("chave vazia não produz linha nenhuma", () => {
    expect(parseFleetKey("")).toEqual([])
  })

  it("uma linha: id, projeto, agent e início", () => {
    expect(parseFleetKey("c1:p1:claude-code:1000")).toEqual([
      { id: "c1", projectId: "p1", agent: "claude-code", startedAt: 1000 },
    ])
  })

  it("sem início (startedAt vazio) vira null, não NaN", () => {
    expect(parseFleetKey("c1:p1:codex:")).toEqual([
      { id: "c1", projectId: "p1", agent: "codex", startedAt: null },
    ])
  })

  it("várias linhas, uma por '|'", () => {
    const rows = parseFleetKey("c1:p1:claude-code:1000|c2:p2:codex:2000")
    expect(rows).toHaveLength(2)
    expect(rows[0].id).toBe("c1")
    expect(rows[1].id).toBe("c2")
  })
})

describe("FleetRowItem — render por props (sem tocar a store)", () => {
  it("mostra título, projeto e tempo relativo", () => {
    const agora = 1_700_000_120_000
    const html = renderToStaticMarkup(
      createElement(FleetRowItem, {
        agent: "claude-code",
        projectName: "meuingresso3.0",
        title: "Landing page",
        startedAt: agora - 60_000,
        agora,
        onOpen: vi.fn(),
      }),
    )
    expect(html).toContain("Landing page")
    expect(html).toContain("meuingresso3.0")
    expect(html).toContain("há 1 min")
  })

  it("sem startedAt, não escreve tempo nenhum (nunca 'NaN')", () => {
    const html = renderToStaticMarkup(
      createElement(FleetRowItem, {
        agent: "codex",
        projectName: "cockpit",
        title: "Fix do parser",
        startedAt: null,
        agora: Date.now(),
        onOpen: vi.fn(),
      }),
    )
    expect(html).not.toContain("NaN")
  })
})
