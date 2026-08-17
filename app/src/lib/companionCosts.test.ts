import { describe, expect, it } from "vitest"
import { ledgerCostsForToday } from "./companionCosts"

describe("ledgerCostsForToday — turno sem preço não soma como US$ 0 (ADR-047)", () => {
  it("some do total, aparece em unpriced", () => {
    // O bug que este teste prova ausente: `costUsd ?? 0` tratava "não sei o
    // preço" como "custou zero", e o consumo do agy sumia sem deixar rastro
    // (mesmo incidente do ADR-047, agora no companion).
    const r = ledgerCostsForToday([
      { agent: "claude-code", projectId: "p1", costUsd: 2, tokens: 10, createdAt: 1 },
      { agent: "agy", projectId: "p1", costUsd: null, tokens: 500_000, createdAt: 2 },
    ])
    // só o turno com preço entra na soma — o outro NÃO vira US$ 0.
    expect(r.totalUsd).toBe(2)
    expect(r.byProject).toEqual({ p1: 2 })
    expect(r.unpriced).toEqual({ turns: 1, tokens: 500_000 })
  })
})
