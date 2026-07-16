// Testes da lógica pura do Painel: parse do statusCheckRollup, elegibilidade
// do Merge, ordenação da fila e janelas de custo.

import { describe, it, expect } from "vitest"
import {
  countChecks,
  parsePrView,
  mergeEligible,
  prHealth,
  prResolved,
  orderQueue,
  costWindows,
  ledgerWindows,
  costByAgent,
  costByProject,
  dailySpend,
  ledgerTokens,
  windowRows,
  type PrEnrichment,
} from "@/lib/panel"
import type { Decision } from "@/lib/inbox"

/** Enriquecimento verde por padrão; override por teste. */
function enr(patch: Partial<PrEnrichment> = {}): PrEnrichment {
  return {
    state: "OPEN",
    title: "feat: x",
    additions: 214,
    deletions: 38,
    mergeable: "MERGEABLE",
    reviewDecision: "",
    isDraft: false,
    updatedAt: Date.now(),
    checksTotal: 5,
    checksPassed: 5,
    checksFailed: 0,
    ...patch,
  }
}

const pr = (url: string): Decision => ({
  kind: "pr",
  projectId: "p1",
  projectName: "proj",
  slug: "s",
  planTitle: "t",
  prUrl: url,
})
const fusion: Decision = {
  kind: "fusion",
  convId: "c1",
  projectId: "p1",
  projectName: "proj",
  title: "disputa",
}
const prd: Decision = {
  kind: "prd",
  projectId: "p1",
  projectName: "proj",
  slug: "s2",
  planTitle: "prd",
  createdAt: null,
}

describe("countChecks (statusCheckRollup → contagem)", () => {
  it("conta SUCCESS de CheckRun (conclusion) e StatusContext (state)", () => {
    const rollup = [
      { conclusion: "SUCCESS" }, // CheckRun
      { state: "SUCCESS" }, // StatusContext
      { conclusion: "FAILURE" },
      { state: "ERROR" },
      { conclusion: "", status: "IN_PROGRESS" }, // rodando: só total
    ]
    expect(countChecks(rollup)).toEqual({ total: 5, passed: 2, failed: 2 })
  })

  it("sem checks / shape inesperado → zeros (fail-soft)", () => {
    expect(countChecks([])).toEqual({ total: 0, passed: 0, failed: 0 })
    expect(countChecks(null)).toEqual({ total: 0, passed: 0, failed: 0 })
    expect(countChecks("x")).toEqual({ total: 0, passed: 0, failed: 0 })
    expect(countChecks([null])).toEqual({ total: 1, passed: 0, failed: 0 })
  })
})

describe("parsePrView", () => {
  it("digere o JSON do gh pr view", () => {
    const e = parsePrView({
      state: "OPEN",
      title: "feat: painel",
      additions: 214,
      deletions: 38,
      mergeable: "MERGEABLE",
      reviewDecision: "APPROVED",
      isDraft: false,
      updatedAt: "2026-07-14T10:00:00Z",
      statusCheckRollup: [
        { conclusion: "SUCCESS" },
        { conclusion: "SUCCESS" },
      ],
    })
    expect(e).not.toBeNull()
    expect(e!.checksTotal).toBe(2)
    expect(e!.checksPassed).toBe(2)
    expect(e!.updatedAt).toBe(Date.parse("2026-07-14T10:00:00Z"))
    expect(e!.additions).toBe(214)
  })

  it("shape inesperado → null; campos faltando → defaults", () => {
    expect(parsePrView(null)).toBeNull()
    expect(parsePrView("erro")).toBeNull()
    expect(parsePrView([1, 2])).toBeNull()
    const e = parsePrView({})
    expect(e).not.toBeNull()
    expect(e!.mergeable).toBe("")
    expect(e!.updatedAt).toBeNull()
    expect(e!.checksTotal).toBe(0)
  })
})

describe("prResolved (auto-cura: merge feito fora do app)", () => {
  it("MERGED/CLOSED → resolvida (sai da fila)", () => {
    expect(prResolved(enr({ state: "MERGED" }))).toBe(true)
    expect(prResolved(enr({ state: "CLOSED" }))).toBe(true)
  })
  it("OPEN ou sem enriquecimento → segue na fila", () => {
    expect(prResolved(enr({ state: "OPEN" }))).toBe(false)
    expect(prResolved(null)).toBe(false)
    expect(prResolved(undefined)).toBe(false)
  })
})

describe("mergeEligible", () => {
  it("verde total → elegível", () => {
    expect(mergeEligible(enr())).toBe(true)
  })
  it("0/0 checks conta como verde (o GitHub ainda é o gate final)", () => {
    expect(mergeEligible(enr({ checksTotal: 0, checksPassed: 0 }))).toBe(true)
  })
  it("check falhando / pendente → não", () => {
    expect(mergeEligible(enr({ checksFailed: 1, checksPassed: 4 }))).toBe(false)
    expect(mergeEligible(enr({ checksPassed: 3 }))).toBe(false) // 3/5 rodando
  })
  it("não-MERGEABLE, CHANGES_REQUESTED, draft ou sem dado → não", () => {
    expect(mergeEligible(enr({ mergeable: "CONFLICTING" }))).toBe(false)
    expect(mergeEligible(enr({ mergeable: "UNKNOWN" }))).toBe(false)
    expect(mergeEligible(enr({ reviewDecision: "CHANGES_REQUESTED" }))).toBe(
      false,
    )
    expect(mergeEligible(enr({ isDraft: true }))).toBe(false)
    expect(mergeEligible(null)).toBe(false)
    expect(mergeEligible(undefined)).toBe(false)
  })
})

describe("prHealth", () => {
  it("classifica verde / falhando / desconhecido", () => {
    expect(prHealth(enr())).toBe("green")
    expect(prHealth(enr({ checksFailed: 2, checksPassed: 3 }))).toBe("failing")
    expect(prHealth(enr({ checksPassed: 3 }))).toBe("unknown") // rodando
    expect(prHealth(null)).toBe("unknown")
  })
})

describe("orderQueue (ordenação da fila)", () => {
  it("PR verde → disputa → PRD → PR sem dado → PR falhando", () => {
    const green = pr("https://github.com/o/r/pull/1")
    const failing = pr("https://github.com/o/r/pull/2")
    const unknown = pr("https://github.com/o/r/pull/3")
    const byUrl = {
      [green.kind === "pr" ? green.prUrl : ""]: enr(),
      "https://github.com/o/r/pull/2": enr({ checksFailed: 1, checksPassed: 4 }),
      // pull/3 sem entrada = sem enriquecimento ainda
    }
    const out = orderQueue([failing, prd, unknown, fusion, green], byUrl)
    expect(out).toEqual([green, fusion, prd, unknown, failing])
  })

  it("estável dentro do mesmo rank (preserva a ordem do scan)", () => {
    const a = pr("https://github.com/o/r/pull/10")
    const b = pr("https://github.com/o/r/pull/11")
    const out = orderQueue([a, b], {})
    expect(out).toEqual([a, b])
  })

  it("fila vazia → vazia", () => {
    expect(orderQueue([], {})).toEqual([])
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
