// Teste-GÊMEO do Rust (`matriz_modelo_livre_por_agent` em adapters.rs, K2):
// quem aceita id de modelo digitado. É a capability que o seletor consulta para
// oferecer "Modelo custom…", no lugar da antiga lista com nomes de motor.
// Mexeu aqui, mexa lá.

import { describe, expect, it } from "vitest"
import { AGENTS, agentDef } from "./agents"

const MATRIZ: Record<string, boolean> = {
  "claude-code": true,
  codex: true,
  agy: false,
  opencode: false,
  model: false,
}

describe("modelo digitado por agent (espelho do registry Rust)", () => {
  for (const [id, livre] of Object.entries(MATRIZ)) {
    it(`${id}: modeloLivre=${livre}`, () => {
      expect(agentDef(id)?.modeloLivre).toBe(livre)
    })
  }

  it("todo agent da liga está na matriz", () => {
    expect(AGENTS.map((a) => a.id).sort()).toEqual(Object.keys(MATRIZ).sort())
  })
})
