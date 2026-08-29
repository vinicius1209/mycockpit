import { describe, it, expect } from "vitest"

import {
  compararComBaseline,
  contarControlesAMao,
  ehGeometriaDeControle,
  foraDoAlcance,
} from "./geometriaDeControle.mjs"

// As fixtures são classes REAIS do app, colhidas na varredura de 29/08/2026
// que mediu 43 geometrias distintas em 75 arquivos (ADR-016: fixture inventada
// prova que a guarda pega a fixture inventada).

/** `StickyNotesDock.tsx` — o botão de ícone da gaveta, 24px. */
const ICONE_DA_GAVETA =
  "grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"

/** `StickyNotesDock.tsx` — a pill de escopo: o `px-1.5 py-0.5` mais comum. */
const PILL_DE_ESCOPO =
  "flex shrink-0 items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors enabled:hover:bg-accent"

/** `UsagePill.tsx` — a pill da faixa, com altura vinda só do padding. */
const PILL_DA_FAIXA =
  "pointer-events-auto hidden items-center gap-1.5 rounded-full border bg-secondary/50 px-2.5 py-1 text-[12px] transition-colors hover:text-foreground sm:flex"

describe("guarda de geometria de controle (§13)", () => {
  it("reconhece o controle quadrado de 24px", () => {
    expect(ehGeometriaDeControle(ICONE_DA_GAVETA)).toBe(true)
  })

  it("reconhece o controle cuja altura vem do padding", () => {
    expect(ehGeometriaDeControle(PILL_DE_ESCOPO)).toBe(true)
    expect(ehGeometriaDeControle(PILL_DA_FAIXA)).toBe(true)
  })

  it("não confunde ÍCONE com controle", () => {
    // 12 a 16px é glifo. Cobrar degrau de escada de um `<svg>` seria a guarda
    // pedindo a coisa errada, e guarda que pede errado ensina a ignorar guarda.
    expect(ehGeometriaDeControle("size-3.5 shrink-0 transition-transform")).toBe(false)
    expect(ehGeometriaDeControle("size-4 text-brass transition-colors")).toBe(false)
  })

  it("não conta o que não é interativo", () => {
    // Um cartão tem padding dos dois lados e não é controle.
    expect(ehGeometriaDeControle("rounded-lg border px-3 py-2 bg-card")).toBe(false)
  })

  it("deixa components/ui de fora, que é onde a escada é DECLARADA", () => {
    expect(foraDoAlcance("components/ui/button.tsx")).toBe(true)
    expect(foraDoAlcance("components/ui/controle.ts")).toBe(true)
    expect(foraDoAlcance("components/notes/StickyNotesDock.test.tsx")).toBe(true)
    expect(foraDoAlcance("components/notes/StickyNotesDock.tsx")).toBe(false)
  })

  it("conta por arquivo", () => {
    const contagem = contarControlesAMao([
      {
        relPath: "components/notes/StickyNotesDock.tsx",
        source: `const a = "${ICONE_DA_GAVETA}"\nconst b = "${PILL_DE_ESCOPO}"`,
      },
      { relPath: "components/ui/button.tsx", source: `const c = "${PILL_DA_FAIXA}"` },
    ])
    expect(contagem).toEqual({ "components/notes/StickyNotesDock.tsx": 2 })
  })

  it("catraca: acusa quem subiu e quem é novo, e registra quem desceu", () => {
    const { piorou, folgou } = compararComBaseline(
      { "a.tsx": 3, "b.tsx": 1, "novo.tsx": 2 },
      { "a.tsx": 2, "b.tsx": 4, "sumiu.tsx": 5 },
    )
    expect(piorou).toEqual([
      { relPath: "a.tsx", de: 2, para: 3, novo: false },
      { relPath: "novo.tsx", de: 0, para: 2, novo: true },
    ])
    expect(folgou).toEqual([
      { relPath: "b.tsx", de: 4, para: 1 },
      { relPath: "sumiu.tsx", de: 5, para: 0 },
    ])
  })

  it("arquivo novo nasce em ZERO, que é a metade que importa", () => {
    const { piorou } = compararComBaseline({ "novo.tsx": 1 }, {})
    expect(piorou).toEqual([{ relPath: "novo.tsx", de: 0, para: 1, novo: true }])
  })
})
