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
  autonomy?: "auto" | "inherit"
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
      // troca de agent preserva a autonomia da fase (é do MEMBRO, não do CLI).
      return { ...p, agent: edit.agent, model: null, effort: null }
    }
    return { ...p, ...edit }
  })
}

/** Liga/desliga "auto" em TODO o time de uma vez (o toggle de missão). Preserva
 *  o resto de cada fase. */
export function setTeamAutonomy(
  phases: MissionPhaseDef[],
  autonomy: "auto" | "inherit",
): MissionPhaseDef[] {
  return phases.map((p) => ({ ...p, autonomy }))
}

/** Estado do toggle de missão a partir das fases: "auto" se TODAS são auto,
 *  "inherit" se NENHUMA, "mixed" se algumas (a UI mostra o indeterminado). */
export function teamAutonomy(
  phases: MissionPhaseDef[],
): "auto" | "inherit" | "mixed" {
  if (phases.length === 0) return "inherit"
  const autos = phases.filter((p) => p.autonomy === "auto").length
  if (autos === 0) return "inherit"
  if (autos === phases.length) return "auto"
  return "mixed"
}

/** O rascunho diverge do preset? Compara o que o launcher edita
 *  (agent/modelo/effort/autonomia por fase). true → o seletor mostra
 *  "Personalizado". */
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
      (b.effort ?? null) !== (e.effort ?? null) ||
      (b.autonomy ?? "inherit") !== (e.autonomy ?? "inherit")
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

/** Parse do input do TETO de custo (US$) editado inline no launcher.
 *  Aceita vírgula decimal (pt-BR). Retorno em 3 estados:
 *  - number  → teto válido ("25" → 25, "12,50" → 12.5)
 *  - null    → SEM teto (vazio ou 0 — estado válido, checkBudget já trata)
 *  - undefined → inválido (NaN/negativo/∞) → o caller mantém o valor anterior */
export function parseCapInput(raw: string): number | null | undefined {
  const t = raw.trim()
  if (t === "") return null
  const n = Number(t.replace(",", "."))
  if (!Number.isFinite(n) || n < 0) return undefined
  return n === 0 ? null : n
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
