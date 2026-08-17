// ADR-047 no cruzamento custo × entregas do Painel: o motor que o app não sabe
// cobrar não pode aparecer como o mais barato de todos.
//
// Fixture REAL: turnos do `agy` na conversa ec1642c1 (incidente 2026-08-16),
// que só passaram a existir no ledger depois do ADR-047.

import { describe, expect, it } from "vitest"
import { agentCross, unpricedByAgent } from "@/lib/retro"
import type { LedgerRow } from "@/lib/panel"

const T0 = Date.UTC(2026, 7, 16, 17, 45)

const rows: LedgerRow[] = [
  {
    agent: "claude-code",
    projectId: "p1",
    costUsd: 8.5,
    tokens: 120_000,
    createdAt: T0,
  },
  {
    agent: "agy",
    projectId: "p1",
    costUsd: null,
    tokens: 2_411_007,
    createdAt: T0 + 1,
  },
  {
    agent: "agy",
    projectId: "p1",
    costUsd: null,
    tokens: 2_304_926,
    createdAt: T0 + 2,
  },
]

describe("ranking por agente com turnos sem preço", () => {
  it("conta os turnos sem preço por agent, ao lado do custo cruzado", () => {
    const [claude, agy] = agentCross(rows, [
      { agent: "claude-code", createdAt: T0 },
    ])
    const semPreco = unpricedByAgent(rows)
    expect(semPreco.get("claude-code")).toBeUndefined()
    expect(claude.perDelivery).toBeCloseTo(8.5)
    expect(agy.costUsd).toBe(0)
    expect(semPreco.get("agy")).toBe(2)
    // e o zero dele NÃO vira "US$ 0,00 por entrega": sem entrega, sem número
    expect(agy.perDelivery).toBeNull()
  })

  it("agent com turno com preço e turno sem mantém o custo parcial", () => {
    const mistos: LedgerRow[] = [
      {
        agent: "agy",
        projectId: "p1",
        costUsd: 0.42,
        tokens: 100,
        createdAt: T0,
      },
      ...rows.slice(1, 2),
    ]
    const [only] = agentCross(mistos, [{ agent: "agy", createdAt: T0 }])
    expect(only.costUsd).toBeCloseTo(0.42)
    expect(unpricedByAgent(mistos).get("agy")).toBe(1)
    expect(only.perDelivery).toBeCloseTo(0.42)
  })
})
