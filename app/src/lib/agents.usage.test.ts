// Teste-GÊMEO do Rust (`matriz_cumulative_usage_por_agent` em adapters.rs) —
// mesma disciplina das matrizes de anexo/slash/canais/compactação. Lá é a
// verdade auditada por versão (agent-runner §7.1, ADR-033); aqui é o espelho
// que a manutenção de custo consulta pra saber de QUAL motor o histórico
// gravado antes da correção está superestimado. Mexeu aqui, mexa lá.

import { describe, expect, it } from "vitest"
import { AGENTS, agentDef, cumulativeUsageAgents } from "./agents"

/** A matriz, escrita UMA vez. O teste Rust repete estes mesmos valores. */
const MATRIZ: Record<string, boolean> = {
  // claude 2.1.220: o `result` traz usage e USD DO TURNO.
  "claude-code": false,
  // codex 0.146: `turn.completed.usage` é o total da THREAD — dois turnos
  // triviais no mesmo thread via resume deram input 17494 → 35005 (04/08/2026).
  codex: true,
  // agy: stdout de texto puro, sem usage nenhum.
  agy: false,
}

describe("usage acumulado por thread (espelho do registry Rust)", () => {
  for (const [id, esperado] of Object.entries(MATRIZ)) {
    it(`${id}: cumulativeUsage=${esperado}`, () => {
      expect(agentDef(id)?.cumulativeUsage).toBe(esperado)
    })
  }

  it("agent desconhecido não promete nada (fail-closed)", () => {
    expect(agentDef("gemini-inexistente")?.cumulativeUsage).toBeUndefined()
  })

  it("coerência do contrato: cumulativeUsage exige sessionResume", () => {
    // o acumulado só cresce entre turnos da MESMA thread; sem resume, todo run
    // é thread nova e o acumulado JÁ é o do turno.
    for (const a of AGENTS) {
      expect(
        !a.cumulativeUsage || a.sessionResume,
        `${a.id}: cumulativeUsage sem sessionResume`,
      ).toBe(true)
    }
  })

  it("a lista de motores afetados sai do registry, nunca de nome fixo", () => {
    expect(cumulativeUsageAgents().map((a) => a.id)).toEqual(["codex"])
  })
})
