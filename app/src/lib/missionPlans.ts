// PLANOS DE VOO: contrato puro entre a biblioteca visual e o motor de Mission.
// O runtime atual é linear; por isso o canvas v1 só produz uma cadeia válida e
// toda mudança de ordem atualiza `preset.phases`, que o motor já executa. O
// schema do grafo fica desacoplado do React Flow para poder virar plugin/API.

import type {
  MissionPhaseDef,
  MissionPlanGraph,
  MissionPlanMode,
  MissionPlanNode,
  MissionPreset,
} from "@/lib/missionTypes"

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

export function missionPlanMode(preset: MissionPreset): MissionPlanMode {
  return preset.mode === "graph" ? "graph" : "linear"
}

function nodeId(phaseId: string): string {
  return `node-${phaseId}`
}

function defaultPosition(index: number): { x: number; y: number } {
  return { x: START_X + index * X_GAP, y: START_Y }
}

/** Reconstrói uma cadeia a partir da ordem executável, preservando as posições
 *  de nós já existentes. Usado ao adicionar/remover/reordenar fases. */
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

/** Ativa o canvas sem alterar a rota que já funciona hoje. */
export function enableGraphMode(preset: MissionPreset): MissionPreset {
  return {
    ...preset,
    mode: "graph",
    graph: graphFromPhases(preset.phases, preset.graph),
  }
}

/** Mantém a topologia visual sincronizada com a projeção linear executável. */
export function syncMissionPlan(preset: MissionPreset): MissionPreset {
  if (missionPlanMode(preset) !== "graph") return preset
  return {
    ...preset,
    graph: graphFromPhases(preset.phases, preset.graph),
  }
}

/** Reordena a rota real. O canvas nunca persiste uma topologia que o motor
 *  linear não consiga executar. */
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
    graph: graphFromPhases(phases),
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

/** Diagnóstico defensivo para JSON importado. O editor v1 exige cadeia única,
 *  todos os nós alcançáveis e uma fase correspondente por nó. */
export function validateMissionPlan(preset: MissionPreset): string[] {
  if (!preset.id.trim()) return ["O plano precisa de um identificador."]
  if (!preset.name.trim()) return ["O plano precisa de um nome."]
  if (preset.phases.length === 0) return ["O plano precisa de ao menos uma fase."]
  const phaseIds = new Set<string>()
  for (const phase of preset.phases) {
    if (!phase.id || phaseIds.has(phase.id)) {
      return ["As fases precisam ter identificadores únicos."]
    }
    phaseIds.add(phase.id)
  }
  if (missionPlanMode(preset) === "linear") return []
  const graph = preset.graph
  if (!graph || graph.version !== 1) return ["O canvas do plano está ausente ou incompatível."]
  if (graph.nodes.length !== preset.phases.length) {
    return ["O canvas e a lista de fases estão fora de sincronia."]
  }
  const nodeIds = new Set<string>()
  const nodeById = new Map<string, MissionPlanNode>()
  for (const node of graph.nodes) {
    if (!node.id || nodeIds.has(node.id) || !phaseIds.has(node.phaseId)) {
      return ["O canvas contém nós duplicados ou sem fase correspondente."]
    }
    nodeIds.add(node.id)
    nodeById.set(node.id, node)
  }
  if (!graph.entryNodeId || !nodeById.has(graph.entryNodeId)) {
    return ["O canvas precisa de um nó de entrada válido."]
  }
  const outgoing = new Map<string, string>()
  const incoming = new Set<string>()
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return ["O canvas contém uma conexão para um nó inexistente."]
    }
    if (edge.condition !== "success") {
      return ["O motor atual aceita somente conexões de sucesso."]
    }
    if (outgoing.has(edge.source) || incoming.has(edge.target)) {
      return ["O motor atual aceita uma única rota, sem ramificações."]
    }
    outgoing.set(edge.source, edge.target)
    incoming.add(edge.target)
  }
  const visited = new Set<string>()
  let cursor: string | undefined = graph.entryNodeId
  while (cursor) {
    if (visited.has(cursor)) return ["Loops ainda não são executáveis neste motor."]
    visited.add(cursor)
    cursor = outgoing.get(cursor)
  }
  if (visited.size !== graph.nodes.length || graph.edges.length !== graph.nodes.length - 1) {
    return ["Todos os nós precisam formar uma única rota conectada."]
  }
  return []
}

export function serializeMissionPlan(preset: MissionPreset): string {
  const normalized =
    missionPlanMode(preset) === "graph" ? syncMissionPlan(preset) : preset
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
    typeof rawPlan.id !== "string" ||
    typeof rawPlan.name !== "string" ||
    (rawPlan.description !== undefined && typeof rawPlan.description !== "string") ||
    (rawPlan.mode !== undefined && rawPlan.mode !== "linear" && rawPlan.mode !== "graph") ||
    (rawPlan.maxCostUsd !== null &&
      (typeof rawPlan.maxCostUsd !== "number" ||
        !Number.isFinite(rawPlan.maxCostUsd) ||
        rawPlan.maxCostUsd < 0)) ||
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
        // A projeção `phases` é a execução real na v1. Canonicalizar as
        // arestas importadas evita um JSON válido desenhar ordem diferente da
        // que o missionEngine rodaria.
        plan: missionPlanMode(plan) === "graph" ? syncMissionPlan(plan) : plan,
      }
}
