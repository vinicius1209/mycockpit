import { describe, expect, it } from "vitest"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import {
  enableGraphMode,
  graphFromPhases,
  missionPlanMode,
  moveMissionPhase,
  parseMissionPlan,
  serializeMissionPlan,
  updateMissionNodePositions,
  validateMissionPlan,
} from "./missionPlans"

function phase(id: string): MissionPhaseDef {
  return {
    id,
    label: id,
    persona: "executor",
    agent: "codex",
    model: null,
    effort: null,
    maxRetries: 1,
  }
}

function preset(): MissionPreset {
  return {
    id: "feature",
    name: "Feature completa",
    phases: [phase("plan"), phase("build"), phase("review")],
    maxCostUsd: 20,
  }
}

describe("Planos de voo", () => {
  it("trata presets legados sem mode como lineares", () => {
    expect(missionPlanMode(preset())).toBe("linear")
    expect(validateMissionPlan(preset())).toEqual([])
  })

  it("abre um preset existente no canvas sem mudar a ordem executável", () => {
    const plan = enableGraphMode(preset())
    expect(plan.mode).toBe("graph")
    expect(plan.phases.map((p) => p.id)).toEqual(["plan", "build", "review"])
    expect(plan.graph?.entryNodeId).toBe("node-plan")
    expect(plan.graph?.edges.map((e) => [e.source, e.target])).toEqual([
      ["node-plan", "node-build"],
      ["node-build", "node-review"],
    ])
    expect(validateMissionPlan(plan)).toEqual([])
  })

  it("reordenar nós muda a projeção que o motor linear executa", () => {
    const moved = moveMissionPhase(enableGraphMode(preset()), 2, 1)
    expect(moved.phases.map((p) => p.id)).toEqual(["plan", "review", "build"])
    expect(moved.graph?.edges.map((e) => [e.source, e.target])).toEqual([
      ["node-plan", "node-review"],
      ["node-review", "node-build"],
    ])
    expect(moved.graph?.nodes.map((n) => n.position.x)).toEqual([56, 304, 552])
  })

  it("preserva posições do canvas ao sincronizar a rota", () => {
    const positioned = updateMissionNodePositions(enableGraphMode(preset()), {
      build: { x: 420, y: 180 },
    })
    const synced = graphFromPhases(positioned.phases, positioned.graph)
    expect(synced.nodes.find((n) => n.phaseId === "build")?.position).toEqual({
      x: 420,
      y: 180,
    })
  })

  it("exporta e importa o contrato versionado", () => {
    const raw = serializeMissionPlan(enableGraphMode(preset()))
    const parsed = parseMissionPlan(raw)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.plan.name).toBe("Feature completa")
      expect(parsed.plan.graph?.version).toBe(1)
    }
  })

  it("rejeita grafo ramificado enquanto o motor ainda é linear", () => {
    const plan = enableGraphMode(preset())
    plan.graph!.edges.push({
      id: "branch",
      source: "node-plan",
      target: "node-review",
      condition: "success",
    })
    expect(validateMissionPlan(plan)[0]).toContain("sem ramificações")
  })

  it("rejeita import com fase incompleta antes de chegar à UI", () => {
    const envelope = JSON.parse(serializeMissionPlan(preset()))
    delete envelope.plan.phases[0].agent
    expect(parseMissionPlan(JSON.stringify(envelope))).toEqual({
      ok: false,
      error: "O Plano de voo não possui fases válidas.",
    })
  })
})
