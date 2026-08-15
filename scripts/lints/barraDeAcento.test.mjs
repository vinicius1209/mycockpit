import { describe, it, expect } from "vitest"

import { acharBarrasDeAcento, ehFilete, extrairClassNames } from "./barraDeAcento.mjs"

// As duas primeiras fixtures são o MARKUP REAL que o app tinha e que as Fases 1
// e 2 removeram (`git show d827fe9^:…/Sidebar.tsx` e `7f5475e^:…/ContextPanel.tsx`).
// Guarda que só é testada com exemplo inventado prova que ela pega o exemplo
// inventado — a lição do ADR-016.
const BARRA_DA_SIDEBAR = `
          {active && (
            <span className="absolute top-1/2 left-0 h-5 w-[2.5px] -translate-y-1/2 rounded-full bg-brass" />
          )}
`

const SUBLINHADO_DA_ABA = `
      {active && (
        <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-brass" />
      )}
`

describe("guarda da barra de acento (§2, §10 · ADR-043)", () => {
  it("acusa a barra brass de 2,5px que marcava o projeto ativo na sidebar", () => {
    const achados = acharBarrasDeAcento([
      { relPath: "components/layout/Sidebar.tsx", source: BARRA_DA_SIDEBAR },
    ])
    expect(achados).toHaveLength(1)
    expect(achados[0].linha).toBe(3)
  })

  it("acusa também o sublinhado brass da aba ativa, que é o mesmo vício deitado", () => {
    const achados = acharBarrasDeAcento([
      { relPath: "components/layout/ContextPanel.tsx", source: SUBLINHADO_DA_ABA },
    ])
    expect(achados).toHaveLength(1)
  })

  it("acusa a barra montada em pedaços dentro do cn(), não só a de string única", () => {
    const source = `
      <span
        className={cn(
          "absolute left-0 top-1/2 h-5 w-[2.5px] -translate-y-1/2",
          ativo ? "bg-brass" : "bg-transparent",
        )}
      />
    `
    expect(acharBarrasDeAcento([{ relPath: "x.tsx", source }])).toHaveLength(1)
  })

  it("acusa filete de status também: o vício é o filete tingido, não o brass", () => {
    const source = `<span className="absolute inset-y-0 left-0 w-px bg-st-warning" />`
    expect(acharBarrasDeAcento([{ relPath: "x.tsx", source }])).toHaveLength(1)
  })

  it("deixa passar a receita nova: preenchimento neutro + pip, sem tinta", () => {
    const source = `
      <div className={cn("relative flex items-center rounded-md", ativo ? "bg-sel" : "hover:bg-sel-hover")}>
        {ativo && <span className="absolute top-1/2 left-[5px] size-[3px] -translate-y-1/2 rounded-full bg-foreground/70" />}
      </div>
    `
    expect(acharBarrasDeAcento([{ relPath: "x.tsx", source }])).toEqual([])
  })

  it("deixa passar hairline neutro e barra larga tingida: a regra é filete + tinta + aresta", () => {
    const neutro = `<span className="absolute inset-x-0 bottom-0 h-px bg-border" />`
    const larga = `<span className="absolute left-0 h-full w-2 bg-st-warning" />`
    expect(acharBarrasDeAcento([{ relPath: "x.tsx", source: neutro }])).toEqual([])
    expect(acharBarrasDeAcento([{ relPath: "y.tsx", source: larga }])).toEqual([])
  })

  it("deixa passar tinta que não está colada em aresta nenhuma (badge, pílula, ícone)", () => {
    const source = `<span className="absolute -top-1 -right-1 size-2 rounded-full bg-st-warning" />`
    expect(acharBarrasDeAcento([{ relPath: "x.tsx", source }])).toEqual([])
  })

  it("não varre teste: fixture de teste pode conter o markup proibido de propósito", () => {
    const achados = acharBarrasDeAcento([
      { relPath: "components/layout/Sidebar.test.tsx", source: BARRA_DA_SIDEBAR },
    ])
    expect(achados).toEqual([])
  })

  it("mede o arbitrário em px: 3px ainda é filete, 4px já é barra", () => {
    expect(ehFilete("absolute left-0 w-[3px] bg-brass")).toBe(true)
    expect(ehFilete("absolute left-0 w-[4px] bg-brass")).toBe(false)
    expect(ehFilete("absolute left-0 w-px bg-brass")).toBe(true)
    expect(ehFilete("absolute left-0 w-0.5 bg-brass")).toBe(true)
  })

  it("lê as classes por ELEMENTO, senão a barra some entre dois irmãos", () => {
    const source = `
      <div className="absolute inset-y-0 left-0 w-px" />
      <div className="rounded bg-brass" />
    `
    // Duas classes, dois elementos: nenhum deles é a barra.
    expect(extrairClassNames(source)).toHaveLength(2)
    expect(acharBarrasDeAcento([{ relPath: "x.tsx", source }])).toEqual([])
  })
})
