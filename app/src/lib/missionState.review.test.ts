// A memória do loop de revisão sobrevive a crash no snapshot v2. Run-state v1
// não migra: o projeto ainda está em construção e o contrato novo é intencional.

import { describe, expect, it } from "vitest"
import type { MissionPhaseDef, MissionRun } from "@/lib/missionTypes"
import { parseRunState, runToState } from "./missionState"

function phaseDef(over: Partial<MissionPhaseDef> = {}): MissionPhaseDef {
  return {
    id: "p",
    label: "Fase",
    persona: "executor",
    agent: "claude-code",
    model: null,
    effort: null,
    maxRetries: 1,
    ...over,
  }
}

function missionRun(over: Partial<MissionRun> = {}): MissionRun {
  return {
    id: "m-1234567890",
    convId: "c1",
    presetName: "Teste",
    task: "tarefa",
    dir: ".mycockpit/missions/x",
    phases: [
      {
        def: phaseDef({ id: "build", label: "Executar" }),
        status: "done",
        attempt: 1,
        costUsd: 0.5,
        startedAt: 1,
      },
    ],
    current: 1,
    costTotal: 0.5,
    maxCostUsd: null,
    status: "running",
    startedAt: 1,
    ...over,
  }
}

describe("run-state · memória do loop de revisão (MH1.1 fix)", () => {
  it("round-trip: reviewLoops, lastReview e reviewCaveat sobrevivem a serializar→parsear", () => {
    const run = missionRun({
      status: "done",
      reviewCaveat: {
        rounds: 2,
        feedback: "NÃO APROVADO: o retry segue sem teste.",
      },
    })
    const state = runToState(run, null, {
      loops: 2,
      last: {
        approved: false,
        feedback: "NÃO APROVADO: o retry segue sem teste.",
      },
    })
    const back = parseRunState(JSON.stringify(state))
    expect(back?.reviewLoops).toBe(2)
    expect(back?.lastReview).toEqual({
      approved: false,
      feedback: "NÃO APROVADO: o retry segue sem teste.",
    })
    expect(back?.reviewCaveat).toEqual({
      rounds: 2,
      feedback: "NÃO APROVADO: o retry segue sem teste.",
    })
  })

  it("sem estado de revisão (missão sem reviewer): grava 0/null e volta 0/null", () => {
    const state = runToState(missionRun(), null)
    expect(state.reviewLoops).toBe(0)
    expect(state.lastReview).toBeNull()
    expect(state.reviewCaveat).toBeNull()
    const back = parseRunState(JSON.stringify(state))
    expect(back?.reviewLoops).toBe(0)
    expect(back?.lastReview).toBeNull()
    expect(back?.reviewCaveat).toBeNull()
  })

  it("run-state v1 é recusado sem migração silenciosa", () => {
    const legado = {
      version: 1,
      missionId: "m-crash-1234",
      dir: ".mycockpit/missions/m-crash",
      convId: "c1",
      task: "tarefa",
      preset: {
        id: "t",
        name: "Teste",
        phases: [
          phaseDef({ id: "build" }),
          phaseDef({ id: "review", persona: "reviewer" }),
          phaseDef({ id: "fix-1-m-cras", label: "Corrigir (rodada 1)" }),
          phaseDef({
            id: "rereview-1-m-cras",
            label: "Revisar (rodada 1)",
            persona: "reviewer",
          }),
          phaseDef({ id: "fix-2-m-cras", label: "Corrigir (rodada 2)" }),
          phaseDef({
            id: "rereview-2-m-cras",
            label: "Revisar (rodada 2)",
            persona: "reviewer",
          }),
        ],
        maxCostUsd: null,
      },
      current: 5,
      phases: [],
      costTotal: 1.3,
      maxCostUsd: null,
      status: "running",
      updatedAt: 123,
    }
    const back = parseRunState(JSON.stringify(legado))
    expect(back).toBeNull()
  })

  it("lixo nos campos novos não derruba o parse (defaults honestos)", () => {
    const state = {
      ...runToState(missionRun(), null),
      reviewLoops: "dois" as unknown as number,
      lastReview: { approved: "sim" } as never,
      reviewCaveat: { rounds: "2" } as never,
    }
    const back = parseRunState(JSON.stringify(state))
    expect(back).not.toBeNull()
    expect(back?.reviewLoops).toBe(0) // sem fases corretivas pra derivar
    expect(back?.lastReview).toBeNull()
    expect(back?.reviewCaveat).toBeNull()
  })
})
