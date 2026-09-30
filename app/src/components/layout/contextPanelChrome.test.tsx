import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ContextPanelTabs } from "./contextPanelChrome"

describe("a navegação do painel direito", () => {
  it("mantém a ordem Arquivos, Conversa, Alterações, Bastidores e O que o agente vê", () => {
    const html = renderToStaticMarkup(
      <ContextPanelTabs tab="conversa" changedCount={2} onSelect={() => {}} />,
    )

    const files = html.indexOf("Arquivos")
    const conversation = html.indexOf("Conversa")
    const changes = html.indexOf("Alterações")
    const background = html.indexOf("Bastidores")
    // a aba Contexto virou "O que o agente vê" (ADR-237); a ordem não muda
    const context = html.indexOf("O que o agente vê")

    expect(files).toBeGreaterThan(-1)
    expect(files).toBeLessThan(conversation)
    expect(conversation).toBeLessThan(changes)
    expect(changes).toBeLessThan(background)
    expect(background).toBeLessThan(context)
    expect(html).toContain(">2</span>")
  })

  it("usa sempre apenas ícones preservando o nome acessível e tooltip", () => {
    const html = renderToStaticMarkup(
      <ContextPanelTabs tab="arquivos" changedCount={0} onSelect={() => {}} />,
    )

    expect(html).toContain('aria-label="Arquivos"')
    expect(html).toContain('title="Arquivos"')
    expect(html).not.toContain("@min-[492px]:inline")
  })
})
