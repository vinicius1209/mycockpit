// Teste-GÊMEO do Rust (`matriz_native_compact_por_agent` em adapters.rs) —
// mesma disciplina das matrizes de anexo/slash/canais: `native_compact` mora
// em DOIS lugares. Lá é a verdade auditada por versão (agent-runner §7.1,
// re-checagem 04/08/2026); aqui é o espelho que o builtin /compactar consulta
// (lib/compact.planCompact) pra decidir entre o turno técnico "/compact" e a
// renovação de sessão com recap. Mexeu aqui, mexa lá.

import { describe, expect, it } from "vitest"
import { AGENTS, agentDef } from "./agents"

/** A matriz, escrita UMA vez. O teste Rust repete estes mesmos valores. */
const MATRIZ: Record<string, boolean> = {
  // claude 2.1.220: `-p --resume <sid> "/compact"` processa o comando em modo
  // print (empírico: respondeu "Not enough messages to compact"); o
  // compact_boundary resultante já vira aviso no fio (ADR-015).
  "claude-code": true,
  // codex 0.146: `/compact` é só do TUI; `codex exec` não expõe.
  codex: false,
  // agy: nada.
  agy: false,
}

describe("compactação nativa (espelho do registry Rust)", () => {
  for (const [id, esperado] of Object.entries(MATRIZ)) {
    it(`${id}: nativeCompact=${esperado}`, () => {
      expect(agentDef(id)?.nativeCompact).toBe(esperado)
    })
  }

  it("agent desconhecido não promete compactação nativa (fail-closed)", () => {
    expect(agentDef("gemini-inexistente")?.nativeCompact).toBeUndefined()
  })

  it("coerência do contrato (G1.4): nativeCompact exige sessionResume em TODO agent registrado", () => {
    // o caminho nativo do /compactar É "resume + /compact": declarar
    // compactação nativa sem resume prometeria um alvo que não existe.
    for (const a of AGENTS) {
      expect(
        !a.nativeCompact || a.sessionResume,
        `${a.id}: nativeCompact sem sessionResume`,
      ).toBe(true)
    }
  })
})
