import { describe, expect, it } from "vitest"
import type {
  MissionPhaseDef,
  MissionPlanEdge,
  MissionPreset,
  MissionTransition,
} from "@/lib/missionTypes"
import {
  phaseForMissionNode,
  prepareMissionGraphPlan,
  resolveMissionVisit,
} from "./missionGraphRuntime"

function phase(id: string): MissionPhaseDef {
  return {
    id,
    label: id,
    persona: id === "review" ? "reviewer" : "executor",
    agent: "codex",
    model: null,
    effort: null,
    entryCriteria: [`entrada ${id}`],
    exitCriteria: [`saída ${id}`],
    maxRetries: 1,
  }
}

function preset(
  ids: string[],
  edges?: MissionPlanEdge[],
): MissionPreset {
  return {
    id: "feature",
    revision: 3,
    name: "Feature completa",
    phases: ids.map(phase),
    maxCostUsd: 20,
    ...(edges
      ? {
          mode: "graph" as const,
          graph: {
            version: 1 as const,
            entryNodeId: `node-${ids[0]}`,
            nodes: ids.map((id, index) => ({
              id: `node-${id}`,
              phaseId: id,
              position: { x: index * 220, y: 0 },
            })),
            edges,
          },
        }
      : {}),
  }
}

function transition(
  edgeId: string,
  sourceNodeId: string,
  targetNodeId: string,
  sourceVisit: number,
  targetVisit: number,
  outcome: "success" | "failure",
): MissionTransition {
  return {
    edgeId,
    sourceNodeId,
    targetNodeId,
    sourceVisit,
    targetVisit,
    outcome,
    at: targetVisit,
  }
}

describe("prepareMissionGraphPlan", () => {
  it("materializa um plano linear, congela uma cópia profunda e resolve a entrada", () => {
    const original = preset(["plan", "build"])
    const prepared = prepareMissionGraphPlan(original)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return

    expect(prepared.entryNodeId).toBe("node-plan")
    expect(prepared.entryPhase.id).toBe("plan")
    expect(prepared.snapshot.graph?.edges).toHaveLength(1)
    expect(prepared.snapshot).not.toBe(original)
    expect(prepared.snapshot.phases[0]).not.toBe(original.phases[0])

    original.phases[0].label = "mudou depois do lançamento"
    original.phases[0].entryCriteria![0] = "mudou também"
    expect(prepared.snapshot.phases[0].label).toBe("plan")
    expect(prepared.snapshot.phases[0].entryCriteria).toEqual(["entrada plan"])
  })

  it("falha fechado para plano estruturalmente inválido", () => {
    const invalid = preset(
      ["plan", "build"],
      [
        {
          id: "broken",
          source: "node-plan",
          target: "node-missing",
          condition: "success",
        },
      ],
    )
    const prepared = prepareMissionGraphPlan(invalid)
    expect(prepared.ok).toBe(false)
    if (!prepared.ok) expect(prepared.error).toContain("nó inexistente")
  })
})

describe("phaseForMissionNode", () => {
  it("resolve pelo phaseId do snapshot e devolve null para nó desconhecido", () => {
    const prepared = prepareMissionGraphPlan(preset(["plan", "build"]))
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(phaseForMissionNode(prepared.snapshot, "node-build")?.id).toBe(
      "build",
    )
    expect(phaseForMissionNode(prepared.snapshot, "node-missing")).toBeNull()
  })
})

describe("resolveMissionVisit", () => {
  it("escolhe o branch e materializa targetPhase + MissionTransition completa", () => {
    const prepared = prepareMissionGraphPlan(
      preset(
        ["plan", "build", "fix"],
        [
          {
            id: "plan-ok",
            source: "node-plan",
            target: "node-build",
            condition: "success",
          },
          {
            id: "plan-fail",
            source: "node-plan",
            target: "node-fix",
            condition: "failure",
          },
          {
            id: "fix-ok",
            source: "node-fix",
            target: "node-build",
            condition: "success",
          },
        ],
      ),
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return

    const result = resolveMissionVisit({
      snapshot: prepared.snapshot,
      currentNodeId: "node-plan",
      currentVisit: 0,
      outcome: "failure",
      history: [],
      at: 1_234,
    })
    expect(result).toMatchObject({
      kind: "advance",
      targetNodeId: "node-fix",
      targetPhase: { id: "fix" },
      transition: {
        edgeId: "plan-fail",
        sourceNodeId: "node-plan",
        targetNodeId: "node-fix",
        sourceVisit: 0,
        targetVisit: 1,
        outcome: "failure",
        at: 1_234,
      },
    })
  })

  it("repete um nó pelo loop e respeita o histórico de travessias", () => {
    const prepared = prepareMissionGraphPlan(
      preset(
        ["build", "review"],
        [
          {
            id: "to-review",
            source: "node-build",
            target: "node-review",
            condition: "success",
            maxTraversals: 2,
          },
          {
            id: "to-fix",
            source: "node-review",
            target: "node-build",
            condition: "failure",
            maxTraversals: 2,
          },
        ],
      ),
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const once = [
      transition("to-review", "node-build", "node-review", 0, 1, "success"),
    ]
    const repeat = resolveMissionVisit({
      snapshot: prepared.snapshot,
      currentNodeId: "node-review",
      currentVisit: 1,
      outcome: "failure",
      history: once,
      at: 20,
    })
    expect(repeat).toMatchObject({
      kind: "advance",
      targetNodeId: "node-build",
      traversal: 1,
      visit: 3,
      transition: { sourceVisit: 1, targetVisit: 2 },
    })

    const exhausted = resolveMissionVisit({
      snapshot: prepared.snapshot,
      currentNodeId: "node-review",
      currentVisit: 5,
      outcome: "failure",
      history: [
        ...once,
        transition("to-fix", "node-review", "node-build", 1, 2, "failure"),
        transition("to-review", "node-build", "node-review", 2, 3, "success"),
        transition("to-fix", "node-review", "node-build", 3, 4, "failure"),
        transition("to-review", "node-build", "node-review", 4, 5, "success"),
      ],
      at: 30,
    })
    expect(exhausted).toMatchObject({
      kind: "edge-exhausted",
      traversals: 2,
      maxTraversals: 2,
    })
  })

  it("propaga finish e erros sem inventar transição", () => {
    const prepared = prepareMissionGraphPlan(preset(["only"]))
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(
      resolveMissionVisit({
        snapshot: prepared.snapshot,
        currentNodeId: "node-only",
        currentVisit: 0,
        outcome: "success",
        history: [],
        at: 1,
      }),
    ).toEqual({ kind: "finish", nodeId: "node-only", outcome: "success" })
    expect(
      resolveMissionVisit({
        snapshot: prepared.snapshot,
        currentNodeId: "node-only",
        currentVisit: 0,
        outcome: "failure",
        history: [],
        at: 1,
      }).kind,
    ).toBe("error")
    expect(
      resolveMissionVisit({
        snapshot: prepared.snapshot,
        currentNodeId: "node-only",
        currentVisit: -1,
        outcome: "success",
        history: [],
        at: 1,
      }).kind,
    ).toBe("error")
    expect(
      resolveMissionVisit({
        snapshot: prepared.snapshot,
        currentNodeId: "node-only",
        currentVisit: 1,
        outcome: "success",
        history: [],
        at: 1,
      }),
    ).toEqual({
      kind: "error",
      reason: "A visita corrente não coincide com o histórico de transições.",
    })
  })
})
