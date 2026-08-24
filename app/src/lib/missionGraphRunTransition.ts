import { resolveMissionVisit } from "@/lib/missionGraphRuntime"
import { advance, type MissionEngineState } from "@/lib/missionEngine"
import type { RunStateReview } from "@/lib/missionState"
import type {
  MissionGraphExecution,
  MissionNodeOutcome,
  MissionPhaseRun,
  MissionRun,
} from "@/lib/missionTypes"

export type CompletedMissionVisitRoute =
  | {
      kind: "advance"
      outcome: MissionNodeOutcome
      engine: MissionEngineState
      nextRun: MissionPhaseRun
      execution: MissionGraphExecution
      reviewLoops: number
    }
  | { kind: "finish"; outcome: MissionNodeOutcome; engine: MissionEngineState }
  | {
      kind: "review-caveat"
      outcome: "failure"
      engine: MissionEngineState
      reviewLoops: number
    }
  | { kind: "error"; outcome: MissionNodeOutcome; reason: string }

/** Traduz o fim de uma visita no próximo estado do grafo, sem efeitos. */
export function routeCompletedMissionVisit(input: {
  engine: MissionEngineState
  run: MissionRun
  phaseIndex: number
  resultOk: boolean
  /** Erro funcional original da visita. Mantém a causa do agent quando o
   *  grafo não oferece uma rota de falha, em vez de trocá-la por diagnóstico
   *  estrutural genérico. */
  failureReason?: string
  review: RunStateReview | null
  nextVisitId: string
  at: number
}): CompletedMissionVisitRoute {
  const outcome: MissionNodeOutcome =
    input.review && !input.review.approved
      ? "failure"
      : input.resultOk
        ? "success"
        : "failure"
  const currentNodeId = input.run.phases[input.phaseIndex]?.nodeId
  const execution = input.run.execution
  if (!currentNodeId || !execution) {
    return {
      kind: "error",
      outcome,
      reason: "o estado do grafo perdeu a identidade da visita corrente",
    }
  }
  const route = resolveMissionVisit({
    snapshot: execution.planSnapshot,
    currentNodeId,
    currentVisit: input.phaseIndex,
    outcome,
    history: execution.transitions,
    at: input.at,
  })
  const rejected = !!input.review && !input.review.approved
  if (route.kind === "error") {
    return rejected
      ? {
          kind: "review-caveat",
          outcome: "failure",
          engine: { ...input.engine, current: input.engine.phases.length },
          reviewLoops: input.engine.reviewLoops,
        }
      : {
          kind: "error",
          outcome,
          reason: input.failureReason ?? route.reason,
        }
  }
  if (route.kind === "edge-exhausted") {
    return rejected
      ? {
          kind: "review-caveat",
          outcome: "failure",
          engine: {
            ...input.engine,
            current: input.engine.phases.length,
            reviewLoops: route.traversals,
          },
          reviewLoops: route.traversals,
        }
      : {
          kind: "error",
          outcome,
          reason: `A conexão ${route.edge.label || route.edge.id} atingiu o limite de ${route.maxTraversals} travessias.`,
        }
  }
  if (route.kind === "finish") {
    return { kind: "finish", outcome, engine: input.engine }
  }

  const reviewLoops = rejected
    ? Math.max(input.engine.reviewLoops, route.traversal)
    : input.engine.reviewLoops
  const engine: MissionEngineState = {
    ...input.engine,
    reviewLoops,
    corrections:
      rejected && input.review
        ? [...input.engine.corrections, input.review.feedback]
        : input.engine.corrections,
    phases: [...input.engine.phases, route.targetPhase],
  }
  return {
    kind: "advance",
    outcome,
    engine,
    reviewLoops,
    nextRun: {
      def: route.targetPhase,
      visitId: input.nextVisitId,
      nodeId: route.targetNodeId,
      enteredViaEdgeId: route.edge.id,
      status: "queued",
      attempt: 1,
      costUsd: 0,
      startedAt: null,
    },
    execution: {
      ...execution,
      transitions: [...execution.transitions, route.transition],
    },
  }
}

export type InterruptedMissionContinuation =
  | { kind: "continue"; engine: MissionEngineState; patch: Partial<MissionRun> }
  | { kind: "error"; reason: string }

/** Interrupção manual é um skip explícito: conserva a visita como aborted,
 *  mas consome a rota de sucesso e cria a próxima visita atomicamente. */
export function continueInterruptedMissionVisit(input: {
  engine: MissionEngineState
  run: MissionRun
  phaseIndex: number
  nextVisitId: string
  at: number
}): InterruptedMissionContinuation {
  const route = routeCompletedMissionVisit({
    ...input,
    resultOk: true,
    review: null,
  })
  if (route.kind === "error") return route
  if (route.kind === "review-caveat") {
    return { kind: "error", reason: "Uma interrupção não pode gerar ressalva de revisão." }
  }
  const phases = input.run.phases.map((phase, index) =>
    index === input.phaseIndex ? { ...phase, outcome: route.outcome } : phase,
  )
  return {
    kind: "continue",
    engine: advance(route.engine),
    patch:
      route.kind === "advance"
        ? { phases: [...phases, route.nextRun], execution: route.execution }
        : { phases },
  }
}
