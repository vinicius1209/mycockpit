import { describe, expect, it } from "vitest"
import {
  missionVisualEdgeHandles,
  missionVisualEdgeLabel,
  missionVisualTerminals,
} from "./missionGraphPresentation"
import type { MissionPlanGraph } from "./missionTypes"

const graph: MissionPlanGraph = {
  version: 1,
  entryNodeId: "plan",
  nodes: [
    { id: "plan", phaseId: "p", position: { x: 0, y: 0 } },
    { id: "review", phaseId: "r", position: { x: 220, y: 0 } },
    { id: "fix", phaseId: "f", position: { x: 220, y: 220 } },
  ],
  edges: [
    { id: "plan-review", source: "plan", target: "review", condition: "success" },
    {
      id: "review-fix",
      source: "review",
      target: "fix",
      condition: "failure",
      label: "Reprovado",
      maxTraversals: 2,
    },
    {
      id: "fix-review",
      source: "fix",
      target: "review",
      condition: "success",
      label: "Corrigido",
      maxTraversals: 2,
    },
  ],
}

describe("projecao visual do grafo de missao", () => {
  it("materializa somente o término por sucesso que o motor deixa implícito", () => {
    expect(missionVisualTerminals(graph)).toEqual([
      {
        id: "mission-terminal:review",
        sourceNodeId: "review",
        position: { x: 444, y: 8 },
      },
    ])
  })

  it("separa as duas direções do ciclo em portas paralelas", () => {
    expect(missionVisualEdgeHandles(graph, graph.edges[1])).toEqual({
      sourceHandle: "source-bottom-out",
      targetHandle: "target-top-in",
    })
    expect(missionVisualEdgeHandles(graph, graph.edges[2])).toEqual({
      sourceHandle: "source-top-return",
      targetHandle: "target-bottom-return",
    })
  })

  it("explica o limite uma vez, na rota de reprovar", () => {
    expect(missionVisualEdgeLabel(graph, graph.edges[1])).toBe(
      "Reprovado · até 2 correções",
    )
    expect(missionVisualEdgeLabel(graph, graph.edges[1], 1)).toBe(
      "Reprovado · 1/2 correções",
    )
    expect(missionVisualEdgeLabel(graph, graph.edges[2], 1)).toBe("Corrigido")
  })
})
