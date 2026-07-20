// CONTRATO do modo Mission (docs/mission-mode.md): time configurável
// papel→agent/modelo rodando como pipeline SEQUENCIAL dentro do Linear.
// Feature independente do SDD (decisão de produto 2026-07-12).
// Este arquivo é a fonte de verdade dos tipos — UI, store e settings
// importam daqui; NÃO importar componentes/stores aqui (sem ciclos).
// (só um `import type` — apagado na compilação, sem ciclo em runtime.)

import type { ChatItem } from "@/store/chat"

export type MissionPersona = "planner" | "executor" | "reviewer"

/** Definição de UMA fase do pipeline (parte do preset, editável). */
export interface MissionPhaseDef {
  /** Identificador estável dentro do preset (ex.: "plan", "ui", "review"). */
  id: string
  /** Rótulo humano exibido na timeline (ex.: "Planejar"). */
  label: string
  /** Persona → template de prompt (planner/executor/reviewer). */
  persona: MissionPersona
  /** Agent do registry (lib/agents.ts): "claude-code" | "codex" | "agy". */
  agent: string
  /** Modelo (value do registry) ou null = default do agent. */
  model: string | null
  /** Effort ou null = default. */
  effort: string | null
  /** Instrução específica da fase (opcional; soma ao template da persona). */
  instructions?: string
  /** Tentativas máximas da fase (1 = sem retry). */
  maxRetries: number
}

/** Um time salvo (global nas Settings; ad-hoc no launch). */
export interface MissionPreset {
  id: string
  name: string
  phases: MissionPhaseDef[]
  /** Teto de custo da missão em US$ (null = sem teto). RISCO Nº1 do design. */
  maxCostUsd: number | null
}

export type MissionPhaseStatus =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "aborted"

/** Estado de execução de UMA fase (runtime, não persiste no preset). */
export interface MissionPhaseRun {
  def: MissionPhaseDef
  status: MissionPhaseStatus
  /** Tentativa corrente (1-based; > 1 = houve retry). */
  attempt: number
  costUsd: number
  startedAt: number | null
  /** Itens ao vivo da fase (stream reduzido pelo runPhase/onProgress) — a
   *  matéria-prima da atividade em tempo real e do resumo final. */
  items?: ChatItem[]
  /** Mensagem de erro da última tentativa (se status error/aborted). */
  error?: string
}

export type MissionStatus = "running" | "done" | "error" | "aborted"

/** Gate humano: a fase `phase` terminou deixando perguntas em aberto — a
 *  missão PAUSA e só continua depois de answerGate() (as respostas são
 *  injetadas no prompt da próxima fase). */
export interface MissionGate {
  phase: number
  questions: string[]
}

/** Recuperação de missão: a fase `phase` falhou de forma RECUPERÁVEL (limite de
 *  uso / rate limit / crédito) — a missão PAUSA (espelha o gate) e só continua
 *  depois de resolveRecovery() (troca de agent/modelo/effort e re-roda a MESMA
 *  fase) ou abortRecovery() (desiste → a missão vai a error). */
export interface MissionRecovery {
  /** Índice da fase que falhou (a que será re-rodada com o novo agent). */
  phase: number
  /** Mensagem de erro crua da última tentativa (do PhaseResult.error). */
  error: string
  /** Mensagem humana pro card da UI (explica a pausa + o que fazer). */
  message: string
}

/** Escolha do usuário na recuperação: novo agent/modelo/effort p/ re-rodar a
 *  fase corrente. null (em resolveRecovery/abortRecovery) = desistir. */
export interface RecoveryChoice {
  agent: string
  model: string | null
  effort: string | null
}

/** Resumo estruturado da conclusão (do handoff da última fase que emitiu). */
export interface MissionDoneSummary {
  intent: string | null
  openQuestions: string[]
  filesTouched: string[]
}

/** Uma missão em execução/terminada numa conversa. */
export interface MissionRun {
  id: string
  convId: string
  presetName: string
  task: string
  phases: MissionPhaseRun[]
  /** Índice da fase corrente (aponta além do fim quando done). */
  current: number
  costTotal: number
  maxCostUsd: number | null
  status: MissionStatus
  startedAt: number
  /** Gate pendente (precisa de você). null/undefined = nada pendente. */
  gate?: MissionGate | null
  /** Recuperação pendente: uma fase falhou de forma recuperável e a missão
   *  aguarda a escolha de agent (resolveRecovery) ou a desistência
   *  (abortRecovery). null/undefined = nada pendente. */
  recovery?: MissionRecovery | null
  /** Resumo estruturado quando done/error (best-effort dos handoffs). */
  doneSummary?: MissionDoneSummary | null
}

/** Presets de fábrica (espelham categorias do OMO, sem keyword-magic). */
export const DEFAULT_MISSION_PRESETS: MissionPreset[] = [
  {
    id: "feature",
    name: "Feature completa",
    maxCostUsd: 25,
    phases: [
      {
        id: "plan",
        label: "Planejar",
        persona: "planner",
        agent: "claude-code",
        model: "opus",
        effort: null,
        maxRetries: 1,
      },
      {
        id: "build",
        label: "Executar",
        persona: "executor",
        agent: "codex",
        model: null,
        effort: null,
        maxRetries: 2,
      },
      {
        id: "review",
        label: "Revisar",
        persona: "reviewer",
        agent: "claude-code",
        model: "opus",
        effort: null,
        maxRetries: 1,
      },
    ],
  },
  {
    id: "ui-first",
    name: "UI-first",
    maxCostUsd: 15,
    phases: [
      {
        id: "plan",
        label: "Planejar",
        persona: "planner",
        agent: "claude-code",
        model: "sonnet",
        effort: null,
        maxRetries: 1,
      },
      {
        id: "ui",
        label: "Executar UI",
        persona: "executor",
        agent: "agy",
        model: null,
        effort: null,
        maxRetries: 2,
      },
      {
        id: "review",
        label: "Revisar",
        persona: "reviewer",
        agent: "claude-code",
        model: "sonnet",
        effort: null,
        maxRetries: 1,
      },
    ],
  },
  {
    id: "barato",
    name: "Econômico",
    maxCostUsd: 5,
    phases: [
      {
        id: "plan",
        label: "Planejar",
        persona: "planner",
        agent: "claude-code",
        model: "sonnet",
        effort: null,
        maxRetries: 1,
      },
      {
        id: "build",
        label: "Executar",
        persona: "executor",
        agent: "codex",
        model: null,
        effort: null,
        maxRetries: 1,
      },
      {
        id: "review",
        label: "Revisar",
        persona: "reviewer",
        agent: "claude-code",
        model: "sonnet",
        effort: null,
        maxRetries: 1,
      },
    ],
  },
]
