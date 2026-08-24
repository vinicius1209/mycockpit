// ADAPTADOR PURO entre um Plano de voo e o interpretador serial do grafo.
// Congela o contrato efetivo do lançamento, resolve fases por nodeId e traduz
// um avanço do interpretador para a transição persistível do runtime.

import {
  resolveMissionGraph,
  validateMissionGraph,
  type MissionGraphResolution,
} from "@/lib/missionGraph"
import { snapshotMissionPlan } from "@/lib/missionPlans"
import type {
  MissionNodeOutcome,
  MissionPhaseDef,
  MissionPlanEdge,
  MissionPreset,
  MissionTransition,
} from "@/lib/missionTypes"

export type PreparedMissionGraphPlan =
  | {
      ok: true
      snapshot: MissionPreset
      entryNodeId: string
      entryPhase: MissionPhaseDef
    }
  | { ok: false; error: string }

/** Cria a cópia profunda que uma missão executará e resolve sua entrada. O
 *  plano das Settings pode mudar depois sem alterar este snapshot. */
export function prepareMissionGraphPlan(
  preset: MissionPreset,
): PreparedMissionGraphPlan {
  const snapshot = snapshotMissionPlan(preset)
  const graph = snapshot.graph
  if (!graph) {
    return { ok: false, error: "O Plano de voo não possui grafo executável." }
  }
  const issues = validateMissionGraph(graph, snapshot.phases)
  if (issues.length > 0) return { ok: false, error: issues[0] }
  const entryNodeId = graph.entryNodeId
  if (!entryNodeId) {
    return { ok: false, error: "O Plano de voo não possui nó de entrada." }
  }
  const entryPhase = phaseForMissionNode(snapshot, entryNodeId)
  if (!entryPhase) {
    return {
      ok: false,
      error: `O nó de entrada ${entryNodeId} não possui fase correspondente.`,
    }
  }
  return { ok: true, snapshot, entryNodeId, entryPhase }
}

/** Resolve a configuração do agent ligada a um nó do snapshot. null mantém o
 *  chamador fail-closed quando o estado persistido estiver corrompido. */
export function phaseForMissionNode(
  snapshot: MissionPreset,
  nodeId: string,
): MissionPhaseDef | null {
  const node = snapshot.graph?.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return null
  return snapshot.phases.find((phase) => phase.id === node.phaseId) ?? null
}

export type MissionVisitResolution =
  | {
      kind: "advance"
      edge: MissionPlanEdge
      targetNodeId: string
      targetPhase: MissionPhaseDef
      traversal: number
      visit: number
      transition: MissionTransition
    }
  | Exclude<MissionGraphResolution, { kind: "advance" }>

/** Decide o próximo passo da visita e, quando há avanço, materializa a
 *  MissionTransition completa que será persistida junto da visita de destino. */
export function resolveMissionVisit(input: {
  snapshot: MissionPreset
  currentNodeId: string
  currentVisit: number
  outcome: MissionNodeOutcome
  history: readonly MissionTransition[]
  at: number
}): MissionVisitResolution {
  const graph = input.snapshot.graph
  if (!graph) {
    return { kind: "error", reason: "O snapshot não possui grafo executável." }
  }
  if (!Number.isInteger(input.currentVisit) || input.currentVisit < 0) {
    return {
      kind: "error",
      reason: "O índice da visita corrente precisa ser um inteiro não negativo.",
    }
  }
  // Uma transição cria exatamente uma visita. Na entrada ambos valem zero;
  // depois, o índice da visita corrente acompanha o tamanho do audit trail.
  if (input.currentVisit !== input.history.length) {
    return {
      kind: "error",
      reason: "A visita corrente não coincide com o histórico de transições.",
    }
  }

  const resolution = resolveMissionGraph({
    graph,
    phases: input.snapshot.phases,
    currentNodeId: input.currentNodeId,
    outcome: input.outcome,
    history: input.history,
  })
  if (resolution.kind !== "advance") return resolution

  const targetPhase = phaseForMissionNode(
    input.snapshot,
    resolution.targetNodeId,
  )
  if (!targetPhase) {
    return {
      kind: "error",
      reason: `O nó de destino ${resolution.targetNodeId} não possui fase correspondente.`,
    }
  }
  const targetVisit = input.currentVisit + 1
  return {
    ...resolution,
    targetPhase,
    transition: {
      edgeId: resolution.edge.id,
      sourceNodeId: input.currentNodeId,
      targetNodeId: resolution.targetNodeId,
      sourceVisit: input.currentVisit,
      targetVisit,
      outcome: input.outcome,
      at: input.at,
    },
  }
}
