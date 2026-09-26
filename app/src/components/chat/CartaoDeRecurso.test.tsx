import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/store/app", () => ({
  useApp: { getState: () => ({ projects: [{ id: "p1", name: "Maclan", path: "/repo/maclan" }] }) },
}))

import { CartaoDeRecurso } from "./CartaoDeRecurso"

const origem = { convId: "c1", projectId: "p1", projectName: "Maclan", convTitle: "Landing nova" }
const navegador = { recurso: "navegador" as const, convId: "c1", projectPath: "/repo/maclan" }

// ADR-261: o pedido que era toast em cima do composer, com o ✕ fazendo a recusa.
describe("o cartão do pedido de recurso", () => {
  const html = (compact: boolean) =>
    renderToStaticMarkup(
      <CartaoDeRecurso data={navegador} origin={origem} compact={compact} extra={0} onDecide={() => {}} />,
    )

  it("diz de quem é e o que foi pedido, com o projeto pelo nome", () => {
    const h = html(false)
    expect(h).toContain("Maclan")
    expect(h).toContain("Landing nova")
    expect(h).toContain("Usar o navegador do Maclan")
    expect(h).toContain("esperando")
  })

  it("a recusa é um botão (\"Agora não\"), e não há ✕ que recuse sem querer", () => {
    const h = html(false)
    expect(h).toContain(">Agora não<")
    expect(h).toContain(">Ligar navegador<")
    expect(h).not.toContain("Dispensar")
  })

  it("no canto, sem o detalhe e com o caminho até a conversa", () => {
    const h = html(true)
    expect(h).not.toContain("Chromium")
    expect(h).toContain("Abrir")
  })
})
