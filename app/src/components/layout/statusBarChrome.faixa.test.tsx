import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { DivisorDaFaixa, GatilhoDaFaixa } from "./statusBarChrome"

// ADR-262: "falta separação ou efeito de hover nos itens dessa barra".
describe("as peças da faixa", () => {
  it("o gatilho é uma zona de 24px com hover, e a área cresce para fora", () => {
    const h = renderToStaticMarkup(<GatilhoDaFaixa>hoje</GatilhoDaFaixa>)
    expect(h).toContain("h-6")
    expect(h).toContain("hover:bg-sel")
    expect(h).toContain("-mx-2")
    expect(h).toContain("data-[state=open]:bg-sel")
  })

  it("o gatilho repassa as props e o className (é filho asChild do popover)", () => {
    const h = renderToStaticMarkup(
      <GatilhoDaFaixa aria-label="Gasto" data-state="open" className="gap-2.5">
        x
      </GatilhoDaFaixa>,
    )
    expect(h).toContain('aria-label="Gasto"')
    expect(h).toContain('data-state="open"')
    expect(h).toContain("gap-2.5")
  })

  it("o divisor se esconde na ponta do grupo: nunca fica órfão", () => {
    const h = renderToStaticMarkup(<DivisorDaFaixa />)
    expect(h).toContain("first:hidden")
    expect(h).toContain("last:hidden")
    expect(h).toContain("border-border/40")
  })
})
