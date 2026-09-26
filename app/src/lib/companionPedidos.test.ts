import { describe, expect, it, vi } from "vitest"

vi.mock("@/store/app", () => ({
  useApp: { getState: () => ({ projects: [{ id: "p1", name: "Maclan", path: "/repo/maclan" }] }) },
}))

import { atencaoDaFila } from "./companionPedidos"
import { pedidoDeRecurso } from "./pedidosDeRecurso"

// ADR-261: o pedido de recurso chega ao celular como aprovação, com o que foi
// pedido no lugar do comando, e é respondido pelo mesmo answer_interaction.
describe("pedido de recurso no Companion", () => {
  it("vira cartão de aprovação da conversa e do projeto donos", () => {
    const req = pedidoDeRecurso("navegador", { runId: "r1", convId: "c1", projectPath: "/repo/maclan" })
    const [a] = atencaoDaFila([req], {
      chat: { byId: { c1: { runId: "r1", agent: "codex" } } },
      missions: { byConv: {} },
      projects: [{ id: "p1", name: "Maclan", path: "/repo/maclan" }],
      projectOf: () => "p1",
      nameOf: () => "Maclan",
    })
    expect(a).toMatchObject({
      id: "recurso:navegador:r1",
      kind: "approval",
      convId: "c1",
      projectName: "Maclan",
      agent: "codex",
      command: "Ligar o navegador do Maclan",
    })
  })
})
