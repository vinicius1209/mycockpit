// ADR-033 — usage ACUMULADO por thread (codex 0.146). As fixtures são REAIS:
// os dois primeiros casos vêm da medição de 04/08/2026 (dois turnos triviais
// na mesma thread via `exec resume`), e a série longa é a conversa do banco do
// usuário que sozinha somava US$ 4.166 no Painel.
import { describe, expect, it } from "vitest"
import {
  nextBaseline,
  planUsageRecompute,
  recomputeSummary,
  type RawCostRow,
} from "@/lib/usage"

/** Linha de ledger com os defaults chatos preenchidos. */
function row(p: Partial<RawCostRow> & { runId: string; createdAt: number }): RawCostRow {
  return {
    convId: "conv-1",
    costUsd: 0,
    input: 0,
    output: 0,
    cache: 0,
    ...p,
  }
}

describe("nextBaseline", () => {
  it("carimba o acumulado cru do provider (é a verdade do próximo turno)", () => {
    expect(
      nextBaseline({ input: 35005, cached_input: 27136, output: 12 }),
    ).toEqual({ input: 35005, cached_input: 27136, output: 12 })
  })

  it("número quebrado/negativo nunca vira baseline inválido", () => {
    expect(
      nextBaseline({ input: -5, cached_input: 10.7, output: Number.NaN }),
    ).toEqual({ input: 0, cached_input: 10, output: 0 })
  })
})

describe("planUsageRecompute (histórico gravado como acumulado)", () => {
  it("o 2º turno passa a valer o DELTA, não o acumulado", () => {
    // medição real: 17494/9984/6 → 35005/27136/12 com o MESMO prompt trivial.
    const plan = planUsageRecompute([
      row({ runId: "r1", createdAt: 1, input: 17494, cache: 9984, output: 6, costUsd: 0.0158 }),
      row({ runId: "r2", createdAt: 2, input: 35005, cache: 27136, output: 12, costUsd: 0.0533 }),
    ])
    expect(plan[0].input).toBe(17494)
    expect(plan[0].costUsd).toBeCloseTo(0.0158, 6)
    expect(plan[1].input).toBe(17511)
    expect(plan[1].cache).toBe(17152)
    expect(plan[1].output).toBe(6)
    expect(plan[1].costUsd).toBeCloseTo(0.0375, 6)
    // o original fica preservado pra auditoria (nada é apagado).
    expect(plan[1].raw).toEqual({
      costUsd: 0.0533,
      input: 35005,
      output: 12,
      cache: 27136,
    })
  })

  it("série real da conversa: 51 turnos somados viram o último acumulado", () => {
    // amostra fiel do banco (linhas 1, 2, 3 e a última da conversa que o
    // Painel mostrava como US$ 4.166).
    const plan = planUsageRecompute([
      row({ runId: "a", createdAt: 10, input: 8966203, cache: 8666368, output: 51776, costUsd: 7.39 }),
      row({ runId: "b", createdAt: 20, input: 9757471, cache: 9277696, output: 57354, costUsd: 8.76 }),
      row({ runId: "c", createdAt: 30, input: 16962418, cache: 15958784, output: 109100, costUsd: 16.27 }),
      row({ runId: "d", createdAt: 40, input: 195249694, cache: 185871872, output: 673076, costUsd: 160.02 }),
    ])
    const s = recomputeSummary(plan)
    expect(s.before).toBeCloseTo(192.44, 2)
    // a soma dos deltas é o ÚLTIMO acumulado (a série é monotônica).
    expect(s.after).toBeCloseTo(160.02, 2)
    expect(plan.every((r) => (r.costUsd ?? 0) >= 0)).toBe(true)
  })

  it("thread nova na mesma conversa (contador cai) volta a valer inteira", () => {
    const plan = planUsageRecompute([
      row({ runId: "a", createdAt: 1, input: 100_000, cache: 90_000, output: 500, costUsd: 5 }),
      row({ runId: "b", createdAt: 2, input: 12_000, cache: 9_000, output: 40, costUsd: 0.6 }),
      row({ runId: "c", createdAt: 3, input: 25_000, cache: 20_000, output: 90, costUsd: 1.2 }),
    ])
    expect(plan.map((r) => r.costUsd)).toEqual([5, 0.6, expect.closeTo(0.6, 6)])
    expect(plan[1].input).toBe(12_000)
    expect(plan[2].input).toBe(13_000)
  })

  it("cada conversa é uma série própria (não subtrai linha de outra)", () => {
    const plan = planUsageRecompute([
      row({ runId: "a", convId: "c1", createdAt: 1, input: 1000, costUsd: 1 }),
      row({ runId: "b", convId: "c2", createdAt: 2, input: 4000, costUsd: 4 }),
      row({ runId: "c", convId: "c1", createdAt: 3, input: 1500, costUsd: 1.5 }),
    ])
    const byRun = new Map(plan.map((r) => [r.runId, r]))
    expect(byRun.get("b")?.input).toBe(4000)
    expect(byRun.get("c")?.input).toBe(500)
  })

  it("nunca inventa custo: o total reconstruído é menor ou igual ao original", () => {
    const plan = planUsageRecompute([
      row({ runId: "a", createdAt: 1, input: 2108925, cache: 1961472, output: 13211, costUsd: 2.114 }),
      row({ runId: "b", createdAt: 2, input: 2240281, cache: 2088192, output: 15345, costUsd: 2.265 }),
      row({ runId: "c", createdAt: 3, input: 4085546, cache: 3883264, output: 23848, costUsd: 3.668 }),
      row({ runId: "d", createdAt: 4, input: 13671827, cache: 13175296, output: 52231, costUsd: 10.637 }),
    ])
    const s = recomputeSummary(plan)
    expect(s.rows).toBe(4)
    expect(s.after).toBeLessThanOrEqual(s.before)
    expect(s.after).toBeCloseTo(10.637, 3)
  })

  it("linha sem custo registrado continua sem custo (não vira zero inventado)", () => {
    const plan = planUsageRecompute([
      row({ runId: "a", createdAt: 1, input: 100, costUsd: null }),
      row({ runId: "b", createdAt: 2, input: 260, costUsd: null }),
    ])
    expect(plan.map((r) => r.costUsd)).toEqual([null, null])
    expect(plan[1].input).toBe(160)
  })
})
