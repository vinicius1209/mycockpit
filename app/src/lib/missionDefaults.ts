import type {
  MissionPhaseDef,
  MissionPlanEdge,
  MissionPlanNode,
  MissionPreset,
} from "@/lib/missionTypes"

const FACTORY_REVISION = 2

/** Planos de fábrica já desenham o retorno do reviewer. O runtime não inventa
 * `fix-N`: a mesma fase Corrigir pode ser visitada até duas vezes. */
function defaultReviewWorkflow(base: MissionPreset): MissionPreset {
  const reviewer = base.phases.find((phase) => phase.persona === "reviewer")
  const reviewerIndex = base.phases.findIndex(
    (phase) => phase.persona === "reviewer",
  )
  const executor = [...base.phases]
    .reverse()
    .find((phase) => phase.persona === "executor")
  if (!reviewer || !executor) return base
  const correction: MissionPhaseDef = {
    ...executor,
    id: `${executor.id}-fix`,
    label: "Corrigir",
    instructions:
      "A revisão anterior foi reprovada. Corrija exatamente os pontos do handoff do reviewer e preserve o restante.",
  }
  const phases = [...base.phases, correction]
  const nodes: MissionPlanNode[] = phases.map((phase, index) => ({
    id: `node-${phase.id}`,
    phaseId: phase.id,
    position:
      phase.id === correction.id
        ? { x: Math.max(0, reviewerIndex) * 224, y: 284 }
        : { x: index * 224, y: 92 },
  }))
  const mainEdges: MissionPlanEdge[] = base.phases
    .slice(0, -1)
    .map((phase, index) => ({
      id: `edge-node-${phase.id}-node-${base.phases[index + 1].id}`,
      source: `node-${phase.id}`,
      target: `node-${base.phases[index + 1].id}`,
      condition: "success",
    }))
  return {
    ...base,
    revision: FACTORY_REVISION,
    factoryRevision: FACTORY_REVISION,
    mode: "graph",
    phases,
    graph: {
      version: 1,
      entryNodeId: nodes[0]?.id ?? null,
      nodes,
      edges: [
        ...mainEdges,
        {
          id: `edge-node-${reviewer.id}-node-${correction.id}`,
          source: `node-${reviewer.id}`,
          target: `node-${correction.id}`,
          condition: "failure",
          label: "Reprovado",
          maxTraversals: 2,
        },
        {
          id: `edge-node-${correction.id}-node-${reviewer.id}`,
          source: `node-${correction.id}`,
          target: `node-${reviewer.id}`,
          condition: "success",
          label: "Corrigido",
          maxTraversals: 2,
        },
      ],
    },
  }
}

export const DEFAULT_MISSION_PRESETS: MissionPreset[] = [
  defaultReviewWorkflow({
    id: "feature",
    name: "Feature completa",
    maxCostUsd: 25,
    phases: [
      { id: "plan", label: "Planejar", persona: "planner", agent: "claude-code", model: "opus", effort: null, maxRetries: 1 },
      { id: "build", label: "Executar", persona: "executor", agent: "codex", model: null, effort: null, maxRetries: 2 },
      { id: "review", label: "Revisar", persona: "reviewer", agent: "claude-code", model: "opus", effort: null, maxRetries: 1 },
    ],
  }),
  defaultReviewWorkflow({
    id: "ui-first",
    name: "UI-first",
    maxCostUsd: 15,
    phases: [
      { id: "plan", label: "Planejar", persona: "planner", agent: "claude-code", model: "sonnet", effort: null, maxRetries: 1 },
      { id: "ui", label: "Executar UI", persona: "executor", agent: "agy", model: null, effort: null, maxRetries: 2 },
      { id: "review", label: "Revisar", persona: "reviewer", agent: "claude-code", model: "sonnet", effort: null, maxRetries: 1 },
    ],
  }),
  defaultReviewWorkflow({
    id: "barato",
    name: "Econômico",
    maxCostUsd: 5,
    phases: [
      { id: "plan", label: "Planejar", persona: "planner", agent: "claude-code", model: "sonnet", effort: null, maxRetries: 1 },
      { id: "build", label: "Executar", persona: "executor", agent: "codex", model: null, effort: null, maxRetries: 1 },
      { id: "review", label: "Revisar", persona: "reviewer", agent: "claude-code", model: "sonnet", effort: null, maxRetries: 1 },
    ],
  }),
]
