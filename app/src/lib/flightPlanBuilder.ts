import { enableGraphMode } from "@/lib/missionPlans"
import { missionVisualTerminals } from "@/lib/missionGraphPresentation"
import type {
  MissionPersona,
  MissionPhaseDef,
  MissionPreset,
} from "@/lib/missionTypes"

export type FlightPlanKind = "linear" | "graph"

export interface FlightPlanStats {
  phases: number
  connections: number
  returns: number
  successExits: number
}

type IdFactory = (prefix: "phase" | "plan") => string

const randomId: IdFactory = (prefix) =>
  `${prefix}-${Math.random().toString(36).slice(2, 9)}`

const PHASE_COPY: Record<
  MissionPersona,
  Pick<MissionPhaseDef, "label" | "persona">
> = {
  planner: { label: "Planejar", persona: "planner" },
  executor: { label: "Executar", persona: "executor" },
  reviewer: { label: "Revisar", persona: "reviewer" },
}

export function createFlightPlanPhase(
  persona: MissionPersona = "executor",
  idFactory: IdFactory = randomId,
): MissionPhaseDef {
  return {
    id: idFactory("phase"),
    ...PHASE_COPY[persona],
    agent: persona === "executor" ? "codex" : "claude-code",
    model: null,
    effort: null,
    maxRetries: persona === "executor" ? 2 : 1,
  }
}

export function createFlightPlan(
  kind: FlightPlanKind,
  idFactory: IdFactory = randomId,
): MissionPreset {
  if (kind === "linear") {
    return {
      id: idFactory("plan"),
      name: "Nova rota",
      description: "Uma sequência direta para uma tarefa bem definida.",
      mode: "linear",
      maxCostUsd: null,
      phases: [createFlightPlanPhase("executor", idFactory)],
    }
  }

  return enableGraphMode({
    id: idFactory("plan"),
    name: "Novo fluxo visual",
    description: "Planejamento, execução e revisão numa rota visual.",
    maxCostUsd: null,
    phases: [
      createFlightPlanPhase("planner", idFactory),
      createFlightPlanPhase("executor", idFactory),
      createFlightPlanPhase("reviewer", idFactory),
    ],
  })
}

export function cloneFlightPlan(
  source: MissionPreset,
  options: { freshId?: boolean; idFactory?: IdFactory } = {},
): MissionPreset {
  const idFactory = options.idFactory ?? randomId
  return {
    ...source,
    id: options.freshId ? idFactory("plan") : source.id,
    phases: source.phases.map((phase) => ({
      ...phase,
      entryCriteria: phase.entryCriteria ? [...phase.entryCriteria] : undefined,
      exitCriteria: phase.exitCriteria ? [...phase.exitCriteria] : undefined,
      appendedInFlight: phase.appendedInFlight
        ? { ...phase.appendedInFlight }
        : undefined,
    })),
    graph: source.graph
      ? {
          ...source.graph,
          nodes: source.graph.nodes.map((node) => ({
            ...node,
            position: { ...node.position },
          })),
          edges: source.graph.edges.map((edge) => ({ ...edge })),
        }
      : undefined,
  }
}

export function flightPlanStats(preset: MissionPreset): FlightPlanStats {
  const graph = enableGraphMode(preset).graph!
  return {
    phases: preset.phases.length,
    connections: graph.edges.length,
    returns: graph.edges.filter((edge) => edge.maxTraversals !== undefined)
      .length,
    successExits: missionVisualTerminals(graph).length,
  }
}
