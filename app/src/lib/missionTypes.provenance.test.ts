// PROCEDÊNCIA das fases e o contador honesto do plano. O plano de voo cresce
// sozinho quando o revisor reprova (o motor acrescenta Corrigir + Revisar), e
// o crescimento é CORRETO: missão que acha problema tem que corrigir. O que
// não pode é a fase acrescentada parecer nativa e o denominador de
// "fase X de N" trocar calado.
//
// As fixtures usam os ids REAIS que o loop de correção gera
// (`fix-<n>-<missionId.slice(0,6)>`, missionEngine.afterPhaseDone) — é o mesmo
// formato que missionState.derivedReviewLoops já lê pro clamp.

import { describe, expect, it } from "vitest"
import {
  phaseProvenance,
  planCounts,
  planGrowthNote,
  type MissionPhaseDef,
} from "@/lib/missionTypes"

const SHORT = "m-eng1"

function nativa(over: Partial<MissionPhaseDef> = {}): MissionPhaseDef {
  return {
    id: "build",
    label: "Executar",
    persona: "executor",
    agent: "claude-code",
    model: null,
    effort: null,
    maxRetries: 1,
    ...over,
  }
}

/** Par corretivo como o motor grava HOJE (com o carimbo no def). */
function acrescentada(round: number, at: number): MissionPhaseDef[] {
  return [
    nativa({
      id: `fix-${round}-${SHORT}`,
      label: `Corrigir (rodada ${round})`,
      appendedInFlight: { round, at },
    }),
    nativa({
      id: `rereview-${round}-${SHORT}`,
      label: `Revisar (rodada ${round})`,
      persona: "reviewer",
      appendedInFlight: { round, at },
    }),
  ]
}

describe("procedência de uma fase", () => {
  it("fase do plano lançado não tem procedência (null): nada a declarar", () => {
    expect(phaseProvenance(nativa())).toBeNull()
    expect(phaseProvenance(nativa({ id: "review" }))).toBeNull()
  })

  it("fase acrescentada no voo carrega a rodada e o instante do carimbo", () => {
    const [fix, rereview] = acrescentada(1, 1_700_000_000_000)
    expect(phaseProvenance(fix)).toEqual({ round: 1, at: 1_700_000_000_000 })
    expect(phaseProvenance(rereview)).toEqual({ round: 1, at: 1_700_000_000_000 })
  })

  it("missão em voo persistida ANTES do carimbo existir: a rodada sai do id, com o instante desconhecido (nunca vira fase nativa)", () => {
    const legado = nativa({
      id: `fix-2-${SHORT}`,
      label: "Corrigir (rodada 2)",
    })
    expect(legado.appendedInFlight).toBeUndefined()
    expect(phaseProvenance(legado)).toEqual({ round: 2, at: null })
  })
})

describe("contador do plano · os dois números", () => {
  it("plano intacto: total = lançadas, nada acrescentado e nenhuma declaração", () => {
    const phases = [nativa(), nativa({ id: "review", persona: "reviewer" })]
    expect(planCounts(phases)).toEqual({ total: 2, launched: 2, appended: 0 })
    expect(planGrowthNote(planCounts(phases))).toBeNull()
  })

  it("uma rodada de correção: 4 fases, lançou com 2, e a declaração diz as duas coisas", () => {
    const phases = [
      nativa(),
      nativa({ id: "review", persona: "reviewer" }),
      ...acrescentada(1, 111),
    ]
    expect(planCounts(phases)).toEqual({ total: 4, launched: 2, appended: 2 })
    expect(planGrowthNote(planCounts(phases))).toBe(
      "lançou com 2 · 2 fases acrescentadas no voo",
    )
  })

  it("correção INSERIDA NO MEIO conta igual (a posição não muda a contagem)", () => {
    const phases = [
      nativa({ id: "migrar", label: "Migrar o schema" }),
      nativa({ id: "review", label: "Revisar o schema", persona: "reviewer" }),
      ...acrescentada(1, 222),
      nativa({ id: "port", label: "Portar o checkout" }),
      nativa({ id: "hist", label: "Portar o histórico" }),
    ]
    expect(planCounts(phases)).toEqual({ total: 6, launched: 4, appended: 2 })
  })

  it("duas rodadas (o teto de MAX_REVIEW_LOOPS): 4 acrescentadas, o plano de lançamento continua legível", () => {
    const phases = [
      nativa(),
      nativa({ id: "review", persona: "reviewer" }),
      ...acrescentada(1, 111),
      ...acrescentada(2, 222),
    ]
    expect(planCounts(phases)).toEqual({ total: 6, launched: 2, appended: 4 })
    expect(planGrowthNote(planCounts(phases))).toBe(
      "lançou com 2 · 4 fases acrescentadas no voo",
    )
  })

  it("singular quando é uma fase só (a copy não fica no plural falso)", () => {
    expect(planGrowthNote({ launched: 3, appended: 1 })).toBe(
      "lançou com 3 · 1 fase acrescentada no voo",
    )
  })
})
