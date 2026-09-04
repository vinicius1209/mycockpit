import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ContextPanelTabs } from "./contextPanelChrome"

describe("a navegação do painel direito", () => {
  it("mantém a ordem Arquivos, Plano, Alterações e Contexto", () => {
    const html = renderToStaticMarkup(
      <ContextPanelTabs tab="plano" changedCount={2} onSelect={() => {}} />,
    )

    const files = html.indexOf("Arquivos")
    const plan = html.indexOf("Plano")
    const changes = html.indexOf("Alterações")
    const context = html.indexOf("Contexto")

    expect(files).toBeGreaterThan(-1)
    expect(files).toBeLessThan(plan)
    expect(plan).toBeLessThan(changes)
    expect(changes).toBeLessThan(context)
    expect(html).toContain(">2</span>")
  })

  it("preserva o nome acessível quando a largura mostra apenas ícones", () => {
    const html = renderToStaticMarkup(
      <ContextPanelTabs tab="arquivos" changedCount={0} onSelect={() => {}} />,
    )

    expect(html).toContain('aria-label="Arquivos"')
    expect(html).toContain('title="Arquivos"')
    expect(html).toContain("@min-[400px]:inline")
  })
})
