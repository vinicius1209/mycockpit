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
