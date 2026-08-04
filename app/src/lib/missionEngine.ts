// MÁQUINA DE FASES da missão (MH4.1): as TRANSIÇÕES do pipeline como funções
// PURAS. O store (store/mission.ts) vira casca fina que executa efeitos
// (runPhase, persist, notices, notify, ledger) sob comando das decisões daqui.
//
// Estados do pipeline e quem decide cada transição:
//
//   entre-fases ──nextTransition──▶ run | teto | finish
//   fase falhou ──failureTransition──▶ teto-fase | falha | recovery
//   recovery    ──applyRecoveryChoice/rerunBudget──▶ re-run da MESMA fase
//   fase ok     ──afterPhaseDone──▶ veredito do reviewer + rodada de correção
//                                   (fix-N + rereview-N, clamp MAX_REVIEW_LOOPS)
//   pós-fase    ──gateTransition──▶ gate | notice | none (política do preset)
//   fim         ──finalCaveat──▶ done limpo | done com ressalva (MH1.1)
//
// REGRA DURA: comportamento-neutro com o loop antigo do launch — as suítes de
// missão existentes (review, reviewClamp, recovery, resume, gate*, ledger,
// budget*, unattended*, worktree, history…) são o contrato. Nada de efeito
// aqui dentro: sem awaits, sem stores, sem invoke — só decisão.

import type { ChatItem } from "@/store/chat"
import type {
  MissionGatePolicy,
  MissionPhaseDef,
  MissionPreset,
  MissionReviewCaveat,
  RecoveryChoice,
} from "@/lib/missionTypes"
import type { MissionRunState, RunStateReview } from "@/lib/missionState"
import {
  checkBudget,
  gateOutcome,
  isRecoverableFailure,
  phaseText,
  recoveryMessage,
  reviewerApproved,
  type GateOutcome,
  type PhaseResult,
} from "@/lib/mission"

/** Máx. de rodadas de correção quando o reviewer reprova (cada uma = executor
 *  corretivo + re-review). Limita custo/loop; o teto de US$ ainda vale por cima. */
export const MAX_REVIEW_LOOPS = 2

/** Estado PURO da máquina: tudo que o loop antigo carregava em mutáveis soltos
 *  (preset efetivo, fase corrente, memória do loop de revisão, matéria-prima da
 *  entrega). O store guarda UMA instância por launch e aplica as transições. */
export interface MissionEngineState {
  /** Preset EFETIVO: fases do launch + corretivas apendadas pelo loop de
   *  revisão + defs trocadas pela recuperação. */
  phases: MissionPhaseDef[]
  /** Índice da fase corrente (aponta além do fim quando acabou). */
  current: number
  /** Rodadas de correção já disparadas (clamp de MAX_REVIEW_LOOPS). */
  reviewLoops: number
  /** Veredito da ÚLTIMA fase de revisão (decide a ressalva do desfecho). */
  lastReview: RunStateReview | null
  /** Feedbacks de reprovação que dispararam correção (matéria da lição M2). */
  corrections: string[]
  /** Plano do 1º planner (matéria-prima da entrega M1). */
  plannerSummary: string
  /** Agent/modelo do 1º executor (quem de fato mexeu no código). */
  execAgent: string
  execModel: string | null
}

/** Estado inicial da máquina: launch fresco começa na fase 0; RETOMADA começa
 *  na fase corrente do arquivo — com um gate RESPONDIDO cuja fase já está done,
 *  avança 1 (não re-paga fase concluída nem injeta as decisões na fase errada;
 *  gate PENDENTE não gravou gateDecisions ⇒ re-roda a fase pra re-perguntar).
 *  A memória do loop de revisão re-hidrata do arquivo (clamp sobrevive a crash). */
export function initEngine(
  preset: MissionPreset,
  resume?: MissionRunState,
): MissionEngineState {
  const resumeFrom = resume
    ? resume.gateDecisions && resume.phases[resume.current]?.status === "done"
      ? resume.current + 1
      : resume.current
    : 0
  const startPhase = resume
    ? Math.min(Math.max(0, resumeFrom), preset.phases.length - 1)
    : 0
  return {
    phases: [...preset.phases],
    current: startPhase,
    reviewLoops: resume?.reviewLoops ?? 0,
    lastReview: resume?.lastReview ?? null,
    corrections: [],
    plannerSummary: "",
    execAgent: "",
    execModel: null,
  }
}

// ── Transição de entrada: o que fazer ANTES de gastar na próxima fase ──

export type NextTransition =
  /** Roda a fase `index` (a corrente). */
  | { kind: "run"; index: number; def: MissionPhaseDef }
  /** Orçamento estourado ANTES de entrar na fase → missão morre de teto. */
  | { kind: "teto"; reason: string }
  /** Não há mais fases → desfecho (com ou sem ressalva do revisor). */
  | { kind: "finish"; reviewCaveat: MissionReviewCaveat | null }

/** Decide a próxima transição do pipeline: acabou → finish; teto furado →
 *  teto (budget HARD, risco nº1 do design); senão roda a fase corrente. */
export function nextTransition(
  state: MissionEngineState,
  costTotal: number,
  maxCostUsd: number | null,
): NextTransition {
  if (state.current >= state.phases.length) {
    return { kind: "finish", reviewCaveat: finalCaveat(state) }
  }
  const budget = checkBudget(costTotal, maxCostUsd)
  if (!budget.ok) {
    return { kind: "teto", reason: budget.reason ?? "orçamento esgotado" }
  }
  return {
    kind: "run",
    index: state.current,
    def: state.phases[state.current],
  }
}

// ── Transição de falha: a fase terminou !ok — qual o desfecho? ──

export type FailureTransition =
  /** MH2.2 — o teto mordeu DENTRO da fase (stopAtCostUsd cancelou o run):
   *  MESMO desfecho de teto do check entre fases, nunca card de recuperação. */
  | { kind: "teto-fase"; reason: string }
  /** Falha NÃO-recuperável (bug, timeout, cancel) → missão vai a error. */
  | { kind: "falha"; error?: string; reason: string }
  /** Falha RECUPERÁVEL (limite/rate-limit/crédito) → pausa em recovery. */
  | {
      kind: "recovery"
      error: string
      message: string
      /** Motivo do error se o usuário DESISTIR da recuperação. */
      abandonReason: string
    }

/** Classifica a falha de uma fase. A ordem importa: teto vem ANTES do
 *  isRecoverableFailure (o cancel do corte pode deixar rastro de "limite" no
 *  transcript, e teto estourado nunca vira card de recuperação). */
export function failureTransition(
  result: PhaseResult,
  phaseIndex: number,
  maxCostUsd: number | null,
): FailureTransition {
  if (result.budgetExceeded) {
    const teto = maxCostUsd ?? 0
    return {
      kind: "teto-fase",
      reason: `teto de US$ ${teto.toFixed(2)} atingido durante a fase ${phaseIndex + 1}`,
    }
  }
  if (!isRecoverableFailure(result)) {
    return {
      kind: "falha",
      error: result.error,
      reason: result.error ?? "falha na fase",
    }
  }
  return {
    kind: "recovery",
    error: result.error ?? "falha recuperável",
    message: recoveryMessage(result),
    abandonReason:
      result.error ?? "fase parou por limite (recuperação abandonada)",
  }
}

/** Budget HARD também no re-run da recuperação (o nextTransition só checa ao
 *  ENTRAR numa fase nova; sem isto o teto seria furado ao retomar — o caminho
 *  mais caro é justamente re-rodar a fase que falhou). */
export function rerunBudget(
  costTotal: number,
  maxCostUsd: number | null,
): { ok: true } | { ok: false; reason: string } {
  const budget = checkBudget(costTotal, maxCostUsd)
  return budget.ok
    ? { ok: true }
    : { ok: false, reason: budget.reason ?? "orçamento esgotado" }
}

/** Recuperação resolvida: troca agent/modelo/effort da def da fase CORRENTE
 *  (a mesma fase re-roda; o índice não avança, o prompt não muda). */
export function applyRecoveryChoice(
  state: MissionEngineState,
  choice: RecoveryChoice,
): MissionEngineState {
  return {
    ...state,
    phases: state.phases.map((p, i) =>
      i === state.current
        ? { ...p, agent: choice.agent, model: choice.model, effort: choice.effort }
        : p,
    ),
  }
}

// ── Transição de fase concluída: veredito do reviewer + loop de correção ──

/** Rodada de correção aberta pela reprovação: executor corretivo (feedback
 *  como instrução) + re-review, apendados ao preset efetivo. */
export interface CorrectionRound {
  round: number
  feedback: string
  corrective: MissionPhaseDef
  rereview: MissionPhaseDef
}

export interface PhaseDoneTransition {
  state: MissionEngineState
  /** Veredito FRESCO quando a fase era de revisão (null nas demais) — o store
   *  espelha na memória persistida do loop (run-state). */
  review: RunStateReview | null
  /** Rodada de correção aberta (null = aprovado, clamp esgotado ou sem
   *  executor anterior pra corrigir). */
  correction: CorrectionRound | null
}

/** Acha a def do executor mais recente ANTES do índice `i` (p/ reinjetar a
 *  correção). null se não houver executor antes do reviewer. */
function lastExecutorBefore(
  phases: MissionPhaseDef[],
  i: number,
): MissionPhaseDef | null {
  for (let j = i - 1; j >= 0; j--) {
    if (phases[j].persona === "executor") return phases[j]
  }
  return null
}

/** A fase corrente terminou OK: captura a matéria-prima da entrega (plano do
 *  1º planner, agent do 1º executor) e, se era REVIEWER, registra o veredito
 *  (MH1.1: a última revisão decide a ressalva) e abre a rodada de correção
 *  quando reprovado — até MAX_REVIEW_LOOPS (M2), nunca além. */
export function afterPhaseDone(
  state: MissionEngineState,
  items: ChatItem[],
  missionId: string,
): PhaseDoneTransition {
  const i = state.current
  const def = state.phases[i]
  let next = state
  if (def.persona === "planner" && !next.plannerSummary) {
    next = { ...next, plannerSummary: phaseText(items) }
  }
  if (def.persona === "executor" && !next.execAgent) {
    next = { ...next, execAgent: def.agent, execModel: def.model }
  }
  if (def.persona !== "reviewer") {
    return { state: next, review: null, correction: null }
  }

  const review: RunStateReview = {
    approved: reviewerApproved(items),
    feedback: phaseText(items),
  }
  next = { ...next, lastReview: review }
  if (review.approved || next.reviewLoops >= MAX_REVIEW_LOOPS) {
    return { state: next, review, correction: null }
  }
  const execDef = lastExecutorBefore(next.phases, i)
  if (!execDef) {
    // sem executor anterior não há quem corrija — a reprovação vira ressalva
    // no desfecho (rounds 0), nunca uma rodada impossível.
    return { state: next, review, correction: null }
  }
  const round = next.reviewLoops + 1
  const feedback = review.feedback
  const corrective: MissionPhaseDef = {
    ...execDef,
    id: `fix-${round}-${missionId.slice(0, 6)}`,
    label: `Corrigir (rodada ${round})`,
    instructions:
      "O reviewer NÃO aprovou. Corrija exatamente estes pontos e nada " +
      `além do necessário:\n\n${feedback}`,
  }
  const rereview: MissionPhaseDef = {
    ...next.phases[i],
    id: `rereview-${round}-${missionId.slice(0, 6)}`,
    label: `Revisar (rodada ${round})`,
  }
  next = {
    ...next,
    reviewLoops: round,
    corrections: [...next.corrections, feedback],
    phases: [...next.phases, corrective, rereview],
  }
  return {
    state: next,
    review,
    correction: { round, feedback, corrective, rereview },
  }
}

// ── Transição de gate: a política do preset decide a pausa (MH3.3) ──

/** Decisão de gate pós-fase: aplica a política do preset sobre as
 *  open_questions do handoff da fase corrente. "gate" pausa; "notice" segue
 *  com as perguntas no fio; "none" segue direto. */
export function gateTransition(
  state: MissionEngineState,
  policy: MissionGatePolicy | null | undefined,
  openQuestions: string[] | undefined,
): GateOutcome {
  return gateOutcome({
    policy,
    openQuestions,
    phaseIndex: state.current,
    hasNextPhase: state.current + 1 < state.phases.length,
  })
}

/** Avança pra próxima fase (gate respondido/dispensado, fase consumida). */
export function advance(state: MissionEngineState): MissionEngineState {
  return { ...state, current: state.current + 1 }
}

// ── Desfecho ──

/** MH1.1 — desfecho HONESTO: a última revisão reprovou e as rodadas esgotaram
 *  ⇒ done COM RESSALVA explícita (nunca "done" seco). null = sem ressalva
 *  (aprovado, ou missão sem reviewer). */
export function finalCaveat(
  state: MissionEngineState,
): MissionReviewCaveat | null {
  return state.lastReview && !state.lastReview.approved
    ? { rounds: state.reviewLoops, feedback: state.lastReview.feedback }
    : null
}
