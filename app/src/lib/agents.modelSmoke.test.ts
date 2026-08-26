// Teste-GÊMEO do Rust (`matriz_fumaca_de_modelo_por_agent` em adapters.rs) —
// mesma disciplina das outras matrizes. Lá é a verdade auditada por versão
// (14/08/2026, nesta máquina: a fumaça foi rodada de verdade contra um slug
// válido e um inválido de cada motor); aqui é o espelho que a UI consulta pra
// saber se oferece o gesto "testar este modelo". Mexeu aqui, mexa lá.

import { describe, expect, it } from "vitest"
import { AGENTS, agentDef } from "./agents"
import { modelSmokeAgents } from "./agentRoster"

/** A matriz, escrita UMA vez. O teste Rust repete estes mesmos valores
 *  (claude-print-json ↔ ClaudePrintJson, e assim por diante). */
const MATRIZ: Record<
  string,
  "claude-print-json" | "codex-exec-json" | "agy-print-json" | null
> = {
  // claude 2.1.220: `-p --output-format json` com --tools "" (turno de
  // $0,00055) — 404 real no slug inválido, contextWindow no sucesso.
  "claude-code": "claude-print-json",
  // codex 0.147: `exec --json` avisa quando é ELE que não conhece o slug.
  codex: "codex-exec-json",
  // agy 1.1.13: recusa slug desconhecido localmente, sem chamada e sem custo.
  agy: "agy-print-json",
}

describe("fumaça de um token por agent (espelho do registry Rust)", () => {
  for (const [id, esperado] of Object.entries(MATRIZ)) {
    it(`${id}: modelSmoke=${esperado}`, () => {
      expect(agentDef(id)?.modelSmoke).toBe(esperado)
    })
  }

  it("agent desconhecido não promete nada (fail-closed)", () => {
    expect(agentDef("gemini-inexistente")?.modelSmoke).toBeUndefined()
  })

  it("motor não integrado nunca declara dialeto de fumaça", () => {
    for (const a of AGENTS.filter((x) => !x.available)) {
      expect(a.modelSmoke, `${a.id}: fumaça declarada sem integração`).toBeNull()
    }
  })

  it("quem lista modelos precisa saber testá-los (a recíproca é falsa)", () => {
    // Espelho da coerência do contrato Rust: a fonte viva responde "existe?",
    // a fumaça responde "funciona com a SUA auth?". O claude testa e não lista.
    for (const a of AGENTS) {
      if (a.listsModels != null) {
        expect(a.modelSmoke, `${a.id}: lista sem como verificar`).not.toBeNull()
      }
    }
    expect(agentDef("claude-code")?.listsModels).toBeNull()
    expect(agentDef("claude-code")?.modelSmoke).not.toBeNull()
  })

  it("a lista de motores testáveis sai do registry, nunca de nome fixo", () => {
    expect(modelSmokeAgents().map((a) => a.id)).toEqual([
      "claude-code",
      "codex",
      "agy",
      "opencode",
    ])
  })
})
