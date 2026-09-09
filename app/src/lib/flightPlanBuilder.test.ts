import { describe, expect, it } from "vitest"
import {
  cloneFlightPlan,
  createFlightPlan,
  createFlightPlanPhase,
  flightPlanStats,
} from "@/lib/flightPlanBuilder"

function deterministicIds() {
  let next = 0
  return (prefix: "phase" | "plan") => `${prefix}-${++next}`
}

describe("flightPlanBuilder", () => {
  it("cria um fluxo visual já executável e com saída de sucesso", () => {
    const plan = createFlightPlan("graph", deterministicIds())

    expect(plan.mode).toBe("graph")
    expect(plan.phases.map((phase) => phase.persona)).toEqual([
      "planner",
      "executor",
      "reviewer",
    ])
    expect(flightPlanStats(plan)).toEqual({
      phases: 3,
      connections: 2,
      returns: 0,
      successExits: 1,
    })
  })

  it("cria o papel escolhido com defaults coerentes", () => {
    const phase = createFlightPlanPhase("reviewer", deterministicIds())

    expect(phase).toMatchObject({
      id: "phase-1",
      label: "Revisar",
      persona: "reviewer",
      agent: "claude-code",
      maxRetries: 1,
    })
  })

  it("duplica profundamente sem compartilhar critérios, posições ou arestas", () => {
    const source = createFlightPlan("graph", deterministicIds())
    source.phases[0].entryCriteria = ["escopo confirmado"]
    const copy = cloneFlightPlan(source, {
      freshId: true,
      idFactory: () => "plan-copy",
    })

    copy.phases[0].entryCriteria![0] = "alterado"
    copy.graph!.nodes[0].position.x = 999
    copy.graph!.edges[0].condition = "failure"

    expect(copy.id).toBe("plan-copy")
    expect(source.phases[0].entryCriteria).toEqual(["escopo confirmado"])
    expect(source.graph!.nodes[0].position.x).not.toBe(999)
    expect(source.graph!.edges[0].condition).toBe("success")
  })
})
