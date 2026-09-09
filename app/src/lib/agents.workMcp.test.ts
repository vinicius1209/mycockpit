import { describe, expect, it } from "vitest"
import { AGENTS, agentDef } from "./agents"
import { workMcpAction, workMcpLabel } from "./workMcpSetup"

// Gêmeo de `matriz_work_mcp_por_agent`, baseado na herança medida no Agy 1.1.27.
const matrix: Record<string, [boolean, boolean]> = {
  "claude-code": [true, false], codex: [true, false], agy: [true, true], opencode: [false, false],
}
describe("canal de trabalho e cadastro global", () => {
  for (const [id, [work, global]] of Object.entries(matrix)) {
    it(`${id}: espelha suporte e necessidade de cadastro`, () => {
      expect(agentDef(id)?.workMcp).toBe(work)
      expect(agentDef(id)?.workMcpGlobalEnv).toBe(global)
    })
  }
  it("motor desconhecido não ganha canal por omissão", () => {
    for (const agent of AGENTS.filter((agent) => !matrix[agent.id])) {
      expect(agent.workMcp).toBe(false)
      expect(agent.workMcpGlobalEnv).toBe(false)
    }
  })
  it("cadastro ausente oferece conectar e configuração estranha exige reverificação", () => {
    expect(workMcpAction("absent")).toBe("Conectar")
    expect(workMcpAction("configured")).toBe("Desconectar")
    expect(workMcpAction("disabled")).toBe("Ativar")
    expect(workMcpAction("conflict")).toBeNull()
    expect(workMcpAction("unavailable")).toBeNull()
    expect(workMcpLabel("configured")).toContain("Cadastro confirmado")
  })
})
