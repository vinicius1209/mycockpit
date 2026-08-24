// EXECUTOR PURO do grafo serial de Missões. Este módulo não roda agents nem
// persiste estado: valida a topologia e decide, a partir do resultado de um nó
// e do histórico já percorrido, qual é a única transição possível.
//
// Invariantes desta primeira versão:
// - um único nó corrente (sem paralelismo);
// - `success`/`failure` vencem `always`, que é apenas fallback;
// - toda aresta interna de um ciclo tem limite explícito;
// - no máximo 100 visitas por missão, mesmo em um grafo válido.

import type {
  MissionNodeOutcome,
  MissionPhaseDef,
  MissionPlanEdge,
  MissionPlanEdgeCondition,
  MissionPlanGraph,
  MissionTransition,
} from "@/lib/missionTypes"

export const MAX_MISSION_GRAPH_VISITS = 100

export type MissionGraphResolution =
  | {
      kind: "advance"
      edge: MissionPlanEdge
      targetNodeId: string
      /** Quantas vezes esta aresta terá sido percorrida após o avanço. */
      traversal: number
      /** Quantas visitas o caminho terá após o avanço. */
      visit: number
    }
  | { kind: "finish"; nodeId: string; outcome: "success" }
  | {
      kind: "edge-exhausted"
      edge: MissionPlanEdge
      traversals: number
      maxTraversals: number
    }
  | { kind: "error"; reason: string }

function duplicateIds(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

function adjacency(
  graph: MissionPlanGraph,
  knownNodes: ReadonlySet<string>,
): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const id of knownNodes) result.set(id, [])
  for (const edge of graph.edges) {
    if (!knownNodes.has(edge.source) || !knownNodes.has(edge.target)) continue
    result.get(edge.source)!.push(edge.target)
  }
  return result
}

/** Componentes fortemente conexos (Tarjan). Dentro de um componente cíclico,
 *  toda aresta interna participa de algum ciclo e, portanto, precisa de limite. */
function stronglyConnectedComponents(
  graph: MissionPlanGraph,
  knownNodes: ReadonlySet<string>,
): string[][] {
  const next = adjacency(graph, knownNodes)
  const indexes = new Map<string, number>()
  const lowLinks = new Map<string, number>()
  const stack: string[] = []
  const inStack = new Set<string>()
  const components: string[][] = []
  let index = 0

  function visit(node: string): void {
    indexes.set(node, index)
    lowLinks.set(node, index)
    index++
    stack.push(node)
    inStack.add(node)

    for (const target of next.get(node) ?? []) {
      if (!indexes.has(target)) {
        visit(target)
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node)!, lowLinks.get(target)!),
        )
      } else if (inStack.has(target)) {
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node)!, indexes.get(target)!),
        )
      }
    }

    if (lowLinks.get(node) !== indexes.get(node)) return
    const component: string[] = []
    while (stack.length > 0) {
      const member = stack.pop()!
      inStack.delete(member)
      component.push(member)
      if (member === node) break
    }
    components.push(component)
  }

  for (const node of knownNodes) {
    if (!indexes.has(node)) visit(node)
  }
  return components
}

function validTraversalLimit(edge: MissionPlanEdge): boolean {
  return (
    edge.maxTraversals !== undefined &&
    Number.isInteger(edge.maxTraversals) &&
    edge.maxTraversals > 0
  )
}

/** Valida o contrato executável, incluindo o vínculo 1:1 entre nós e fases.
 *  Retorna todos os problemas independentes que puder diagnosticar sem lançar. */
export function validateMissionGraph(
  graph: MissionPlanGraph,
  phases: readonly MissionPhaseDef[],
): string[] {
  const errors: string[] = []

  const blankPhaseId = phases.some((phase) => !phase.id.trim())
  const blankNodeId = graph.nodes.some(
    (node) => !node.id.trim() || !node.phaseId.trim(),
  )
  const blankEdgeId = graph.edges.some((edge) => !edge.id.trim())
  if (blankPhaseId) errors.push("Toda fase precisa de um identificador.")
  if (blankNodeId) errors.push("Todo nó precisa de identificadores de nó e fase.")
  if (blankEdgeId) errors.push("Toda aresta precisa de um identificador.")

  const repeatedPhases = duplicateIds(phases.map((phase) => phase.id))
  const repeatedNodes = duplicateIds(graph.nodes.map((node) => node.id))
  const repeatedEdges = duplicateIds(graph.edges.map((edge) => edge.id))
  if (repeatedPhases.length > 0) {
    errors.push(`Identificador de fase duplicado: ${repeatedPhases.join(", ")}.`)
  }
  if (repeatedNodes.length > 0) {
    errors.push(`Identificador de nó duplicado: ${repeatedNodes.join(", ")}.`)
  }
  if (repeatedEdges.length > 0) {
    errors.push(`Identificador de aresta duplicado: ${repeatedEdges.join(", ")}.`)
  }

  const phaseIds = new Set(phases.map((phase) => phase.id))
  const nodeIds = new Set(graph.nodes.map((node) => node.id))
  const referencedPhases = new Map<string, number>()
  for (const node of graph.nodes) {
    referencedPhases.set(
      node.phaseId,
      (referencedPhases.get(node.phaseId) ?? 0) + 1,
    )
    if (!phaseIds.has(node.phaseId)) {
      errors.push(`O nó ${node.id} referencia a fase inexistente ${node.phaseId}.`)
    }
  }
  for (const phase of phases) {
    const references = referencedPhases.get(phase.id) ?? 0
    if (references === 0) {
      errors.push(`A fase ${phase.id} não possui nó correspondente.`)
    } else if (references > 1) {
      errors.push(`A fase ${phase.id} é referenciada por mais de um nó.`)
    }
  }

  if (!graph.entryNodeId || !nodeIds.has(graph.entryNodeId)) {
    errors.push("O grafo precisa de um nó de entrada válido.")
  }

  const conditionsBySource = new Map<string, Set<MissionPlanEdgeCondition>>()
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`A aresta ${edge.id} parte do nó inexistente ${edge.source}.`)
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`A aresta ${edge.id} aponta para o nó inexistente ${edge.target}.`)
    }
    const conditions = conditionsBySource.get(edge.source) ?? new Set()
    if (conditions.has(edge.condition)) {
      errors.push(
        `O nó ${edge.source} possui mais de uma aresta ${edge.condition}.`,
      )
    }
    conditions.add(edge.condition)
    conditionsBySource.set(edge.source, conditions)

    if (
      edge.maxTraversals !== undefined &&
      (!Number.isInteger(edge.maxTraversals) || edge.maxTraversals <= 0)
    ) {
      errors.push(
        `A aresta ${edge.id} precisa de maxTraversals inteiro e maior que zero.`,
      )
    }
  }

  if (graph.entryNodeId && nodeIds.has(graph.entryNodeId)) {
    const next = adjacency(graph, nodeIds)
    const reachable = new Set<string>()
    const pending = [graph.entryNodeId]
    while (pending.length > 0) {
      const node = pending.pop()!
      if (reachable.has(node)) continue
      reachable.add(node)
      pending.push(...(next.get(node) ?? []))
    }
    for (const node of graph.nodes) {
      if (!reachable.has(node.id)) {
        errors.push(`O nó ${node.id} não é alcançável a partir da entrada.`)
      }
    }
  }

  // Uma missão precisa ter ao menos um pouso bem-sucedido. Um nó termina em
  // success somente quando não há aresta `success` nem fallback `always`.
  // Como todos os nós já precisam ser alcançáveis, encontrar esse nó também
  // prova que existe um término alcançável a partir da entrada.
  const hasSuccessTerminal = graph.nodes.some(
    (node) =>
      !graph.edges.some(
        (edge) =>
          edge.source === node.id &&
          (edge.condition === "success" || edge.condition === "always"),
      ),
  )
  if (graph.nodes.length > 0 && !hasSuccessTerminal) {
    errors.push("O grafo precisa de ao menos um término por sucesso.")
  }

  for (const component of stronglyConnectedComponents(graph, nodeIds)) {
    const members = new Set(component)
    const cyclic =
      component.length > 1 ||
      graph.edges.some(
        (edge) => edge.source === component[0] && edge.target === component[0],
      )
    if (!cyclic) continue
    for (const edge of graph.edges) {
      if (
        members.has(edge.source) &&
        members.has(edge.target) &&
        !validTraversalLimit(edge)
      ) {
        errors.push(
          `A aresta cíclica ${edge.id} precisa de maxTraversals inteiro e maior que zero.`,
        )
      }
    }
  }

  return errors
}

/** Quantas vezes uma aresta já foi percorrida no histórico da missão. */
export function countMissionGraphTraversals(
  history: readonly MissionTransition[],
  edgeId: string,
): number {
  return history.reduce(
    (total, traversal) => total + (traversal.edgeId === edgeId ? 1 : 0),
    0,
  )
}

function edgeForOutcome(
  graph: MissionPlanGraph,
  nodeId: string,
  outcome: MissionNodeOutcome,
): MissionPlanEdge | null {
  const outgoing = graph.edges.filter((edge) => edge.source === nodeId)
  return (
    outgoing.find((edge) => edge.condition === outcome) ??
    outgoing.find((edge) => edge.condition === "always") ??
    null
  )
}

/** Decide a próxima ação sem produzir efeitos. O histórico contém uma transição
 *  por avanço; logo uma missão na entrada já fez 1 visita e, depois, o número de
 *  visitas é sempre `history.length + 1`. */
export function resolveMissionGraph(input: {
  graph: MissionPlanGraph
  phases: readonly MissionPhaseDef[]
  currentNodeId: string
  outcome: MissionNodeOutcome
  history: readonly MissionTransition[]
}): MissionGraphResolution {
  const issues = validateMissionGraph(input.graph, input.phases)
  if (issues.length > 0) return { kind: "error", reason: issues[0] }
  if (!input.graph.nodes.some((node) => node.id === input.currentNodeId)) {
    return {
      kind: "error",
      reason: `O nó corrente ${input.currentNodeId} não existe no grafo.`,
    }
  }

  const edge = edgeForOutcome(
    input.graph,
    input.currentNodeId,
    input.outcome,
  )
  if (!edge) {
    return input.outcome === "success"
      ? {
          kind: "finish",
          nodeId: input.currentNodeId,
          outcome: "success",
        }
      : {
          kind: "error",
          reason: `O nó ${input.currentNodeId} falhou sem uma rota de falha.`,
        }
  }

  const traversals = countMissionGraphTraversals(input.history, edge.id)
  if (
    edge.maxTraversals !== undefined &&
    traversals >= edge.maxTraversals
  ) {
    return {
      kind: "edge-exhausted",
      edge,
      traversals,
      maxTraversals: edge.maxTraversals,
    }
  }

  const visits = input.history.length + 1
  if (visits >= MAX_MISSION_GRAPH_VISITS) {
    return {
      kind: "error",
      reason: `A missão atingiu o limite estrutural de ${MAX_MISSION_GRAPH_VISITS} visitas.`,
    }
  }

  return {
    kind: "advance",
    edge,
    targetNodeId: edge.target,
    traversal: traversals + 1,
    visit: visits + 1,
  }
}
