// ADR-047 — o Painel passa a receber linhas com consumo e SEM preço, e a
// pergunta que o usuário faz olhando um total ("isso é tudo?") precisa de
// resposta. Aqui está a matemática dessa resposta: quanto ficou de fora.
//
// Fixture REAL: os 5 `result` do `agy` na conversa
// ec1642c1-5328-409e-afc8-58e79a3cdca1 (banco do usuário, 16/08/2026), que até
// o ADR-047 não geravam linha nenhuma.

import { describe, expect, it } from "vitest"
import { costByAgent, unpricedSpend, type LedgerRow } from "@/lib/panel"

const T0 = Date.UTC(2026, 7, 16, 17, 45)

/** input+output do item, como o loadLedger projeta em `tokens`. */
const AGY_TURNS: [number, number][] = [
  [223_989, 5_270],
  [591_254, 5_427],
  [1_799_735, 8_770],
  [2_399_909, 11_098],
  [2_292_553, 12_373],
]

const semPreco: LedgerRow[] = AGY_TURNS.map(([input, output], i) => ({
  agent: "agy",
  projectId: "p1",
  costUsd: null,
  tokens: input + output,
  createdAt: T0 + i * 60_000,
}))

const comPreco: LedgerRow[] = [
  {
    agent: "claude-code",
    projectId: "p1",
    costUsd: 2.5,
    tokens: 40_000,
    createdAt: T0,
  },
]

describe("unpricedSpend — o pedaço que o total em US$ não cobre", () => {
  it("conta os turnos e os tokens sem preço", () => {
    const u = unpricedSpend([...comPreco, ...semPreco])
    expect(u.turns).toBe(5)
    expect(u.tokens).toBe(7_350_378)
  })

  it("ledger inteiro com preço não produz ressalva", () => {
    expect(unpricedSpend(comPreco)).toEqual({ turns: 0, tokens: 0 })
  })

  it("custo ZERO medido não é 'sem preço'", () => {
    const zerado: LedgerRow[] = [
      { agent: "codex", projectId: "p1", costUsd: 0, tokens: 12, createdAt: T0 },
    ]
    expect(unpricedSpend(zerado)).toEqual({ turns: 0, tokens: 0 })
  })
})

describe("costByAgent — o ranking não esconde o que não sabe cobrar", () => {
  it("o agent sem preço aparece com tokens e o carimbo de quantos turnos", () => {
    const rows = [...comPreco, ...semPreco]
    const [claude, agy] = costByAgent(rows)
    expect(claude.agent).toBe("claude-code")
    expect(claude.unpricedTurns).toBe(0)
    // ele não some do ranking só porque não tem dólar
    expect(agy.agent).toBe("agy")
    expect(agy.costUsd).toBe(0)
    expect(agy.unpricedTurns).toBe(5)
    expect(agy.tokens).toBe(7_350_378)
    // e o share do que TEM preço continua honesto: 100% do dinheiro conhecido
    expect(claude.share).toBe(1)
  })

  it("turno com preço e turno sem preço do MESMO agent convivem na linha", () => {
    const [only] = costByAgent([
      {
        agent: "agy",
        projectId: "p1",
        costUsd: 0.42,
        tokens: 2_411_007,
        createdAt: T0,
      },
      {
        agent: "agy",
        projectId: "p1",
        costUsd: null,
        tokens: 100,
        createdAt: T0 + 1,
      },
    ])
    expect(only.costUsd).toBeCloseTo(0.42)
    expect(only.unpricedTurns).toBe(1)
    expect(only.tokens).toBe(2_411_107)
  })
})
