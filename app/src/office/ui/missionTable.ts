// Lógica PURA da mesa de reunião (O-2 — lançar missões da sala comum): que
// menu-balão mostrar e o que bloqueia o lançamento. Sem React/stores — o
// MissionDock/DeskMenu consomem; testável em isolamento (ui.test.ts).
import { MISSION_TABLE_ID } from "../engine/types"

export { MISSION_TABLE_ID }

/** Visão mínima da missão corrente que o menu precisa (do useMission via
 *  bridge; null = nenhuma missão lançada da mesa / conversa sem missão). */
export type MissionTableRun = {
  status: "running" | "done" | "error" | "aborted"
  /** Índice da fase corrente (0-based; aponta além do fim quando done). */
  current: number
  /** Total de fases. */
  phaseCount: number
}

export type MissionTableMenu =
  | { kind: "launch" }
  | { kind: "running"; phase: number; total: number }

/** Parse da assinatura por VALOR "status:current:total" (useMissionTableSig
 *  do bridge — o menu não assina o MissionRun inteiro). null/malformada ⇒ null. */
export function parseMissionSig(sig: string | null): MissionTableRun | null {
  if (!sig) return null
  const m = /^(running|done|error|aborted):(\d+):(\d+)$/.exec(sig)
  if (!m) return null
  return {
    status: m[1] as MissionTableRun["status"],
    current: Number(m[2]),
    phaseCount: Number(m[3]),
  }
}

/** Menu da mesa de reunião: missão RODANDO lançada dali ⇒ acompanhar (fase
 *  1-based, clampada ao total — `current` aponta além do fim quando done);
 *  senão ⇒ lançar. Missões terminadas não seguram o menu — o histórico fica
 *  no dock. */
export function missionTableMenu(run: MissionTableRun | null): MissionTableMenu {
  if (run && run.status === "running") {
    return {
      kind: "running",
      phase: Math.min(run.current + 1, run.phaseCount),
      total: run.phaseCount,
    }
  }
  return { kind: "launch" }
}

/** O que impede o botão "Lançar missão" do dock (null = pode lançar).
 *  Ordem de precedência: sem projeto (CTA) > fora do app (nota "requer o
 *  app") > missão rodando (guarda anti-duplo-start visível) > tarefa vazia. */
export type MissionLaunchBlock =
  | "sem-projeto"
  | "fora-do-app"
  | "missao-rodando"
  | "tarefa-vazia"

export function missionLaunchBlock(input: {
  hasProjects: boolean
  isTauri: boolean
  missionRunning: boolean
  task: string
}): MissionLaunchBlock | null {
  if (!input.hasProjects) return "sem-projeto"
  if (!input.isTauri) return "fora-do-app"
  if (input.missionRunning) return "missao-rodando"
  if (input.task.trim().length === 0) return "tarefa-vazia"
  return null
}

/** Título curto da conversa da missão: "Missão · {resumo}" (1ª linha da
 *  tarefa, truncada — título de sidebar, não transcrição). */
export const MISSION_TITLE_PREFIX = "Missão · "
const TITLE_MAX = 42

export function missionConversationTitle(task: string): string {
  const first = task.replace(/\s+/g, " ").trim()
  const cut = first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX).trimEnd()}…` : first
  return `${MISSION_TITLE_PREFIX}${cut || "sem título"}`
}
