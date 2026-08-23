// Teste-GÊMEO do Rust (`matriz_context_usage_por_agent`): contexto é o
// footprint da última chamada, nunca a cota da conta nem o total do turno.

import { describe, expect, it } from "vitest"
import { contextUsageSource } from "./agentContext"

const MATRIZ: Record<string, "stream" | "codex-rollout" | null> = {
  "claude-code": "stream",
  codex: "codex-rollout",
  agy: "stream",
}

describe("fonte de contexto por agent (espelho do registry Rust)", () => {
  for (const [id, source] of Object.entries(MATRIZ)) {
    it(`${id}: contextUsage=${source}`, () => {
      expect(contextUsageSource(id)).toBe(source)
    })
  }

  it("motor desconhecido ou não integrado não promete medição", () => {
    expect(contextUsageSource("inexistente")).toBeNull()
    expect(contextUsageSource("opencode")).toBeNull()
    expect(contextUsageSource("model")).toBeNull()
  })
})
