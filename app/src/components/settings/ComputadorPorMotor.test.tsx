// ADR-225: o agy controlava o computador pelo `computer-use` do Codex, por
// fora do pedido e do Revogar, e conectar o controle da Frota exigia terminal.
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { AGENTS } from "@/lib/agents"
import { ComputadorPorMotor, comoOComputadorChega, fraseDoTerceiro } from "./ComputadorPorMotor"

vi.mock("@/lib/workMcpSetup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workMcpSetup")>()),
  desktopMcpStatus: vi.fn(async () => ({ agent: "agy", state: "absent", checkedAt: 0, detail: null })),
  setDesktopMcpEnabled: vi.fn(),
}))
vi.mock("@/lib/resources", () => ({
  desktopExternalControllers: vi.fn(async () => []),
  setDesktopExternalEnabled: vi.fn(),
}))

describe("por onde o controle do computador chega", () => {
  it("motor por run recebe o frota-desktop em todo turno", () => {
    expect(comoOComputadorChega({ mcpEscopo: "por-run", workMcpGlobalEnv: false })).toContain("em todo turno")
  })
  it("motor de cadastro global recebe pelo CLI, com o gesto na tela", () => {
    expect(comoOComputadorChega({ mcpEscopo: "global", workMcpGlobalEnv: true })).toContain("cadastrado no CLI")
  })
  it("motor sem caminho diz que não tem, em vez de prometer", () => {
    expect(comoOComputadorChega({ mcpEscopo: "por-projeto", workMcpGlobalEnv: false })).toContain("ainda sem caminho")
  })
  it("terceiro ligado é dito como fora da Frota, sem pedido e sem Revogar", () => {
    const frase = fraseDoTerceiro({ name: "computer-use", enabled: true, manageable: true }, "Antigravity")
    expect(frase).toContain("computer-use")
    expect(frase).toContain("sem pedido na tela e sem Revogar")
    expect(frase).not.toContain("fora do alcance")
  })
  it("terceiro que a Frota não altera diz de onde vem, e desativado não assusta", () => {
    expect(fraseDoTerceiro({ name: "computer-use", enabled: true, manageable: false }, "Claude")).toContain("fora do alcance da Frota")
    expect(fraseDoTerceiro({ name: "computer-use", enabled: false, manageable: true }, "Antigravity")).toBe(
      "computer-use está desativado no Antigravity.",
    )
  })
  it("uma linha por motor disponível; o cadastro só nos de cadastro global", () => {
    const html = renderToStaticMarkup(<ComputadorPorMotor agents={AGENTS} />)
    for (const a of AGENTS.filter((a) => a.kind === "agent" && a.available)) {
      expect(html).toContain(a.shortLabel)
    }
    expect((html.match(/Reverificar o controle do computador da Frota/g) ?? []).length).toBe(
      AGENTS.filter((a) => a.kind === "agent" && a.available && a.workMcpGlobalEnv).length,
    )
  })
})
