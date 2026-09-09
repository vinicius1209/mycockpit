import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { McpAgentRows } from "./McpAgentRows"
import { gestoDaLinha, mcpAgentStatusLabel, rotuloDaAcao, type McpAgentState, type McpServer } from "@/lib/mcp"

// Inventário real: `agy mcp list`, 08/09/2026: computer-use stdio enabled.
// Variantes abaixo exercitam indisponibilidade e alterações externas desse estado.
const state: McpAgentState = {
  agent: "agy", compatible: false, roteavelPeloApp: false, roteiaMcpGerenciado: false,
  escopo: "global", cliInstallation: "enabled", enabled: false, required: false,
  browser: false, fallback: "ask", health: "unchecked", detail: null, checkedAt: null,
}
const server: McpServer = {
  id: "computer-use", name: "computer-use", source: "claude", scope: "user",
  transport: "stdio", locator: "", envKeys: [], sourceAgent: "claude-code",
  sourceEnabled: true, managed: true, portable: true, nativeReason: null,
  literalSecret: false, runtimeName: null, agentStates: [state],
}
function render(row: McpAgentState) {
  return renderToStaticMarkup(<McpAgentRows server={{ ...server, agentStates: [row] }}
    browser={null} busyKeys={new Set()} checkingKeys={new Set()} instalandoKeys={new Set()}
    onUpdate={vi.fn()} onCheck={vi.fn()} onInstalarNoCli={vi.fn()} />)
}

describe("instalação global de MCP reconciliada com o CLI", () => {
  it("oferece remover quando instalado, sem interruptor desligado nem check de conexão", () => {
    const html = render(state)
    expect(html).toContain("habilitado no CLI (global)")
    expect(html).toContain("Remover do CLI")
    expect(html).not.toContain('role="switch"')
    expect(html).not.toContain("text-st-success")
    expect(html).not.toContain("Instalar no CLI")
    expect(html).toContain("para todos os projetos")
  })

  it("uma entrada desabilitada continua instalada e pode ser removida", () => {
    const row = { ...state, cliInstallation: "disabled" as const }
    expect(mcpAgentStatusLabel(server, row)).toContain("desabilitado")
    expect(rotuloDaAcao(gestoDaLinha(row))).toBe("Remover do CLI")
  })

  it("ausência confirmada libera instalar; falha de inventário não libera escrita", () => {
    expect(render({ ...state, cliInstallation: "absent" })).toContain("Instalar no CLI")
    const html = render({ ...state, cliInstallation: "unknown" })
    expect(html).toContain("inventário do CLI não confirmado")
    expect(html).not.toContain("Instalar no CLI")
    expect(html).not.toContain("Remover do CLI")
  })

  it("vínculo antigo no banco não expõe exigir/navegador para o escopo global", () => {
    const html = render({ ...state, enabled: true, required: true, browser: true })
    expect(html).not.toContain("exigir")
    expect(html).not.toContain("usar navegador")
  })

  it("o controle por run conserva seu interruptor e sua saúde própria", () => {
    const html = render({ ...state, agent: "codex", escopo: "por-run", compatible: true,
      roteiaMcpGerenciado: true, cliInstallation: null, enabled: true, health: "healthy" })
    expect(html).toContain('role="switch"')
    expect(html).toContain("text-st-success")
    expect(html).not.toContain("Remover do CLI")
  })
})
