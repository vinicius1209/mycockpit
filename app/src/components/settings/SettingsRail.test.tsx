import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { SettingsRail } from "./SettingsRail"
import { secoesDisponiveis } from "./sections"

const rail = (selected: Parameters<typeof SettingsRail>[0]["selected"], facts = {}) =>
  renderToStaticMarkup(
    createElement(SettingsRail, {
      available: secoesDisponiveis(),
      selected,
      facts,
      onSelect: vi.fn(),
    }),
  )

describe("SettingsRail", () => {
  it("mostra todos os domínios, mas só as seções do domínio ativo", () => {
    const html = rail("appearance")
    expect(html).toContain("Você")
    expect(html).toContain("Conversas")
    expect(html).toContain("Segurança")
    expect(html).toContain("Aparência")
    expect(html).toContain("Barra de menus")
    expect(html).not.toContain("Novas conversas")
    expect(html).not.toContain("Confinamento")
  })

  it("deep link de recurso do Mac expande o domínio correto", () => {
    const html = rail("desktop")
    expect(html).toContain("Controle do computador")
    expect(html).toContain("Confinamento")
    expect(html).not.toContain("Barra de menus")
  })

  it("página de motor abre o grupo Motores, com um item por motor", () => {
    const html = rail("motor:agy")
    expect(html).toContain("Todos os motores")
    expect(html).toContain("Antigravity")
    expect(html).toContain("Modelos e preços")
  })

  it("as duas zonas ficam na cara: Neste Mac e No projeto (ADR-268)", () => {
    const html = rail("appearance")
    expect(html).toContain("Neste Mac")
    expect(html).toContain("No projeto")
    // as seções do projeto não escondem atrás de grupo: são três, e o escopo
    // é a própria zona
    expect(html).toContain("MCPs")
    expect(html).toContain("Skills e plugins")
    expect(html).toContain('data-section="resources"')
  })

  it("'Precisa de você' vem primeiro e conta as pendências", () => {
    const semNada = rail("appearance")
    expect(semNada.indexOf("Precisa de você")).toBeLessThan(semNada.indexOf("Neste Mac"))
    const comLogin = rail("appearance", {
      detected: { "claude-code": { installed: true, auth: "missing" } },
    })
    expect(comLogin).toMatch(/Precisa de você<\/span><span[^>]*>1<\/span>/)
  })
})
