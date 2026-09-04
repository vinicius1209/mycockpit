// PLANOS DE VOO: contrato puro entre biblioteca, autoria e runtime. `phases`
// configura os agents; `graph` é a topologia canônica que a missão executa.

import type {
  MissionPhaseDef,
  MissionPlanGraph,
  MissionPlanMode,
  MissionPlanNode,
  MissionPreset,
} from "@/lib/missionTypes"
import { validateMissionGraph } from "@/lib/missionGraph"

export const MISSION_PLAN_FORMAT = "mycockpit.flight-plan"
export const MISSION_PLAN_EXPORT_VERSION = 1

export interface MissionPlanExport {
  format: typeof MISSION_PLAN_FORMAT
  version: typeof MISSION_PLAN_EXPORT_VERSION
  exportedAt: string
  plan: MissionPreset
}

const X_GAP = 248
const START_X = 56
const START_Y = 92
const GRAPH_X_GAP = 224
const GRAPH_Y_GAP = 192

export function missionPlanMode(preset: MissionPreset): MissionPlanMode {
  return preset.mode === "graph" ? "graph" : "linear"
}

function nodeId(phaseId: string): string {
  return `node-${phaseId}`
}

function defaultPosition(index: number): { x: number; y: number } {
  return { x: START_X + index * X_GAP, y: START_Y }
}

/** Cria a topologia linear inicial. Depois disso, um grafo existente nunca é
 *  reconstruído implicitamente: branches e retornos pertencem ao usuário. */
export function graphFromPhases(
  phases: MissionPhaseDef[],
  previous?: MissionPlanGraph | null,
): MissionPlanGraph {
  const positions = new Map(
    (previous?.nodes ?? []).map((node) => [node.phaseId, node.position]),
  )
  const nodes: MissionPlanNode[] = phases.map((phase, index) => ({
    id: nodeId(phase.id),
    phaseId: phase.id,
    position: positions.get(phase.id) ?? defaultPosition(index),
  }))
  return {
    version: 1,
    entryNodeId: nodes[0]?.id ?? null,
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({
      id: `edge-${node.id}-${nodes[index + 1].id}`,
      source: node.id,
      target: nodes[index + 1].id,
      condition: "success",
    })),
  }
}

/** Ativa a projeção visual sem destruir a topologia já desenhada. */
export function enableGraphMode(preset: MissionPreset): MissionPreset {
  return {
    ...preset,
    mode: "graph",
    graph: preset.graph ?? graphFromPhases(preset.phases),
  }
}

/** Reconcilia configuração e topologia sem reescrever conexões. Em Rota, a
 *  ordem é a intenção e gera uma cadeia. Em Fluxo visual, novos nós entram
 *  desconectados e precisam ser ligados explicitamente. */
export function syncMissionPlan(preset: MissionPreset): MissionPreset {
  if (missionPlanMode(preset) === "linear") {
    return { ...preset, graph: graphFromPhases(preset.phases, preset.graph) }
  }
  if (!preset.graph) return { ...preset, graph: graphFromPhases(preset.phases) }
  const phaseIds = new Set(preset.phases.map((phase) => phase.id))
  const existingByPhase = new Map(
    preset.graph.nodes.map((node) => [node.phaseId, node]),
  )
  const nodes = preset.phases.map(
    (phase, index) =>
      existingByPhase.get(phase.id) ?? {
        id: nodeId(phase.id),
        phaseId: phase.id,
        position: defaultPosition(index),
      },
  )
  const nodeIds = new Set(nodes.map((node) => node.id))
  return {
    ...preset,
    graph: {
      ...preset.graph,
      nodes,
      edges: preset.graph.edges.filter(
        (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
      ),
      entryNodeId:
        preset.graph.entryNodeId && nodeIds.has(preset.graph.entryNodeId)
          ? preset.graph.entryNodeId
          : nodes.find((node) => phaseIds.has(node.phaseId))?.id ?? null,
    },
  }
}

/** Reordena a projeção Rota. No Fluxo visual a topologia permanece intacta. */
export function moveMissionPhase(
  preset: MissionPreset,
  from: number,
  to: number,
): MissionPreset {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= preset.phases.length ||
    to >= preset.phases.length
  ) {
    return preset
  }
  const phases = [...preset.phases]
  const [phase] = phases.splice(from, 1)
  phases.splice(to, 0, phase)
  // Ao mudar a ORDEM, realinha a pista da esquerda pra direita. Preservar as
  // coordenadas antigas faria a nova aresta voltar visualmente para trás.
  return {
    ...preset,
    phases,
    graph:
      missionPlanMode(preset) === "linear"
        ? graphFromPhases(phases)
        : preset.graph,
  }
}

/** Persiste drag do React Flow sem misturar tipos do canvas no domínio. */
export function updateMissionNodePositions(
  preset: MissionPreset,
  positions: Record<string, { x: number; y: number }>,
): MissionPreset {
  const withGraph = enableGraphMode(preset)
  return {
    ...withGraph,
    graph: {
      ...withGraph.graph!,
      nodes: withGraph.graph!.nodes.map((node) => ({
        ...node,
        position: positions[node.phaseId] ?? node.position,
      })),
    },
  }
}

/** Auto-layout semântico do grafo serial. Success/always avançam pela rota
 * principal; failure abre uma faixa abaixo da origem. Retornos encontram um nó
 * já posicionado e não o deslocam, preservando a leitura do ciclo. */
export function autoLayoutMissionPlan(preset: MissionPreset): MissionPreset {
  const withGraph = enableGraphMode(preset)
  const graph = withGraph.graph!
  if (!graph.entryNodeId) return withGraph
  const positions = new Map<string, { x: number; y: number }>([
    [graph.entryNodeId, { x: START_X, y: START_Y }],
  ])
  const occupied = new Set([`${START_X}:${START_Y}`])
  const queue = [graph.entryNodeId]
  while (queue.length > 0) {
    const sourceId = queue.shift()!
    const source = positions.get(sourceId)!
    const outgoing = graph.edges
      .filter((edge) => edge.source === sourceId)
      .sort((a, b) => {
        const rank = { success: 0, always: 1, failure: 2 }
        return rank[a.condition] - rank[b.condition]
      })
    for (const edge of outgoing) {
      if (positions.has(edge.target)) continue
      let next =
        edge.condition === "failure"
          ? { x: source.x, y: source.y + GRAPH_Y_GAP }
          : { x: source.x + GRAPH_X_GAP, y: source.y }
      while (occupied.has(`${next.x}:${next.y}`)) {
        next = { ...next, y: next.y + GRAPH_Y_GAP }
      }
      positions.set(edge.target, next)
      occupied.add(`${next.x}:${next.y}`)
      queue.push(edge.target)
    }
  }
  return {
    ...withGraph,
    revision: (withGraph.revision ?? 1) + 1,
    graph: {
      ...graph,
      nodes: graph.nodes.map((node, index) => ({
        ...node,
        position:
          positions.get(node.id) ?? {
            x: START_X + index * GRAPH_X_GAP,
            y: START_Y + GRAPH_Y_GAP * 2,
          },
      })),
    },
  }
}

/** Snapshot profundo que será congelado no lançamento. A topologia passa a
 *  existir até para planos criados na projeção Rota. */
export function snapshotMissionPlan(preset: MissionPreset): MissionPreset {
  const graph = preset.graph ?? graphFromPhases(preset.phases)
  return {
    ...preset,
    revision: preset.revision ?? 1,
    phases: preset.phases.map((phase) => ({
      ...phase,
      ...(phase.entryCriteria
        ? { entryCriteria: [...phase.entryCriteria] }
        : {}),
      ...(phase.exitCriteria ? { exitCriteria: [...phase.exitCriteria] } : {}),
      ...(phase.appendedInFlight
        ? { appendedInFlight: { ...phase.appendedInFlight } }
        : {}),
    })),
    graph: {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        position: { ...node.position },
      })),
      edges: graph.edges.map((edge) => ({ ...edge })),
    },
  }
}

/** Diagnóstico defensivo do contrato realmente executável. */
export function validateMissionPlan(preset: MissionPreset): string[] {
  if (!preset.id.trim()) return ["O plano precisa de um identificador."]
  if (!preset.name.trim()) return ["O plano precisa de um nome."]
  if (preset.phases.length === 0) return ["O plano precisa de ao menos uma fase."]
  if (
    preset.maxCostUsd !== null &&
    (!Number.isFinite(preset.maxCostUsd) || preset.maxCostUsd <= 0)
  ) {
    return ["O teto de custo precisa ser maior que zero ou ficar vazio."]
  }
  const phaseIds = new Set<string>()
  for (const phase of preset.phases) {
    if (!phase.id || phaseIds.has(phase.id)) {
      return ["As fases precisam ter identificadores únicos."]
    }
    phaseIds.add(phase.id)
  }
  const graph = preset.graph ?? graphFromPhases(preset.phases)
  if (!graph || graph.version !== 1) return ["O canvas do plano está ausente ou incompatível."]
  return validateMissionGraph(graph, preset.phases)
}

export function serializeMissionPlan(preset: MissionPreset): string {
  const normalized = snapshotMissionPlan(preset)
  return JSON.stringify(
    {
      format: MISSION_PLAN_FORMAT,
      version: MISSION_PLAN_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      plan: normalized,
    } satisfies MissionPlanExport,
    null,
    2,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function stringsOrAbsent(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  )
}

function validImportedPhase(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    (value.persona === "planner" ||
      value.persona === "executor" ||
      value.persona === "reviewer") &&
    typeof value.agent === "string" &&
    (value.model === null || typeof value.model === "string") &&
    (value.effort === null || typeof value.effort === "string") &&
    typeof value.maxRetries === "number" &&
    Number.isFinite(value.maxRetries) &&
    value.maxRetries >= 1 &&
    (value.instructions === undefined || typeof value.instructions === "string") &&
    stringsOrAbsent(value.entryCriteria) &&
    stringsOrAbsent(value.exitCriteria) &&
    (value.autonomy === undefined ||
      value.autonomy === "auto" ||
      value.autonomy === "inherit")
  )
}

function validImportedGraph(value: unknown): boolean {
  if (!isRecord(value) || value.version !== 1) return false
  if (value.entryNodeId !== null && typeof value.entryNodeId !== "string") return false
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return false
  const nodesOk = value.nodes.every((node) => {
    if (!isRecord(node) || !isRecord(node.position)) return false
    return (
      typeof node.id === "string" &&
      typeof node.phaseId === "string" &&
      typeof node.position.x === "number" &&
      Number.isFinite(node.position.x) &&
      typeof node.position.y === "number" &&
      Number.isFinite(node.position.y)
    )
  })
  const edgesOk = value.edges.every((edge) => {
    if (!isRecord(edge)) return false
    return (
      typeof edge.id === "string" &&
      typeof edge.source === "string" &&
      typeof edge.target === "string" &&
      (edge.condition === "success" ||
        edge.condition === "failure" ||
        edge.condition === "always") &&
      (edge.label === undefined || typeof edge.label === "string") &&
      (edge.maxTraversals === undefined ||
        (typeof edge.maxTraversals === "number" &&
          Number.isFinite(edge.maxTraversals) &&
          edge.maxTraversals >= 1))
    )
  })
  return nodesOk && edgesOk
}

/** Import tolerante no envelope, estrito no contrato que será executado. */
export function parseMissionPlan(raw: string):
  | { ok: true; plan: MissionPreset }
  | { ok: false; error: string } {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, error: "O arquivo não contém JSON válido." }
  }
  if (
    !isRecord(value) ||
    value.format !== MISSION_PLAN_FORMAT ||
    value.version !== MISSION_PLAN_EXPORT_VERSION ||
    !isRecord(value.plan)
  ) {
    return { ok: false, error: "Este arquivo não é um Plano de voo do Frota." }
  }
  const rawPlan = value.plan
  if (
    rawPlan.maxCostUsd !== null &&
    (typeof rawPlan.maxCostUsd !== "number" ||
      !Number.isFinite(rawPlan.maxCostUsd) ||
      rawPlan.maxCostUsd <= 0)
  ) {
    return {
      ok: false,
      error: "O teto de custo precisa ser maior que zero ou ficar vazio.",
    }
  }
  if (
    typeof rawPlan.id !== "string" ||
    typeof rawPlan.name !== "string" ||
    (rawPlan.revision !== undefined &&
      (typeof rawPlan.revision !== "number" ||
        !Number.isInteger(rawPlan.revision) ||
        rawPlan.revision < 1)) ||
    (rawPlan.factoryRevision !== undefined &&
      (typeof rawPlan.factoryRevision !== "number" ||
        !Number.isInteger(rawPlan.factoryRevision) ||
        rawPlan.factoryRevision < 1)) ||
    (rawPlan.description !== undefined && typeof rawPlan.description !== "string") ||
    (rawPlan.mode !== undefined && rawPlan.mode !== "linear" && rawPlan.mode !== "graph") ||
    !Array.isArray(rawPlan.phases) ||
    !rawPlan.phases.every(validImportedPhase) ||
    (rawPlan.gatePolicy !== undefined &&
      rawPlan.gatePolicy !== "agente" &&
      rawPlan.gatePolicy !== "sempre-apos-planejar" &&
      rawPlan.gatePolicy !== "nunca") ||
    (rawPlan.mode === "graph" && !validImportedGraph(rawPlan.graph))
  ) {
    return { ok: false, error: "O Plano de voo não possui fases válidas." }
  }
  const plan = rawPlan as unknown as MissionPreset
  const issues = validateMissionPlan(plan)
  return issues.length > 0
    ? { ok: false, error: issues[0] }
    : {
        ok: true,
        plan: snapshotMissionPlan(plan),
      }
}
