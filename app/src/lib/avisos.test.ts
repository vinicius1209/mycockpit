import { describe, expect, it, vi } from "vitest"

vi.mock("@/store/app", () => ({ useApp: { getState: () => ({ projects: [] }) } }))
vi.mock("@/store/chat", () => ({ useChat: { getState: () => ({ byId: {}, conversationsByProject: {}, conversations: [] }) } }))

import { mensagemDe, resolverIdentidade } from "./avisos"

const projetos = [
  { id: "p1", name: "Maclan", path: "/repo/maclan", color: "#5b8def" },
  { id: "p2", name: "sicredi", path: "/repo/sicredi", color: null },
]
const chat = {
  byId: { c1: { projectId: "p2" } },
  conversationsByProject: { p2: [{ id: "c1", title: "Revisar o PR 214" }] },
  conversations: [],
}

// ADR-261: o aviso diz de quem é. "Navegador do projeto ligado", mas qual?
describe("a identidade do aviso", () => {
  it("projeto por caminho ou por id, com a cor", () => {
    expect(resolverIdentidade({ projeto: "/repo/maclan" }, projetos, chat)).toEqual({
      projeto: "Maclan",
      cor: "#5b8def",
      conversa: null,
      projectId: "p1",
    })
    expect(resolverIdentidade({ projeto: "p1" }, projetos, chat)?.projeto).toBe("Maclan")
  })

  it("só a conversa basta: o projeto vem dela, e o título entra", () => {
    expect(resolverIdentidade({ conversa: "c1" }, projetos, chat)).toMatchObject({
      projeto: "sicredi",
      conversa: "Revisar o PR 214",
      cor: null,
    })
  })

  it("sem dono conhecido, não inventa um", () => {
    expect(resolverIdentidade({ projeto: "/outro" }, projetos, chat)).toBeNull()
    expect(resolverIdentidade(undefined, projetos, chat)).toBeNull()
  })

  it("a mensagem de uma falha sai legível de Error, texto ou objeto", () => {
    expect(mensagemDe(new Error("sem Chromium"))).toBe("sem Chromium")
    expect(mensagemDe("porta ocupada")).toBe("porta ocupada")
    expect(mensagemDe({ code: 3 })).toBe('{"code":3}')
  })
})
