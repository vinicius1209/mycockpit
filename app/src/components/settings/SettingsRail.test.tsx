import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { SettingsRail } from "./SettingsRail"
import { secoesDisponiveis } from "./sections"

describe("SettingsRail", () => {
  it("mostra todos os domínios, mas só as seções do domínio ativo", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsRail, {
        available: secoesDisponiveis(),
        selected: "appearance",
        facts: {},
        onSelect: vi.fn(),
      }),
    )
    expect(html).toContain("Interface")
    expect(html).toContain("Conversas")
    expect(html).toContain("Capacidades")
    expect(html).toContain("Aparência")
    expect(html).toContain("Barra de menus")
    expect(html).not.toContain("Novas conversas")
    expect(html).not.toContain("Navegador e desktop")
  })

  it("deep link de recurso expande o domínio correto", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsRail, {
        available: secoesDisponiveis(),
        selected: "resources",
        facts: {},
        onSelect: vi.fn(),
      }),
    )
    expect(html).toContain("Navegador e desktop")
    expect(html).toContain("Confinamento")
    expect(html).not.toContain("MCPs")
  })
})
