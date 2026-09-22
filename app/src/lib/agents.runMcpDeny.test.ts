import { describe, expect, it } from "vitest"
import { AGENTS, agentDef } from "./agents"

// Gêmeo de `matriz_run_mcp_deny_por_agent`. Medido no claude 2.1.280 em
// 22/09/2026: `mcp__playwright` no `--disallowedTools` tira as 25 tools do
// Playwright do turno. Quem não provou, declara `false` e só nomeia.
const nega: Record<string, boolean> = {
  "claude-code": true,
  codex: false,
  agy: false,
  opencode: false,
}

describe("negar MCP do cadastro global por turno", () => {
  for (const [id, esperado] of Object.entries(nega)) {
    it(`${id}: espelha o registry do Rust`, () => {
      expect(agentDef(id)?.runMcpDeny).toBe(esperado)
    })
  }
  it("motor fora da matriz não ganha a capability por omissão", () => {
    for (const agent of AGENTS.filter((a) => !(a.id in nega))) {
      expect(agent.runMcpDeny).toBe(false)
    }
  })
})
