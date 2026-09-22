// Gêmeo de `matriz_mcp_escopo_por_agent` (adapters.rs). O escopo decide a
// frase de Configurações: "pelo MCP do projeto" só vale para `por-run`.
import { describe, expect, it } from "vitest"
import { AGENTS, agentDef } from "./agents"

describe("mcpEscopo no espelho TS", () => {
  it("espelha a matriz do Rust", () => {
    const matriz: Record<string, string> = {
      "claude-code": "por-run", codex: "por-run", agy: "global", opencode: "por-projeto",
    }
    for (const [id, escopo] of Object.entries(matriz)) {
      expect(agentDef(id)?.mcpEscopo, id).toBe(escopo)
    }
  })
  it("todo registro declara um valor do eixo", () => {
    for (const a of AGENTS) {
      expect(["por-run", "por-projeto", "global", "nenhum"], a.id).toContain(a.mcpEscopo)
    }
  })
})
