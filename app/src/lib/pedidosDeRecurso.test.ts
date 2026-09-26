import { describe, expect, it, vi } from "vitest"

vi.mock("@/store/app", () => ({ useApp: { getState: () => ({ projects: [{ id: "p1", name: "Maclan", path: "/repo/maclan" }] }) } }))

import { nomeDoProjeto, pedidoDeRecurso, registroDaDecisao, textoDoPedido } from "./pedidosDeRecurso"

// Visto em 25/09/2026: "Navegador do projeto ligado", mas qual projeto?
describe("o texto do pedido de recurso diz de qual projeto é", () => {
  const navegador = { recurso: "navegador" as const, convId: "c1", projectPath: "/repo/maclan" }

  it("navegador: título, botão e resumo com o nome do projeto", () => {
    const t = textoDoPedido(navegador, nomeDoProjeto(navegador.projectPath))
    expect(t.titulo).toBe("Usar o navegador do Maclan")
    expect(t.sim).toBe("Ligar navegador")
    expect(t.resumo).toBe("Ligar o navegador do Maclan")
    expect(t.detalhe).toContain("espera até 90 s")
  })

  it("computador: vale para o turno, e o botão diz isso", () => {
    const t = textoDoPedido({ recurso: "computador", convId: "c1" }, null)
    expect(t.sim).toBe("Liberar neste turno")
    expect(t.detalhe).toContain("só para este turno")
  })

  it("a linha que fica no fio registra a decisão com o objeto", () => {
    expect(registroDaDecisao(navegador, "Maclan", true)).toBe("Você ligou o navegador do Maclan.")
    expect(registroDaDecisao(navegador, "Maclan", false)).toBe("Você preferiu não ligar o navegador do Maclan.")
    expect(registroDaDecisao({ recurso: "computador", convId: "c1" }, null, true)).toBe(
      "Você liberou o computador para este turno.",
    )
  })

  it("o pedido tem id por recurso e run: o mesmo pedido nunca aparece duas vezes", () => {
    const a = pedidoDeRecurso("navegador", { runId: "r1", convId: "c1", projectPath: "/repo/maclan" })
    expect(a.id).toBe("recurso:navegador:r1")
    expect(pedidoDeRecurso("computador", { runId: "r1", convId: "c1" }).id).toBe("recurso:computador:r1")
  })
})
