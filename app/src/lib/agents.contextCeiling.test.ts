// Teste-GÊMEO do Rust (`matriz_context_ceiling_por_agent`, ADR-196): quem diz
// onde compacta sozinho. Sem sonda, o anel usa a janela e não afirma limiar.

import { describe, expect, it } from "vitest"
import { contextCeilingProbe, type ContextCeilingProbe } from "./agentContext"

const MATRIZ: Record<string, ContextCeilingProbe | null> = {
  "claude-code": "claude-control-request",
  codex: "codex-config-catalog",
  agy: "agy-generation-record",
  opencode: null,
}

describe("sonda do limiar de compactação por agent (espelho do registry Rust)", () => {
  for (const [id, probe] of Object.entries(MATRIZ)) {
    it(`${id}: contextCeilingProbe=${probe}`, () => {
      expect(contextCeilingProbe(id)).toBe(probe)
    })
  }

  it("motor desconhecido não ganha sonda presumida", () => {
    expect(contextCeilingProbe("inexistente")).toBeNull()
  })
})
