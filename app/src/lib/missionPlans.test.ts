import { describe, expect, it } from "vitest"
import { DEFAULT_MISSION_PRESETS } from "@/lib/missionDefaults"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import {
  autoLayoutMissionPlan,
  MISSION_PLAN_FORMAT,
  MISSION_PLAN_FORMAT_LEGADO,
  enableGraphMode,
  graphFromPhases,
  missionPlanMode,
  moveMissionPhase,
  parseMissionPlan,
  serializeMissionPlan,
  snapshotMissionPlan,
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
  it("mantém todos os planos de fábrica executáveis", () => {
    expect(
      DEFAULT_MISSION_PRESETS.map((plan) => [plan.name, validateMissionPlan(plan)]),
    ).toEqual([
      ["Feature completa", []],
      ["UI-first", []],
      ["Econômico", []],
    ])
  })

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

  it("reordenar a lista no Fluxo visual não reescreve a topologia", () => {
    const moved = moveMissionPhase(enableGraphMode(preset()), 2, 1)
    expect(moved.phases.map((p) => p.id)).toEqual(["plan", "review", "build"])
    expect(moved.graph?.edges.map((e) => [e.source, e.target])).toEqual([
      ["node-plan", "node-build"],
      ["node-build", "node-review"],
    ])
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

  it("reorganiza o caminho feliz na horizontal e a correção abaixo da revisão", () => {
    const laidOut = autoLayoutMissionPlan(DEFAULT_MISSION_PRESETS[0])
    const byPhase = new Map(
      laidOut.graph?.nodes.map((node) => [node.phaseId, node.position]),
    )
    expect(byPhase.get("plan")?.y).toBe(byPhase.get("build")?.y)
    expect(byPhase.get("build")?.y).toBe(byPhase.get("verify")?.y)
    expect(byPhase.get("build")?.x).toBeLessThan(byPhase.get("verify")!.x)
    expect(byPhase.get("fix")?.x).toBe(byPhase.get("verify")?.x)
    expect(byPhase.get("fix")!.y).toBeGreaterThan(
      byPhase.get("verify")!.y,
    )
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

  it("aceita ramificação determinística por sucesso e falha", () => {
    const plan = enableGraphMode(preset())
    plan.graph!.edges.push({
      id: "branch",
      source: "node-plan",
      target: "node-review",
      condition: "failure",
    })
    expect(validateMissionPlan(plan)).toEqual([])
  })

  it("snapshot é profundo e preserva a topologia escolhida", () => {
    const original = enableGraphMode(preset())
    original.revision = 4
    const snapshot = snapshotMissionPlan(original)
    original.phases[0].label = "mudou"
    original.graph!.edges[0].target = "node-review"
    expect(snapshot.revision).toBe(4)
    expect(snapshot.phases[0].label).toBe("plan")
    expect(snapshot.graph?.edges[0].target).toBe("node-build")
  })

  it("rejeita import com fase incompleta antes de chegar à UI", () => {
    const envelope = JSON.parse(serializeMissionPlan(preset()))
    delete envelope.plan.phases[0].agent
    expect(parseMissionPlan(JSON.stringify(envelope))).toEqual({
      ok: false,
      error: "O Plano de voo não possui fases válidas.",
    })
  })

  it("rejeita teto zero, que impediria a primeira fase de iniciar", () => {
    expect(validateMissionPlan({ ...preset(), maxCostUsd: 0 })).toEqual([
      "O teto de custo precisa ser maior que zero ou ficar vazio.",
    ])
    const envelope = JSON.parse(serializeMissionPlan(preset()))
    envelope.plan.maxCostUsd = 0
    expect(parseMissionPlan(JSON.stringify(envelope))).toEqual({
      ok: false,
      error: "O teto de custo precisa ser maior que zero ou ficar vazio.",
    })
    expect(validateMissionPlan({ ...preset(), maxCostUsd: Number.NaN })).toEqual([
      "O teto de custo precisa ser maior que zero ou ficar vazio.",
    ])
    expect(
      validateMissionPlan({ ...preset(), maxCostUsd: Number.POSITIVE_INFINITY }),
    ).toEqual([
      "O teto de custo precisa ser maior que zero ou ficar vazio.",
    ])
  })
})

describe("janela do rename: formato do plano de voo", () => {
  /** Um export REAL, montado pelo próprio serializador, com o formato trocado. */
  function exportadoCom(formato: string): string {
    const real = JSON.parse(serializeMissionPlan(preset()))
    return JSON.stringify({ ...real, format: formato })
  }

  it("aceita plano exportado com o discriminador ANTIGO", () => {
    // `projectConfigs.flight-plan` está gravado DENTRO de todo plano já exportado,
    // e o arquivo está no disco de quem exportou. Recusar viraria "arquivo
    // inválido" sem explicação (ADR-222).
    const r = parseMissionPlan(exportadoCom(MISSION_PLAN_FORMAT_LEGADO))
    expect(r.ok, r.ok ? "" : r.error).toBe(true)
  })

  it("aceita plano com o discriminador novo", () => {
    expect(parseMissionPlan(serializeMissionPlan(preset())).ok).toBe(true)
  })

  it("recusa discriminador de outro produto", () => {
    expect(parseMissionPlan(exportadoCom("outro.flight-plan")).ok).toBe(false)
  })

  it("exporta sempre com o nome novo", () => {
    expect(MISSION_PLAN_FORMAT).toBe("frota.flight-plan")
    expect(JSON.parse(serializeMissionPlan(preset())).format).toBe(MISSION_PLAN_FORMAT)
  })
})
