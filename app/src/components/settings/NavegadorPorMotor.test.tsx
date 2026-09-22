// ADR-224 §4: a frase vem do ESCOPO de MCP do motor, e o gesto certo aparece
// só onde tem efeito. Antes, a tela mandava o agy vincular binding.
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { AGENTS } from "@/lib/agents"
import { NavegadorPorMotor, comoONavegadorChega } from "./NavegadorPorMotor"

vi.mock("@/lib/workMcpSetup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workMcpSetup")>()),
  browserMcpStatus: vi.fn(async () => ({ agent: "agy", state: "absent", checkedAt: 0, detail: null })),
  setBrowserMcpEnabled: vi.fn(),
}))

describe("por onde o navegador da Frota chega", () => {
  it("motor por run recebe pelo frota-browser e pelo MCP do projeto", () => {
    expect(comoONavegadorChega({ mcpEscopo: "por-run", workMcpGlobalEnv: false })).toContain("MCP do projeto")
  })
  it("motor de cadastro global recebe pelo CLI, e nunca é mandado vincular binding", () => {
    const frase = comoONavegadorChega({ mcpEscopo: "global", workMcpGlobalEnv: true })
    expect(frase).toContain("cadastrado no CLI")
    expect(frase).not.toContain("binding")
  })
  it("motor sem caminho diz que não tem, em vez de prometer", () => {
    expect(comoONavegadorChega({ mcpEscopo: "por-projeto", workMcpGlobalEnv: false })).toContain("ainda sem caminho")
  })
  it("uma linha por motor disponível; o gesto do cadastro só nos de cadastro global", () => {
    const html = renderToStaticMarkup(<NavegadorPorMotor agents={AGENTS} />)
    for (const a of AGENTS.filter((a) => a.kind === "agent" && a.available)) {
      expect(html).toContain(a.shortLabel)
    }
    expect((html.match(/Reverificar o navegador da Frota/g) ?? []).length).toBe(
      AGENTS.filter((a) => a.kind === "agent" && a.available && a.workMcpGlobalEnv).length,
    )
  })
})
