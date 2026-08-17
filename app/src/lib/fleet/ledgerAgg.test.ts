import { describe, expect, it } from "vitest"
import { aggregateLedgerByProject } from "./ledgerAgg"

describe("aggregateLedgerByProject — turno sem preço não vira US$ 0 (ADR-047)", () => {
  it("soma só o que tem preço; o resto entra em `unpriced`, por projeto", () => {
    const { byProject, unpriced } = aggregateLedgerByProject([
      { agent: "claude-code", projectId: "p1", costUsd: 2, tokens: 10, createdAt: 1 },
      // agy sem preço no catálogo: NÃO soma como 0 — vira contagem à parte.
      { agent: "agy", projectId: "p1", costUsd: null, tokens: 500_000, createdAt: 2 },
      { agent: "agy", projectId: "p2", costUsd: null, tokens: 100_000, createdAt: 3 },
    ])
    expect(byProject).toEqual({ p1: 2 })
    expect(unpriced).toEqual({
      p1: { turns: 1, tokens: 500_000 },
      p2: { turns: 1, tokens: 100_000 },
    })
  })

  it("sem nenhum turno sem preço, `unpriced` fica vazio (não aparece p/0)", () => {
    const { unpriced } = aggregateLedgerByProject([
      { agent: "claude-code", projectId: "p1", costUsd: 1, tokens: 5, createdAt: 1 },
    ])
    expect(unpriced).toEqual({})
  })
})
