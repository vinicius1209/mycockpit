import { describe, it, expect } from "vitest"

import {
  contarFiletesDerivados,
  ehCanonico,
  foraDoAlcance,
  inventario,
} from "./filete.mjs"

// Classes REAIS colhidas na varredura de 29/08/2026, que achou 14 cores de
// borda distintas em app/src (ADR-016: fixture inventada só prova que a guarda
// pega a fixture inventada).

/** `McpSettings.tsx` — a ARESTA mais comum fora do canônico. */
const ARESTA_DERIVADA =
  "rounded-lg border border-border/60 bg-secondary/20 p-4 text-[13px] text-muted-foreground"

/** `MessageList.tsx` — um DIVISOR, e ele já está no papel certo. */
const DIVISOR_CANONICO = "mt-2.5 flex flex-wrap items-center border-t border-border/40 pt-2"

/** `MessageList.tsx` — o mesmo divisor, no degrau que ninguém decidiu. */
const DIVISOR_DERIVADO = "ml-[7px] border-l border-border/45 pl-2.5"

describe("guarda do filete (§4, §14)", () => {
  it("aceita os dois papéis do set fechado", () => {
    expect(ehCanonico("border-border")).toBe(true)
    expect(ehCanonico("border-border/40")).toBe(true)
  })

  it("recusa os degraus de opacidade que ninguém decidiu", () => {
    for (const op of [30, 45, 50, 55, 60, 70, 80]) {
      expect(ehCanonico(`border-border/${op}`), `/${op}`).toBe(false)
    }
  })

  it("recusa token de borda que não é o da casa", () => {
    expect(ehCanonico("border-input")).toBe(false)
    expect(ehCanonico("border-foreground/25")).toBe(false)
  })

  it("conta aresta e divisor derivados, e ignora o canônico", () => {
    const contagem = contarFiletesDerivados([
      {
        relPath: "components/settings/McpSettings.tsx",
        source: `const a = "${ARESTA_DERIVADA}"\nconst b = "${DIVISOR_CANONICO}"`,
      },
      { relPath: "components/chat/MessageList.tsx", source: `const c = "${DIVISOR_DERIVADO}"` },
    ])
    expect(contagem).toEqual({
      "components/settings/McpSettings.tsx": 1,
      "components/chat/MessageList.tsx": 1,
    })
  })

  it("não conta `border` pelado, que é a aresta canônica", () => {
    const contagem = contarFiletesDerivados([
      { relPath: "components/chat/A.tsx", source: `const a = "rounded-lg border bg-card p-3"` },
    ])
    expect(contagem).toEqual({})
  })

  it("deixa components/ui de fora: é lá que o primitivo shadcn mora", () => {
    expect(foraDoAlcance("components/ui/dialog.tsx")).toBe(true)
    expect(foraDoAlcance("components/chat/MessageList.test.tsx")).toBe(true)
    expect(foraDoAlcance("components/chat/MessageList.tsx")).toBe(false)
  })

  it("o inventário diz O QUE migrar, não só quanto", () => {
    const uso = inventario([
      { relPath: "a.tsx", source: `"${ARESTA_DERIVADA}" "${DIVISOR_DERIVADO}"` },
    ])
    expect(uso).toEqual({ "border-border/60": 1, "border-border/45": 1 })
  })
})
