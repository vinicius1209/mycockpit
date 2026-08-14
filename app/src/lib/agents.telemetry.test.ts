// Teste-GÊMEO do Rust (`matriz_telemetria_por_agent` em adapters.rs) — mesma
// disciplina das matrizes de anexo/slash/canais/compactação/usage. Lá é a
// verdade auditada por versão (agent-runner §7.1); aqui é o espelho que a
// superfície da missão consulta pra decidir COMPORTAMENTO: quem narra ação a
// ação, e de quem existe custo em dólar. Mexeu aqui, mexa lá.

import { describe, expect, it } from "vitest"
import { AGENTS, agentDef } from "./agents"

/** A matriz, escrita UMA vez. O teste Rust repete estes mesmos valores. */
const MATRIZ: Record<string, { structuredOutput: boolean; reportsCost: boolean }> =
  {
    // claude 2.1.220: stream-json com evento por ação e `total_cost_usd`.
    "claude-code": { structuredOutput: true, reportsCost: true },
    // codex 0.147: `exec --json` é JSONL de eventos, mas sem dólar (o custo
    // sai estimado por tokens).
    codex: { structuredOutput: true, reportsCost: false },
    // agy 1.1.13: o `-p` que o app roda é `--output-format stream-json`, um
    // step por ação (14/08/2026). Dólar segue sem existir em evento nenhum: o
    // custo do agy sai estimado por tokens, como o do codex.
    agy: { structuredOutput: true, reportsCost: false },
  }

describe("telemetria e custo por motor (espelho do registry Rust)", () => {
  for (const [id, esperado] of Object.entries(MATRIZ)) {
    it(`${id}: structuredOutput=${esperado.structuredOutput} · reportsCost=${esperado.reportsCost}`, () => {
      expect(agentDef(id)?.structuredOutput).toBe(esperado.structuredOutput)
      expect(agentDef(id)?.reportsCost).toBe(esperado.reportsCost)
    })
  }

  it("motor desconhecido não promete nada (fail-closed)", () => {
    expect(agentDef("gemini-inexistente")?.structuredOutput).toBeUndefined()
    expect(agentDef("gemini-inexistente")?.reportsCost).toBeUndefined()
  })

  it("coerência do contrato: reportsCost exige structuredOutput", () => {
    // dólar por turno chega DENTRO do evento final do stream; motor que só
    // cospe texto não tem onde entregar número, e prometer custo ali seria
    // inventar. (Se um dia um motor entregar custo por outro canal, o contrato
    // muda aqui e no Rust, junto.)
    for (const a of AGENTS) {
      expect(
        !a.reportsCost || a.structuredOutput,
        `${a.id}: reportsCost sem structuredOutput`,
      ).toBe(true)
    }
  })

  it("motor não integrado nasce sem promessa nenhuma", () => {
    for (const a of AGENTS.filter((x) => !x.available)) {
      expect(a.structuredOutput, `${a.id}`).toBe(false)
      expect(a.reportsCost, `${a.id}`).toBe(false)
    }
  })
})
