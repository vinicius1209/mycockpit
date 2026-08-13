import { describe, expect, it } from "vitest"
import {
  decisionBreakdown,
  decisionLine,
  decisionTs,
  stripSummary,
} from "@/lib/decisions"
import type { Decision } from "@/lib/inbox"

const AGORA = Date.parse("2026-08-13T18:00:00Z")
const HORA = 60 * 60 * 1000

function disputa(over: Partial<Extract<Decision, { kind: "fusion" }>> = {}): Decision {
  return {
    kind: "fusion",
    convId: "c1",
    projectId: "p1",
    projectName: "mycockpit",
    title: "Reescrever o composer",
    ...over,
  }
}

function card(state: "review" | "blocked" = "blocked"): Decision {
  return {
    kind: "card",
    cardId: "k1",
    projectId: "p1",
    projectName: "mycockpit",
    title: "Rename inline",
    state,
  }
}

function pr(createdAt: string | null = null): Decision {
  return {
    kind: "pr",
    projectId: "p2",
    projectName: "maclan",
    slug: "digest",
    planTitle: "Digest semanal",
    prUrl: "https://github.com/x/y/pull/1",
    createdAt,
    origin: { path: ".claude/plans/digest", discovered: false, ignored: false },
  }
}

describe("faixa de decisão pendente — a regra de existir", () => {
  it("fila vazia não devolve faixa nenhuma (nada de espaço reservado)", () => {
    expect(stripSummary([], AGORA)).toBeNull()
  })

  it("uma decisão só: a faixa diz QUAL é, não um contador", () => {
    const s = stripSummary([disputa()], AGORA)
    expect(s?.count).toBe(1)
    expect(s?.text).toBe("Disputa esperando veredito · mycockpit")
  })

  it("várias decisões: conta e agrega por tipo, na ordem da fila", () => {
    const s = stripSummary([disputa(), disputa({ convId: "c2" }), pr()], AGORA)
    expect(s?.text).toBe("3 esperando você · 2 disputas, 1 PR")
  })
})

describe("faixa de decisão pendente — idade da mais antiga", () => {
  it("usa o carimbo mais VELHO entre as decisões que têm carimbo", () => {
    const s = stripSummary(
      [
        disputa({ createdAt: AGORA - 2 * HORA }),
        disputa({ convId: "c2", createdAt: AGORA - 9 * HORA }),
      ],
      AGORA,
    )
    expect(s?.ageText).toBe("a mais antiga há 9 h")
  })

  it("nenhuma decisão com carimbo ⇒ sem idade (não inventa)", () => {
    const s = stripSummary([card(), card("review")], AGORA)
    expect(s?.ageText).toBeNull()
  })

  it("carimbo no futuro é ignorado (relógio torto não vira 'há -3 h')", () => {
    const s = stripSummary([disputa({ createdAt: AGORA + 5 * HORA })], AGORA)
    expect(s?.ageText).toBeNull()
  })

  it("PRD/PR carregam ISO do manifest; ISO inválido não vira idade", () => {
    expect(decisionTs(pr("2026-08-10T18:00:00Z"))).toBe(
      Date.parse("2026-08-10T18:00:00Z"),
    )
    expect(decisionTs(pr("ontem de manhã"))).toBeNull()
    expect(decisionTs(pr(null))).toBeNull()
  })
})

describe("faixa de decisão pendente — copy de cada tipo", () => {
  it("card bloqueado e card em revisão dizem o estado, não o mesmo texto", () => {
    expect(decisionLine(card("blocked"))).toContain("Card bloqueado")
    expect(decisionLine(card("review"))).toContain("Card em revisão")
  })

  it("proposta sem projeto diz 'board inteiro' em vez de projeto vazio", () => {
    const p: Decision = {
      kind: "proposal",
      proposalId: "x",
      excerpt: "revisar backlog",
      body: "revisar backlog",
      createdAt: AGORA - HORA,
    }
    expect(decisionLine(p)).toBe("Proposta do lead · board inteiro")
  })

  it("plural só entra a partir de dois do mesmo tipo", () => {
    expect(decisionBreakdown([pr()])).toBe("1 PR")
    expect(decisionBreakdown([pr(), pr()])).toBe("2 PRs")
  })
})
