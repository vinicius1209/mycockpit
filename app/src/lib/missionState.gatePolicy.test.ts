// MH3.3 — a política de gate SOBREVIVE ao restart: runToState serializa o
// gatePolicy do run no preset efetivo e parseRunState o preserva (a retomada
// reconstrói o preset dali). Arquivo legado sem o campo = "agente" implícito
// (o motor normaliza; nada quebra).
import { describe, expect, it } from "vitest"
import type { MissionRun } from "@/lib/missionTypes"
import { parseRunState, runToState } from "./missionState"

function runOf(over: Partial<MissionRun> = {}): MissionRun {
  return {
    id: "m1",
    convId: "c1",
    presetName: "Feature completa · personalizado",
    task: "arruma o parser",
    dir: ".mycockpit/missions/2026-08-04-m1-arruma-o-parser",
    phases: [
      {
        def: {
          id: "plan",
          label: "Planejar",
          persona: "planner",
          agent: "claude-code",
          model: "opus",
          effort: null,
          maxRetries: 1,
        },
        status: "done",
        attempt: 1,
        costUsd: 0.4,
        startedAt: 1,
      },
      {
        def: {
          id: "build",
          label: "Executar",
          persona: "executor",
          agent: "codex",
          model: null,
          effort: null,
          maxRetries: 2,
        },
        status: "running",
        attempt: 1,
        costUsd: 0,
        startedAt: 2,
      },
    ],
    current: 1,
    costTotal: 0.4,
    maxCostUsd: 25,
    status: "running",
    startedAt: 1,
    ...over,
  }
}

describe("runToState + parseRunState — gatePolicy no preset efetivo", () => {
  it("round-trip preserva a política ('nunca' sobrevive a crash e retomada)", () => {
    const state = runToState(runOf({ gatePolicy: "nunca" }))
    expect(state.preset.gatePolicy).toBe("nunca")
    const parsed = parseRunState(JSON.stringify(state))
    expect(parsed?.preset.gatePolicy).toBe("nunca")
  })

  it("run sem política: o campo NÃO entra no arquivo (legado limpo = 'agente' implícito)", () => {
    const state = runToState(runOf())
    expect("gatePolicy" in state.preset).toBe(false)
    const parsed = parseRunState(JSON.stringify(state))
    expect(parsed?.preset.gatePolicy).toBeUndefined()
  })
})
