import { describe, expect, it } from "vitest"
import type {
  MissionPhaseDef,
  MissionPlanEdge,
  MissionPlanGraph,
  MissionTransition,
} from "@/lib/missionTypes"
import {
  MAX_MISSION_GRAPH_VISITS,
  countMissionGraphTraversals,
  resolveMissionGraph,
  validateMissionGraph,
} from "./missionGraph"

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

function graph(
  edges: MissionPlanEdge[],
  nodeIds: string[] = ["start", "ok", "fix"],
): MissionPlanGraph {
  return {
    version: 1,
    entryNodeId: `node-${nodeIds[0]}`,
    nodes: nodeIds.map((id, index) => ({
      id: `node-${id}`,
      phaseId: id,
      position: { x: index * 200, y: 0 },
    })),
    edges,
  }
}

function phases(ids: string[] = ["start", "ok", "fix"]): MissionPhaseDef[] {
  return ids.map(phase)
}

function traversal(
  edgeId: string,
  source = "node-start",
  target = "node-fix",
): MissionTransition {
  return {
    edgeId,
    sourceNodeId: source,
    targetNodeId: target,
    sourceVisit: 0,
    targetVisit: 1,
    outcome: "failure",
    at: 1,
  }
}

describe("validateMissionGraph · contrato canônico serial", () => {
  it("aceita branch success/failure com fallback always determinístico", () => {
    const value = graph([
      {
        id: "success",
        source: "node-start",
        target: "node-ok",
        condition: "success",
      },
      {
        id: "failure",
        source: "node-start",
        target: "node-fix",
        condition: "failure",
      },
      {
        id: "finish-fix",
        source: "node-fix",
        target: "node-ok",
        condition: "always",
      },
    ])
    expect(validateMissionGraph(value, phases())).toEqual([])
  })

  it("rejeita IDs duplicados de fase, nó e aresta", () => {
    const value = graph([
      {
        id: "same",
        source: "node-start",
        target: "node-ok",
        condition: "success",
      },
      {
        id: "same",
        source: "node-start",
        target: "node-fix",
        condition: "failure",
      },
    ])
    value.nodes[1].id = "node-start"
    const issues = validateMissionGraph(value, [phase("start"), phase("start"), phase("fix")])
    expect(issues.join("\n")).toContain("fase duplicado")
    expect(issues.join("\n")).toContain("nó duplicado")
    expect(issues.join("\n")).toContain("aresta duplicado")
  })

  it("exige referência 1:1 entre nós e fases", () => {
    const value = graph([])
    value.nodes[1].phaseId = "start"
    const issues = validateMissionGraph(value, phases())
    expect(issues).toContain("A fase start é referenciada por mais de um nó.")
    expect(issues).toContain("A fase ok não possui nó correspondente.")
  })

  it("exige entry válido e todos os nós alcançáveis", () => {
    const value = graph([
      {
        id: "start-ok",
        source: "node-start",
        target: "node-ok",
        condition: "success",
      },
    ])
    value.entryNodeId = "node-missing"
    expect(validateMissionGraph(value, phases())).toContain(
      "O grafo precisa de um nó de entrada válido.",
    )

    value.entryNodeId = "node-start"
    expect(validateMissionGraph(value, phases())).toContain(
      "O nó node-fix não é alcançável a partir da entrada.",
    )
  })

  it("permite no máximo uma aresta por condição em cada source", () => {
    const value = graph([
      {
        id: "a",
        source: "node-start",
        target: "node-ok",
        condition: "success",
      },
      {
        id: "b",
        source: "node-start",
        target: "node-fix",
        condition: "success",
      },
    ])
    expect(validateMissionGraph(value, phases())).toContain(
      "O nó node-start possui mais de uma aresta success.",
    )
  })

  it("rejeita ciclo quando qualquer aresta interna não tem limite", () => {
    const value = graph(
      [
        {
          id: "go",
          source: "node-start",
          target: "node-fix",
          condition: "success",
          maxTraversals: 2,
        },
        {
          id: "back",
          source: "node-fix",
          target: "node-start",
          condition: "failure",
        },
      ],
      ["start", "fix"],
    )
    expect(validateMissionGraph(value, phases(["start", "fix"]))).toContain(
      "A aresta cíclica back precisa de maxTraversals inteiro e maior que zero.",
    )
  })

  it("aceita ciclo quando todas as arestas internas têm limite inteiro positivo", () => {
    const value = graph(
      [
        {
          id: "go",
          source: "node-start",
          target: "node-fix",
          condition: "success",
          maxTraversals: 2,
        },
        {
          id: "back",
          source: "node-fix",
          target: "node-start",
          condition: "failure",
          maxTraversals: 2,
        },
      ],
      ["start", "fix"],
    )
    expect(validateMissionGraph(value, phases(["start", "fix"]))).toEqual([])
  })

  it("rejeita um grafo sem qualquer pouso por sucesso", () => {
    const value = graph(
      [
        {
          id: "go",
          source: "node-start",
          target: "node-fix",
          condition: "always",
          maxTraversals: 2,
        },
        {
          id: "back",
          source: "node-fix",
          target: "node-start",
          condition: "always",
          maxTraversals: 2,
        },
      ],
      ["start", "fix"],
    )
    expect(validateMissionGraph(value, phases(["start", "fix"]))).toContain(
      "O grafo precisa de ao menos um término por sucesso.",
    )
  })

  it("rejeita maxTraversals fracionário mesmo fora de ciclo", () => {
    const value = graph([
      {
        id: "go",
        source: "node-start",
        target: "node-ok",
        condition: "success",
        maxTraversals: 1.5,
      },
      {
        id: "reach-fix",
        source: "node-ok",
        target: "node-fix",
        condition: "always",
      },
    ])
    expect(validateMissionGraph(value, phases())).toContain(
      "A aresta go precisa de maxTraversals inteiro e maior que zero.",
    )
  })
})

describe("resolveMissionGraph · outcome e travessias", () => {
  const branch = graph([
    {
      id: "success",
      source: "node-start",
      target: "node-ok",
      condition: "success",
    },
    {
      id: "failure",
      source: "node-start",
      target: "node-fix",
      condition: "failure",
      maxTraversals: 2,
    },
    {
      id: "finish-fix",
      source: "node-fix",
      target: "node-ok",
      condition: "always",
    },
  ])

  it("a condição exata vence always e o fallback cobre a condição ausente", () => {
    const withFallback = {
      ...branch,
      edges: [
        ...branch.edges,
        {
          id: "fallback",
          source: "node-start",
          target: "node-fix",
          condition: "always" as const,
        },
      ],
    }
    const exact = resolveMissionGraph({
      graph: withFallback,
      phases: phases(),
      currentNodeId: "node-start",
      outcome: "success",
      history: [],
    })
    expect(exact.kind).toBe("advance")
    if (exact.kind === "advance") expect(exact.edge.id).toBe("success")

    const fallbackOnly = graph([
      {
        id: "fallback",
        source: "node-start",
        target: "node-ok",
        condition: "always",
      },
      {
        id: "reach-fix",
        source: "node-ok",
        target: "node-fix",
        condition: "success",
      },
    ])
    const fallback = resolveMissionGraph({
      graph: fallbackOnly,
      phases: phases(),
      currentNodeId: "node-start",
      outcome: "failure",
      history: [],
    })
    expect(fallback.kind).toBe("advance")
    if (fallback.kind === "advance") expect(fallback.edge.id).toBe("fallback")
  })

  it("conta travessias do histórico e devolve advance com os próximos números", () => {
    const history = [traversal("failure")]
    expect(countMissionGraphTraversals(history, "failure")).toBe(1)
    const result = resolveMissionGraph({
      graph: branch,
      phases: phases(),
      currentNodeId: "node-start",
      outcome: "failure",
      history,
    })
    expect(result.kind).toBe("advance")
    if (result.kind === "advance") {
      expect(result.targetNodeId).toBe("node-fix")
      expect(result.traversal).toBe(2)
      expect(result.visit).toBe(3)
    }
  })

  it("devolve edge-exhausted ao atingir maxTraversals", () => {
    const result = resolveMissionGraph({
      graph: branch,
      phases: phases(),
      currentNodeId: "node-start",
      outcome: "failure",
      history: [traversal("failure"), traversal("failure")],
    })
    expect(result).toMatchObject({
      kind: "edge-exhausted",
      traversals: 2,
      maxTraversals: 2,
    })
  })

  it("não cai em always quando a aresta exata existe, mas está esgotada", () => {
    const value = {
      ...branch,
      edges: [
        ...branch.edges,
        {
          id: "fallback",
          source: "node-start",
          target: "node-ok",
          condition: "always" as const,
        },
      ],
    }
    const result = resolveMissionGraph({
      graph: value,
      phases: phases(),
      currentNodeId: "node-start",
      outcome: "failure",
      history: [traversal("failure"), traversal("failure")],
    })
    expect(result.kind).toBe("edge-exhausted")
  })

  it("sem aresta, sucesso termina e falha é erro", () => {
    const terminal = graph(
      [
        {
          id: "reach-ok",
          source: "node-start",
          target: "node-ok",
          condition: "success",
        },
      ],
      ["start", "ok"],
    )
    expect(
      resolveMissionGraph({
        graph: terminal,
        phases: phases(["start", "ok"]),
        currentNodeId: "node-ok",
        outcome: "success",
        history: [traversal("reach-ok", "node-start", "node-ok")],
      }),
    ).toMatchObject({ kind: "finish", nodeId: "node-ok" })
    expect(
      resolveMissionGraph({
        graph: terminal,
        phases: phases(["start", "ok"]),
        currentNodeId: "node-ok",
        outcome: "failure",
        history: [traversal("reach-ok", "node-start", "node-ok")],
      }).kind,
    ).toBe("error")
  })

  it("impede a visita 101 mesmo com aresta disponível", () => {
    const history = Array.from(
      { length: MAX_MISSION_GRAPH_VISITS - 1 },
      () => traversal("unrelated"),
    )
    const result = resolveMissionGraph({
      graph: branch,
      phases: phases(),
      currentNodeId: "node-start",
      outcome: "success",
      history,
    })
    expect(result).toEqual({
      kind: "error",
      reason: "A missão atingiu o limite estrutural de 100 visitas.",
    })
  })

  it("grafo inválido e nó corrente ausente falham fechados", () => {
    const invalid = { ...branch, entryNodeId: "missing" }
    expect(
      resolveMissionGraph({
        graph: invalid,
        phases: phases(),
        currentNodeId: "node-start",
        outcome: "success",
        history: [],
      }).kind,
    ).toBe("error")
    expect(
      resolveMissionGraph({
        graph: branch,
        phases: phases(),
        currentNodeId: "node-missing",
        outcome: "success",
        history: [],
      }),
    ).toEqual({
      kind: "error",
      reason: "O nó corrente node-missing não existe no grafo.",
    })
  })
})
