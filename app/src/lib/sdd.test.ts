import { describe, expect, it } from "vitest"
import {
  effectiveStage,
  nextStep,
  stagesForTrack,
  SDD_STAGES,
  type PrInfo,
  type SddPlan,
} from "./sdd"

/** Plano mínimo pros helpers puros (evidence/track com defaults de plano antigo). */
function makePlan(over: Partial<SddPlan> = {}): SddPlan {
  return {
    slug: "feat-x",
    title: "Feature X",
    sponsor: null,
    branch: null,
    createdAt: null,
    stage: "",
    stageRaw: "",
    evidenceStage: null,
    evidence: null,
    track: "full",
    stagesCompleted: [],
    artifacts: { prd: null, spec: null, migrations: [], sourceFiles: [], tests: [] },
    scenarioMatrix: [],
    navSurfaces: [],
    consistencyAnchors: [],
    verification: {},
    links: {},
    mergedAt: null,
    hasManifest: true,
    logTail: null,
    logEvents: [],
    ...over,
  }
}

function makePr(state: string | null): PrInfo {
  return { state, mergedBy: null, mergedAt: null, createdAt: null, source: "gh" }
}

describe("effectiveStage", () => {
  it("sem pr e sem evidência → o declarado (planos antigos intactos)", () => {
    expect(effectiveStage(makePlan({ stage: "spec" }), null)).toBe("spec")
    expect(effectiveStage(makePlan({ stage: "" }), null)).toBe("")
  })
  it("declarado à frente da evidência → mantém o declarado (monotônico)", () => {
    const p = makePlan({ stage: "test", evidenceStage: "implementation" })
    expect(effectiveStage(p, null)).toBe("test")
  })
  it("evidência à frente do declarado → avança pro derivado", () => {
    const p = makePlan({ stage: "prd", evidenceStage: "implementation" })
    expect(effectiveStage(p, null)).toBe("implementation")
  })
  it("PR mergeada → done, mesmo com declarado/evidência atrás", () => {
    const p = makePlan({ stage: "implementation", evidenceStage: "implementation" })
    expect(effectiveStage(p, makePr("MERGED"))).toBe("done")
  })
  it("PR existente (OPEN/CLOSED) → pelo menos pr", () => {
    const p = makePlan({ stage: "review" })
    expect(effectiveStage(p, makePr("OPEN"))).toBe("pr")
    expect(effectiveStage(p, makePr("CLOSED"))).toBe("pr")
  })
  it("nunca REGRIDE: declarado done fica done mesmo com sinais atrás", () => {
    const p = makePlan({ stage: "done", evidenceStage: "prd" })
    expect(effectiveStage(p, makePr("OPEN"))).toBe("done")
  })
  it("evidência com stage desconhecido não derruba o declarado", () => {
    const p = makePlan({ stage: "spec", evidenceStage: "banana" })
    expect(effectiveStage(p, null)).toBe("spec")
  })
})

describe("stagesForTrack", () => {
  it("full = pipeline inteiro", () => {
    expect(stagesForTrack("full")).toEqual(SDD_STAGES)
  })
  it("quick pula prd e spec (Descoberta→Impl→Testes→Review→PR→Concluído)", () => {
    expect(stagesForTrack("quick")).toEqual([
      "discovery",
      "implementation",
      "test",
      "review",
      "pr",
      "done",
    ])
  })
})

describe("nextStep (trilha)", () => {
  it("full: depois da descoberta vem o /prd", () => {
    const p = makePlan({ stage: "discovery", track: "full" })
    expect(nextStep(p)?.skill).toBe("prd")
  })
  it("quick: depois da descoberta vai DIRETO pro /developer", () => {
    const p = makePlan({ stage: "discovery", track: "quick" })
    expect(nextStep(p)).toEqual({ skill: "developer", prompt: "/developer feat-x" })
  })
  it("quick não trava no gate do PRD (não há PRD formal)", () => {
    const p = makePlan({
      stage: "prd",
      track: "quick",
      artifacts: {
        prd: { path: "PRD.md", approved: false, approvedAt: null },
        spec: null,
        migrations: [],
        sourceFiles: [],
        tests: [],
      },
    })
    expect(nextStep(p)?.blockedBy).toBeUndefined()
    expect(nextStep(p)?.skill).toBe("developer")
  })
  it("full mantém o gate do PRD não aprovado", () => {
    const p = makePlan({
      stage: "prd",
      artifacts: {
        prd: { path: "PRD.md", approved: false, approvedAt: null },
        spec: null,
        migrations: [],
        sourceFiles: [],
        tests: [],
      },
    })
    expect(nextStep(p)?.blockedBy).toBe("prd")
  })
  it("aceita o stage EFETIVO como override (sugere a partir da realidade)", () => {
    const p = makePlan({ stage: "prd", track: "full", evidenceStage: "implementation" })
    expect(nextStep(p, effectiveStage(p, null))?.skill).toBe("test-suite")
  })
  it("done → null (nada a rodar)", () => {
    expect(nextStep(makePlan({ stage: "done" }))).toBeNull()
    expect(nextStep(makePlan({ stage: "done", track: "quick" }))).toBeNull()
  })
})
