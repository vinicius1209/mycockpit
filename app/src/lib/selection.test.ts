import { describe, it, expect } from "vitest"
import { SELECTED_FILL, UNSELECTED, SELECTED_ON_SURFACE } from "./selection"

// A receita de "escolhido" é o mecanismo que a Fase 5 pôs no lugar de dezesseis
// cópias divergentes. Se ela voltar a ter tinta, o âmbar volta a ter dois donos
// — e é isso que estes casos travam, no VALOR, não no uso.
const TINTA = /brass|st-warning|st-queued|st-success|st-error|st-running|id-violet/

describe("receita única de seleção (ADR-043 §2)", () => {
  it("escolhido não tem tinta nenhuma: nem brass, nem cor de status", () => {
    expect(SELECTED_FILL).not.toMatch(TINTA)
    expect(SELECTED_ON_SURFACE).not.toMatch(TINTA)
    expect(UNSELECTED).not.toMatch(TINTA)
  })

  it("escolhido é preenchimento neutro + peso + texto foreground", () => {
    expect(SELECTED_FILL).toContain("bg-sel")
    expect(SELECTED_FILL).toContain("font-medium")
    expect(SELECTED_FILL).toContain("text-foreground")
  })

  it("hover é convite e seleção é fato: o não-escolhido usa --sel-hover, nunca --sel", () => {
    expect(UNSELECTED).toContain("hover:bg-sel-hover")
    // `bg-sel` cru no estado de repouso faria disponível parecer escolhido.
    expect(UNSELECTED).not.toMatch(/(^|\s)bg-sel(\s|$)/)
  })

  it("quem já tem superfície própria marca pelo aro, sem trocar o preenchimento", () => {
    expect(SELECTED_ON_SURFACE).toContain("border-border-strong")
    expect(SELECTED_ON_SURFACE).toContain("var(--sel)")
    // Trocar `bg-card` por `bg-sel` apagaria a superfície do cartão.
    expect(SELECTED_ON_SURFACE).not.toContain("bg-sel")
  })
})
