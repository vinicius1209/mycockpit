import { describe, expect, it } from "vitest"
import { AGENTS, agentToolingCaps } from "@/lib/agents"
import { toolMaterializers } from "@/lib/tooling"

describe("materializadores de tools dos adapters", () => {
  it("mantém a matriz de escopo medida no backend", () => {
    expect(
      Object.fromEntries(
        AGENTS.filter((agent) => agent.available && agent.kind === "agent").map(
          (agent) => [agent.id, agentToolingCaps(agent.id).mcpScope],
        ),
      ),
    ).toEqual({
      "claude-code": "run",
      codex: "run",
      agy: "global",
      opencode: "project",
    })
  })

  it("só chama de forte o filtro que nasce e morre com o run", () => {
    for (const agent of AGENTS.filter(
      (item) => item.available && item.kind === "agent",
    )) {
      const caps = agentToolingCaps(agent.id)
      const materializers = toolMaterializers(caps)
      const native = materializers.find((item) => item.kind === "provider-native")
      const external = materializers.find((item) => item.kind === "external-mcp")
      expect(native).toMatchObject({
        scope: "run",
        enforceability: "advisory",
        filtersPerRun: false,
      })
      expect(external).toMatchObject({
        scope: caps.mcpScope,
        enforceability: caps.mcpScope === "run" ? "hard" : "advisory",
        filtersPerRun: caps.mcpScope === "run",
      })
    }
  })

  it("distingue contagem observada de catálogo opaco", () => {
    expect(
      Object.fromEntries(
        AGENTS.filter((agent) => agent.available && agent.kind === "agent").map(
          (agent) => [agent.id, agentToolingCaps(agent.id).nativeToolInventory],
        ),
      ),
    ).toEqual({
      "claude-code": "runtime-count",
      codex: "opaque",
      agy: "runtime-count",
      opencode: "opaque",
    })
  })
})
