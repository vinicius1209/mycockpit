import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ContextPanelTabs } from "./contextPanelChrome"

describe("a navegação do painel direito", () => {
  it("mantém a ordem Arquivos, Conversa, Alterações, Bastidores e Contexto", () => {
    const html = renderToStaticMarkup(
      <ContextPanelTabs tab="conversa" changedCount={2} onSelect={() => {}} />,
    )

    const files = html.indexOf("Arquivos")
    const conversation = html.indexOf("Conversa")
    const changes = html.indexOf("Alterações")
    const background = html.indexOf("Bastidores")
    const context = html.indexOf("Contexto")

    expect(files).toBeGreaterThan(-1)
    expect(files).toBeLessThan(conversation)
    expect(conversation).toBeLessThan(changes)
    expect(changes).toBeLessThan(background)
    expect(background).toBeLessThan(context)
    expect(html).toContain(">2</span>")
  })

  it("preserva o nome acessível quando a largura mostra apenas ícones", () => {
    const html = renderToStaticMarkup(
      <ContextPanelTabs tab="arquivos" changedCount={0} onSelect={() => {}} />,
    )

    expect(html).toContain('aria-label="Arquivos"')
    expect(html).toContain('title="Arquivos"')
    // Limiar medido para CINCO rótulos inteiros com o pior contador (ADR-200);
    // era 400px com quatro abas de largura igual.
    expect(html).toContain("@min-[492px]:inline")
  })
})
