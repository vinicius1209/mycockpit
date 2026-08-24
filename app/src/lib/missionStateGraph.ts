import {
  MAX_MISSION_GRAPH_VISITS,
  validateMissionGraph,
} from "@/lib/missionGraph"
import type {
  MissionGraphExecution,
  MissionNodeOutcome,
  MissionPhaseDef,
} from "@/lib/missionTypes"

export interface PersistedMissionVisitIdentity {
  def?: MissionPhaseDef
  visitId?: string
  nodeId?: string
  enteredViaEdgeId?: string | null
  outcome?: MissionNodeOutcome
}

/** Prova que o ledger v2 é um caminho cronológico do snapshot, não apenas um
 *  conjunto de índices válidos. Qualquer divergência impede a retomada. */
export function validMissionRunLedger(
  execution: MissionGraphExecution,
  visits: readonly PersistedMissionVisitIdentity[],
): boolean {
  const graph = execution.planSnapshot.graph
  if (
    !graph ||
    validateMissionGraph(graph, execution.planSnapshot.phases).length > 0 ||
    visits.length === 0 ||
    visits.length > MAX_MISSION_GRAPH_VISITS ||
    visits.length !== execution.transitions.length + 1
  ) {
    return false
  }

  const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
  const phases = new Map(
    execution.planSnapshot.phases.map((phase) => [phase.id, phase]),
  )
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]))
  const visitIds = new Set<string>()
  const traversals = new Map<string, number>()

  for (let index = 0; index < visits.length; index++) {
    const visit = visits[index]
    const node = visit.nodeId ? nodes.get(visit.nodeId) : null
    if (
      !visit.visitId ||
      visitIds.has(visit.visitId) ||
      !visit.def ||
      !node ||
      !phases.has(visit.def.id) ||
      node.phaseId !== visit.def.id
    ) {
      return false
    }
    visitIds.add(visit.visitId)
    if (index === 0) {
      if (visit.nodeId !== graph.entryNodeId || visit.enteredViaEdgeId != null) {
        return false
      }
      continue
    }
    const transition = execution.transitions[index - 1]
    if (visit.enteredViaEdgeId !== transition.edgeId) return false
  }

  for (let index = 0; index < execution.transitions.length; index++) {
    const transition = execution.transitions[index]
    const edge = edges.get(transition.edgeId)
    if (
      transition.sourceVisit !== index ||
      transition.targetVisit !== index + 1 ||
      visits[index].nodeId !== transition.sourceNodeId ||
      visits[index + 1].nodeId !== transition.targetNodeId ||
      visits[index].outcome !== transition.outcome ||
      !edge ||
      edge.source !== transition.sourceNodeId ||
      edge.target !== transition.targetNodeId ||
      (edge.condition !== "always" && edge.condition !== transition.outcome)
    ) {
      return false
    }
    const count = (traversals.get(edge.id) ?? 0) + 1
    if (edge.maxTraversals !== undefined && count > edge.maxTraversals) {
      return false
    }
    traversals.set(edge.id, count)
  }
  return true
}
