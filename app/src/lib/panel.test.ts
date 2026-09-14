// Testes da lógica pura do Painel: ordenação da fila e janelas de custo.

import { describe, it, expect } from "vitest"
import {
  orderQueue,
  costWindows,
  ledgerWindows,
  costByAgent,
  costByProject,
  dailySpend,
  ledgerTokens,
  windowRows,
} from "@/lib/panel"
import type { Decision } from "@/lib/inbox"

const fusion = (convId: string): Decision => ({
  kind: "fusion",
  convId,
  projectId: "p1",
  projectName: "proj",
  title: "disputa",
})
const card = (cardId: string): Decision => ({
  kind: "card",
  cardId,
  projectId: "p1",
  projectName: "proj",
  title: "card",
  state: "review",
})
const proposal: Decision = {
  kind: "proposal",
  proposalId: "prop-1",
  excerpt: "priorize A",
  body: "priorize A",
  createdAt: 1,
}

describe("orderQueue (ordenação da fila)", () => {
  it("disputa → card e proposta", () => {
    const a = card("k1")
    const f = fusion("c1")
    const out = orderQueue([a, proposal, f])
    expect(out).toEqual([f, a, proposal])
  })

  it("estável dentro do mesmo rank (preserva a ordem do scan)", () => {
    const f1 = fusion("c1")
    const f2 = fusion("c2")
    const k1 = card("k1")
    const k2 = card("k2")
    expect(orderQueue([k2, f1, k1, f2])).toEqual([f1, f2, k2, k1])
  })

  it("fila vazia → vazia", () => {
    expect(orderQueue([])).toEqual([])
  })
})

describe("costWindows (janela de custo)", () => {
  // now fixo: 2026-07-14 12:00 LOCAL (meia-noite local é o corte do "hoje").
  const now = new Date(2026, 6, 14, 12, 0, 0).getTime()
  const h = 60 * 60 * 1000
  const d = 24 * h

  it("hoje = desde a meia-noite local; 7d = últimos 7 dias corridos", () => {
    const { today, week } = costWindows(
      [
        { costUsd: 1, createdAt: now - h }, // hoje (11:00)
        { costUsd: 2, createdAt: now - 13 * h }, // ontem 23:00 → só 7d
        { costUsd: 4, createdAt: now - 6 * d }, // dentro dos 7d
        { costUsd: 8, createdAt: now - 8 * d }, // fora de tudo
      ],
      now,
    )
    expect(today).toBe(1)
    expect(week).toBe(7)
  })

  it("custo null conta como 0; timestamp futuro fica de fora", () => {
    const { today, week } = costWindows(
      [
        { costUsd: null, createdAt: now - h },
        { costUsd: 5, createdAt: now + h }, // futuro
      ],
      now,
    )
    expect(today).toBe(0)
    expect(week).toBe(0)
  })

  it("sem entregas → zeros", () => {
    expect(costWindows([], now)).toEqual({ today: 0, week: 0 })
  })
})

describe("ledger de custo (Painel Instrumento)", () => {
  const now = new Date(2026, 6, 14, 12, 0, 0).getTime()
  const h = 60 * 60 * 1000
  const d = 24 * h
  const row = (
    agent: string,
    costUsd: number | null,
    ago: number,
    tokens = 0,
    projectId = "p1",
  ) => ({ agent, projectId, costUsd, tokens, createdAt: now - ago })

  it("ledgerWindows soma hoje/7d/30d corridos, ignora futuro e null=0", () => {
    const { today, week, month } = ledgerWindows(
      [
        row("codex", 1, h), // hoje
        row("claude-code", 2, 13 * h), // ontem → 7d e 30d
        row("codex", 4, 6 * d), // 7d e 30d
        row("codex", 8, 20 * d), // só 30d
        row("codex", 16, 40 * d), // fora
        row("codex", null, h), // null = 0
        row("codex", 99, -h), // futuro → fora
      ],
      now,
    )
    expect(today).toBe(1)
    expect(week).toBe(7)
    expect(month).toBe(15)
  })

  it("costByAgent agrupa, ordena desc e calcula share", () => {
    const r = costByAgent([
      row("codex", 30, h, 100),
      row("claude-code", 60, h, 200),
      row("codex", 10, h, 50),
    ])
    expect(r.map((x) => x.agent)).toEqual(["claude-code", "codex"])
    expect(r[0]).toMatchObject({ costUsd: 60, tokens: 200, share: 0.6 })
    expect(r[1]).toMatchObject({ costUsd: 40, tokens: 150, share: 0.4 })
  })

  it("costByAgent com total 0 → share 0 (sem divisão por zero)", () => {
    const r = costByAgent([row("codex", 0, h), row("codex", null, h)])
    expect(r[0].share).toBe(0)
  })

  it("dailySpend faz bucket por dia local, hoje no fim", () => {
    const s = dailySpend([row("codex", 5, 0), row("codex", 3, 2 * d), row("codex", 7, 2 * d)], 3, now)
    // 3 dias: [anteontem=10, ontem=0, hoje=5]
    expect(s).toEqual([10, 0, 5])
  })

  it("ledgerTokens soma os tokens", () => {
    expect(ledgerTokens([row("a", 1, h, 100), row("b", 2, h, 250)])).toBe(350)
  })

  it("costByProject agrupa por projeto, ordena desc e calcula share", () => {
    const r = costByProject([
      row("codex", 30, h, 0, "alpha"),
      row("claude-code", 10, h, 0, "beta"),
      row("codex", 60, h, 0, "beta"),
    ])
    expect(r.map((x) => x.projectId)).toEqual(["beta", "alpha"])
    expect(r[0]).toMatchObject({ costUsd: 70, share: 0.7 })
    expect(r[1]).toMatchObject({ costUsd: 30, share: 0.3 })
  })

  it("windowRows recorta por janela (hoje/7d/30d)", () => {
    const rows = [row("c", 1, h), row("c", 2, 3 * d), row("c", 4, 20 * d)]
    expect(windowRows(rows, "today", now)).toHaveLength(1)
    expect(windowRows(rows, "7d", now)).toHaveLength(2)
    expect(windowRows(rows, "30d", now)).toHaveLength(3)
  })
})
