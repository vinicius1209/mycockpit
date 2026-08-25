// PROJEÇÃO VISUAL do grafo executável. O domínio persiste apenas fases, nós e
// conexões; terminais de sucesso, rótulos humanos e portas de roteamento são
// derivados para a UI e nunca contaminam o snapshot que o motor executa.

import type {
  MissionPlanEdge,
  MissionPlanGraph,
} from "@/lib/missionTypes"

export const MISSION_VISUAL_TERMINAL_PREFIX = "mission-terminal:"

export interface MissionVisualTerminal {
  id: string
  sourceNodeId: string
  position: { x: number; y: number }
}

export interface MissionVisualEdgeHandles {
  sourceHandle: string
  targetHandle: string
}

/** Um success sem rota encerra a missão. A UI materializa esse destino para a
 * pessoa não precisar conhecer a convenção interna do interpretador. */
export function missionVisualTerminals(
  graph: MissionPlanGraph,
): MissionVisualTerminal[] {
  const outgoing = new Map<string, Set<MissionPlanEdge["condition"]>>()
  for (const edge of graph.edges) {
    const conditions = outgoing.get(edge.source) ?? new Set()
    conditions.add(edge.condition)
    outgoing.set(edge.source, conditions)
  }
  return graph.nodes.flatMap((node) => {
    const conditions = outgoing.get(node.id)
    if (conditions?.has("success") || conditions?.has("always")) return []
    return [
      {
        id: `${MISSION_VISUAL_TERMINAL_PREFIX}${node.id}`,
        sourceNodeId: node.id,
        position: { x: node.position.x + 224, y: node.position.y + 8 },
      },
    ]
  })
}

/** Escolhe portas conforme a geometria. Retornos verticais usam trilhos
 * paralelos, evitando que ida e volta virem a mesma linha no React Flow. */
export function missionVisualEdgeHandles(
  graph: MissionPlanGraph,
  edge: MissionPlanEdge,
): MissionVisualEdgeHandles {
  const source = graph.nodes.find((node) => node.id === edge.source)
  const target = graph.nodes.find((node) => node.id === edge.target)
  if (!source || !target) {
    return { sourceHandle: "source-right", targetHandle: "target-left" }
  }
  const dx = target.position.x - source.position.x
  const dy = target.position.y - source.position.y
  if (Math.abs(dy) > Math.abs(dx) * 0.55) {
    return dy > 0
      ? { sourceHandle: "source-bottom-out", targetHandle: "target-top-in" }
      : { sourceHandle: "source-top-return", targetHandle: "target-bottom-return" }
  }
  return dx >= 0
    ? { sourceHandle: "source-right", targetHandle: "target-left" }
    : { sourceHandle: "source-left", targetHandle: "target-right" }
}

function cyclicEdge(graph: MissionPlanGraph, edge: MissionPlanEdge): boolean {
  if (edge.source === edge.target) return true
  const neighbors = new Map<string, string[]>()
  for (const candidate of graph.edges) {
    const targets = neighbors.get(candidate.source) ?? []
    targets.push(candidate.target)
    neighbors.set(candidate.source, targets)
  }
  const pending = [edge.target]
  const seen = new Set<string>()
  while (pending.length > 0) {
    const nodeId = pending.pop()!
    if (nodeId === edge.source) return true
    if (seen.has(nodeId)) continue
    seen.add(nodeId)
    pending.push(...(neighbors.get(nodeId) ?? []))
  }
  return false
}

/** Rótulo voltado ao produto. No ciclo padrão, a aresta de reprovar carrega o
 * contador das correções; a volta diz apenas que a correção foi entregue. */
export function missionVisualEdgeLabel(
  graph: MissionPlanGraph,
  edge: MissionPlanEdge,
  traversals?: number,
): string {
  const base =
    edge.label?.trim() ||
    (edge.condition === "success"
      ? "Concluiu"
      : edge.condition === "failure"
        ? "Falhou"
        : "Sempre")
  if (!cyclicEdge(graph, edge) || edge.maxTraversals === undefined) return base
  const correction = edge.condition === "failure"
  if (!correction) return base
  return traversals === undefined
    ? `${base} · até ${edge.maxTraversals} correções`
    : `${base} · ${traversals}/${edge.maxTraversals} correções`
}
