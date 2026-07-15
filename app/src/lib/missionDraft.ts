// Lógica PURA do rascunho do MissionLauncher (dialog "Lançar missão"):
// edição inline de fases (agent/modelo) a partir do preset, detecção de
// "Personalizado", trava de capacidade dos anexos e o "está sujo?" que guarda
// o fechamento contra miss-click. Sem React/stores — testável em isolamento.
import type { MissionPhaseDef } from "@/lib/missionTypes"
import type { Attachment } from "@/lib/attachments"

/** Clona as fases do preset p/ o rascunho editável (nunca muta o preset). */
export function clonePhases(phases: MissionPhaseDef[]): MissionPhaseDef[] {
  return phases.map((p) => ({ ...p }))
}

/** Campos editáveis inline no launcher (o resto continua vindo do preset). */
export interface PhaseEdit {
  agent?: string
  model?: string | null
  effort?: string | null
}

/** Aplica uma edição a UMA fase (imutável). Trocar de agent zera modelo e
 *  effort p/ o default do novo agent — mesma regra do MissionSettings. */
export function editPhase(
  phases: MissionPhaseDef[],
  idx: number,
  edit: PhaseEdit,
): MissionPhaseDef[] {
  return phases.map((p, i) => {
    if (i !== idx) return p
    if (edit.agent !== undefined && edit.agent !== p.agent) {
      return { ...p, agent: edit.agent, model: null, effort: null }
    }
    return { ...p, ...edit }
  })
}

/** O rascunho diverge do preset? Compara só o que o launcher edita
 *  (agent/modelo/effort por fase). true → o seletor mostra "Personalizado". */
export function phasesCustomized(
  base: MissionPhaseDef[],
  edited: MissionPhaseDef[],
): boolean {
  if (base.length !== edited.length) return true
  return base.some((b, i) => {
    const e = edited[i]
    return (
      b.agent !== e.agent ||
      (b.model ?? null) !== (e.model ?? null) ||
      (b.effort ?? null) !== (e.effort ?? null)
    )
  })
}

/** Todos os anexos são suportados pelas capacidades do agent da FASE 1?
 *  (mesma trava do composer; kind "other" nunca é suportado). */
export function attachmentsSupported(
  attachments: Attachment[],
  caps: { image: boolean; pdf: boolean },
): boolean {
  return attachments.every((a) =>
    a.kind === "image" ? caps.image : a.kind === "pdf" ? caps.pdf : false,
  )
}

/** Há rascunho a perder? Texto DIFERENTE do pré-preenchido (o rascunho do
 *  composer continua lá — descartar o igual não perde nada), anexos pendentes
 *  ou fases editadas. true → fechar pede confirmação (anti miss-click). */
export function draftDirty(input: {
  task: string
  initialTask?: string
  attachmentCount: number
  customized: boolean
}): boolean {
  if (input.attachmentCount > 0) return true
  if (input.customized) return true
  return input.task.trim() !== (input.initialTask ?? "").trim()
}
