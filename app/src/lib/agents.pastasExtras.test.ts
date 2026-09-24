// Teste-GÊMEO do Rust (`matriz_pastas_extras_por_agent` em adapters.rs): a
// pasta extra por envio mora em DOIS lugares. Lá é o que vira `--add-dir` no
// spawn; aqui é o espelho que o cartão do arquivo solto consulta para prometer
// (ou não) "só neste envio o agente pode ler esta pasta" (ADR-252). Mexeu
// aqui, mexa lá.

import { describe, expect, it } from "vitest"
import { agentDef } from "./agents"

/** A matriz, escrita UMA vez. O teste Rust repete estes mesmos valores. */
const MATRIZ: Record<string, boolean> = {
  "claude-code": true,
  codex: true,
  agy: true,
  // OpenCode: nem o `run` nem o ACP têm canal de pasta extra.
  opencode: false,
}

describe("pasta extra por envio (espelho do registry Rust)", () => {
  for (const [id, esperado] of Object.entries(MATRIZ)) {
    it(`${id}: pastasExtras=${esperado}`, () => {
      expect(agentDef(id)?.pastasExtras).toBe(esperado)
    })
  }

  it("agent desconhecido não promete ler fora do projeto (fail-closed)", () => {
    expect(agentDef("gemini-inexistente")?.pastasExtras).toBeUndefined()
  })
})
