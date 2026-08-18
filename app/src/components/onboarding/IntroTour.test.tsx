import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { IntroTour } from "./IntroTour"

// Render estático só alcança o 1º ato (o índice vive em useState); a
// navegação entre atos é coberta pela conferência visual no dev ao vivo.
function render() {
  return renderToStaticMarkup(<IntroTour onDone={() => {}} />)
}

describe("o 1º ato do tour", () => {
  it("mostra o headline e a ilustração dos três motores", () => {
    const html = render()
    expect(html).toContain("Um cockpit, três motores")
    expect(html).toContain("Claude Code")
    expect(html).toContain("Codex")
    expect(html).toContain("Antigravity")
    expect(html).toContain("Continuar no Codex")
  })

  it("mostra o contador do tour, não o do wizard", () => {
    expect(render()).toContain("Ato 1 de 4")
  })

  it("não mostra Voltar no 1º ato (nada pra onde voltar)", () => {
    expect(render()).not.toContain("Voltar")
  })
})
