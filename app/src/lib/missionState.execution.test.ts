import { describe, expect, it } from "vitest"
import type {
  MissionPhaseDef,
  MissionPreset,
  MissionRun,
} from "./missionTypes"
import { parseRunState, runToState } from "./missionState"

function phase(
  id: string,
  persona: MissionPhaseDef["persona"],
  agent = "claude-code",
): MissionPhaseDef {
  return {
    id,
    label: id === "plan" ? "Planejar" : "Revisar",
    persona,
    agent,
    model: null,
    effort: null,
    maxRetries: 2,
  }
}

function plan(): MissionPreset {
  const planner = phase("plan", "planner")
  const reviewer = phase("review", "reviewer")
  return {
    id: "feature-graph",
    revision: 7,
    name: "Feature com revisão",
    description: "Planeja e revisa com loop limitado.",
    mode: "graph",
    phases: [planner, reviewer],
    graph: {
      version: 1,
      entryNodeId: "node-plan",
      nodes: [
        { id: "node-plan", phaseId: "plan", position: { x: 0, y: 0 } },
        { id: "node-review", phaseId: "review", position: { x: 260, y: 0 } },
      ],
      edges: [
        {
          id: "edge-review",
          source: "node-plan",
          target: "node-review",
          condition: "success",
        },
        {
          id: "edge-loop",
          source: "node-review",
          target: "node-review",
          condition: "failure",
          maxTraversals: 2,
        },
      ],
    },
    maxCostUsd: 25,
    gatePolicy: "agente",
  }
}

function runWithExecution(): MissionRun {
  const snapshot = plan()
  return {
    id: "mission-1",
    convId: "conv-1",
    presetName: snapshot.name,
    task: "implementar grafo",
    dir: ".mycockpit/missions/mission-1",
    phases: [
      {
        def: snapshot.phases[0],
        visitId: "visit-plan-1",
        nodeId: "node-plan",
        enteredViaEdgeId: null,
        outcome: "success",
        status: "done",
        attempt: 1,
        costUsd: 0.5,
        startedAt: 10,
        endedAt: 20,
      },
      {
        def: snapshot.phases[1],
        visitId: "visit-review-1",
        nodeId: "node-review",
        enteredViaEdgeId: "edge-review",
        outcome: "failure",
        status: "done",
        attempt: 1,
        costUsd: 0.4,
        startedAt: 21,
        endedAt: 30,
      },
      {
        // Recovery pode trocar o agent apenas nesta visita; o snapshot original
        // e a visita anterior continuam intactos.
        def: phase("review", "reviewer", "codex"),
        visitId: "visit-review-2",
        nodeId: "node-review",
        enteredViaEdgeId: "edge-loop",
        status: "running",
        attempt: 1,
        costUsd: 0,
        startedAt: 31,
      },
    ],
    current: 2,
    costTotal: 0.9,
    maxCostUsd: 25,
    status: "running",
    startedAt: 10,
    gate: { phase: 2, questions: ["Continuar pelo loop?"] },
    recovery: {
      phase: 2,
      error: "rate limit",
      message: "Escolha outro agent para continuar.",
    },
    execution: {
      version: 2,
      planId: snapshot.id,
      planRevision: snapshot.revision!,
      planSnapshot: snapshot,
      transitions: [
        {
          edgeId: "edge-review",
          sourceNodeId: "node-plan",
          targetNodeId: "node-review",
          sourceVisit: 0,
          targetVisit: 1,
          outcome: "success",
          at: 20,
        },
        {
          edgeId: "edge-loop",
          sourceNodeId: "node-review",
          targetNodeId: "node-review",
          sourceVisit: 1,
          targetVisit: 2,
          outcome: "failure",
          at: 30,
        },
      ],
    },
  }
}

describe("run-state v2 · snapshot e visitas", () => {
  it("preserva snapshot completo, transições e visitas repetidas", () => {
    const run = runWithExecution()
    const state = runToState(run)
    const back = parseRunState(JSON.stringify(state))

    expect(back?.version).toBe(2)
    expect(back?.execution?.planSnapshot).toEqual(plan())
    expect(back?.execution?.transitions).toEqual(run.execution?.transitions)
    expect(back?.phases.map((visit) => ({
      visitId: visit.visitId,
      nodeId: visit.nodeId,
      enteredViaEdgeId: visit.enteredViaEdgeId,
      outcome: visit.outcome,
      agent: visit.def?.agent,
    }))).toEqual([
      {
        visitId: "visit-plan-1",
        nodeId: "node-plan",
        enteredViaEdgeId: null,
        outcome: "success",
        agent: "claude-code",
      },
      {
        visitId: "visit-review-1",
        nodeId: "node-review",
        enteredViaEdgeId: "edge-review",
        outcome: "failure",
        agent: "claude-code",
      },
      {
        visitId: "visit-review-2",
        nodeId: "node-review",
        enteredViaEdgeId: "edge-loop",
        outcome: undefined,
        agent: "codex",
      },
    ])
  })

  it("congela o snapshot sem compartilhar referências com o run vivo", () => {
    const run = runWithExecution()
    const state = runToState(run)
    run.execution!.planSnapshot.name = "mudou nas Settings"
    run.execution!.transitions.push({
      edgeId: "lixo",
      sourceNodeId: "node-review",
      targetNodeId: "node-plan",
      sourceVisit: 2,
      targetVisit: 3,
      outcome: "success",
      at: 40,
    })

    expect(state.execution?.planSnapshot.name).toBe("Feature com revisão")
    expect(state.execution?.transitions).toHaveLength(2)
  })

  it("persiste gate e recovery pendentes", () => {
    const back = parseRunState(JSON.stringify(runToState(runWithExecution())))
    expect(back?.gate).toEqual({ phase: 2, questions: ["Continuar pelo loop?"] })
    expect(back?.recovery).toEqual({
      phase: 2,
      error: "rate limit",
      message: "Escolha outro agent para continuar.",
    })
  })

  it("não oferece retomada para um run sem contrato de execução v2", () => {
    const run = runWithExecution()
    delete run.execution
    const state = runToState(run)

    expect(state.execution?.version).toBe(2)
    expect(parseRunState(JSON.stringify(state))).toBeNull()
  })

  it("recusa transition, outcome e snapshot estruturalmente corrompidos", () => {
    const base = runToState(runWithExecution())
    const badTransition = structuredClone(base)
    badTransition.execution!.transitions[0].sourceVisit = -1
    expect(parseRunState(JSON.stringify(badTransition))).toBeNull()

    const danglingTransition = structuredClone(base)
    danglingTransition.execution!.transitions[0].targetVisit = 99
    expect(parseRunState(JSON.stringify(danglingTransition))).toBeNull()

    const wrongEdge = structuredClone(base)
    wrongEdge.execution!.transitions[0].edgeId = "edge-loop"
    expect(parseRunState(JSON.stringify(wrongEdge))).toBeNull()

    const duplicateVisit = structuredClone(base)
    duplicateVisit.phases[1].visitId = duplicateVisit.phases[0].visitId
    expect(parseRunState(JSON.stringify(duplicateVisit))).toBeNull()

    const missingTransition = structuredClone(base)
    missingTransition.execution!.transitions.pop()
    expect(parseRunState(JSON.stringify(missingTransition))).toBeNull()

    const mismatchedRevision = structuredClone(base)
    mismatchedRevision.execution!.planRevision = 8
    expect(parseRunState(JSON.stringify(mismatchedRevision))).toBeNull()

    const badOutcome = structuredClone(base) as unknown as Record<string, unknown>
    ;((badOutcome.phases as Array<Record<string, unknown>>)[0]).outcome = "talvez"
    expect(parseRunState(JSON.stringify(badOutcome))).toBeNull()

    const badSnapshot = structuredClone(base) as unknown as Record<string, unknown>
    const execution = badSnapshot.execution as Record<string, unknown>
    const snapshot = execution.planSnapshot as Record<string, unknown>
    const graph = snapshot.graph as Record<string, unknown>
    const firstNode = (graph.nodes as Array<Record<string, unknown>>)[0]
    ;(firstNode.position as Record<string, unknown>).x = "longe"
    expect(parseRunState(JSON.stringify(badSnapshot))).toBeNull()
  })
})
