// Lógica PURA da mesa de reunião (O-2 — lançar missões da sala comum): que
// menu-balão mostrar, o que bloqueia o lançamento e a EDIÇÃO DO TIME no form
// (preset → rascunho de fases → preset efetivo). Sem React/stores — o
// MissionDock/DeskMenu consomem; testável em isolamento (ui.test.ts).
// lib/missionDraft é pura (sem stores) — importar direto não fura a regra §6.
import {
  clonePhases,
  gatePolicyCustomized,
  normalizeGatePolicy,
  phasesCustomized,
} from "@/lib/missionDraft"
import type {
  MissionGatePolicy,
  MissionPhaseDef,
  MissionPreset,
} from "@/lib/missionTypes"
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

// --- edição do TIME no form do dock (preset + fases editáveis) ---------------

/** Rótulo de UMA opção do seletor de preset ("Feature completa · 3 fases"). */
export function presetOptionLabel(p: MissionPreset): string {
  const n = p.phases.length
  return `${p.name} · ${n} ${n === 1 ? "fase" : "fases"}`
}

/** Rascunho LIMPO a partir de um preset — abrir o form, TROCAR de preset,
 *  "restaurar padrão" e pós-lançamento caem aqui: fases clonadas (editar nunca
 *  muta o preset) + teto do preset; edições anteriores são descartadas. */
export function presetDraft(p: MissionPreset): {
  phases: MissionPhaseDef[]
  capUsd: number | null
  gatePolicy: MissionGatePolicy
} {
  return {
    phases: clonePhases(p.phases),
    capUsd: p.maxCostUsd,
    gatePolicy: normalizeGatePolicy(p.gatePolicy),
  }
}

/** Opções do select de AGENT de uma fase: só os DISPONÍVEIS (availableAgents
 *  do bridge — indisponíveis ficam fora); se o agent atual da fase saiu do ar
 *  (preset antigo), ele entra no topo pra o select não renderizar vazio — mas
 *  nenhum OUTRO indisponível aparece. */
export function phaseAgentOptions(
  available: { id: string; label: string }[],
  currentAgent: string,
): { id: string; label: string }[] {
  if (available.some((a) => a.id === currentAgent)) return available
  return [{ id: currentAgent, label: currentAgent }, ...available]
}

/** Preset EFETIVO do lançamento — MESMA régua do MissionLauncher do Linear:
 *  fases do rascunho (editadas ou não) + teto sobre o preset base; o nome
 *  ganha "· personalizado" quando o time diverge do preset. */
export function effectiveTablePreset(
  base: MissionPreset,
  phases: MissionPhaseDef[],
  capUsd: number | null,
  /** Política de gate do rascunho (MH3.3). undefined = mantém a do preset
   *  (call sites antigos seguem intactos). */
  gatePolicy?: MissionGatePolicy,
): MissionPreset {
  const customized =
    phasesCustomized(base.phases, phases) ||
    (gatePolicy !== undefined &&
      gatePolicyCustomized(base.gatePolicy, gatePolicy))
  return {
    ...base,
    name: customized ? `${base.name} · personalizado` : base.name,
    phases: clonePhases(phases),
    maxCostUsd: capUsd,
    ...(gatePolicy !== undefined ? { gatePolicy } : {}),
  }
}

/** Lança a missão com o preset EFETIVO via deps injetadas (launchTableMission
 *  do bridge em produção) — testável sem stores, mesma pegada do
 *  pickRevezamento. Devolve o convId do launch (null = projeto sumiu). */
export async function launchFromTable(
  deps: {
    launch: (args: {
      projectId: string
      title: string
      task: string
      preset: MissionPreset
    }) => Promise<string | null>
  },
  input: {
    projectId: string
    task: string
    preset: MissionPreset
    phases: MissionPhaseDef[]
    capUsd: number | null
    /** Política de gate do rascunho (MH3.3; undefined = a do preset). */
    gatePolicy?: MissionGatePolicy
  },
): Promise<string | null> {
  return deps.launch({
    projectId: input.projectId,
    title: missionConversationTitle(input.task),
    task: input.task,
    preset: effectiveTablePreset(
      input.preset,
      input.phases,
      input.capUsd,
      input.gatePolicy,
    ),
  })
}
