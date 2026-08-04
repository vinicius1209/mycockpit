// Lógica PURA do rascunho do MissionLauncher (dialog "Lançar missão"):
// edição inline de fases (agent/modelo) a partir do preset, detecção de
// "Personalizado", trava de capacidade dos anexos e o "está sujo?" que guarda
// o fechamento contra miss-click. Sem React/stores — testável em isolamento.
import type {
  MissionGatePolicy,
  MissionPhaseDef,
  MissionPreset,
} from "@/lib/missionTypes"
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

/** Régua ÚNICA do "está personalizado?" (ressalva do gate MH3+MH4): fases
 *  editadas OU política editada OU TETO editado. Launcher e Dock usam ISTO —
 *  antes o Dock ignorava o teto e editar só o cap lá não oferecia "salvar
 *  como time" nem marcava "· personalizado". */
export function draftCustomized(input: {
  preset: MissionPreset
  phases: MissionPhaseDef[]
  gatePolicy: MissionGatePolicy | null | undefined
  capUsd: number | null
}): boolean {
  return (
    phasesCustomized(input.preset.phases, input.phases) ||
    gatePolicyCustomized(input.preset.gatePolicy, input.gatePolicy) ||
    input.capUsd !== (input.preset.maxCostUsd ?? null)
  )
}

// ── Política de gate no rascunho (MH3.3) ──

/** Normaliza a política de gate: ausente = "agente" (comportamento clássico,
 *  fail-open pra presets salvos antes do campo existir). */
export function normalizeGatePolicy(
  policy: MissionGatePolicy | null | undefined,
): MissionGatePolicy {
  return policy ?? "agente"
}

/** A política editada diverge da do preset? Entra no "está personalizado?"
 *  junto do phasesCustomized (política editada = rascunho custom). */
export function gatePolicyCustomized(
  base: MissionGatePolicy | null | undefined,
  edited: MissionGatePolicy | null | undefined,
): boolean {
  return normalizeGatePolicy(base) !== normalizeGatePolicy(edited)
}

/** Opções do seletor de política de gate (Launcher, Dock e MissionSettings —
 *  fonte única da copy). */
export const GATE_POLICY_OPTIONS: {
  value: MissionGatePolicy
  label: string
  description: string
}[] = [
  {
    value: "agente",
    label: "Gate: agente decide",
    description:
      "Pausa quando uma fase deixa perguntas em aberto (comportamento padrão).",
  },
  {
    value: "sempre-apos-planejar",
    label: "Gate: sempre após planejar",
    description:
      "Pausa obrigatória após a fase 1, mesmo sem perguntas, pra você revisar o plano.",
  },
  {
    value: "nunca",
    label: "Gate: nunca",
    description:
      "Nunca pausa; perguntas em aberto entram como aviso no fio da conversa.",
  },
]

/** Toggle "Autonomia" do time COM o acoplamento de gate (MH3.3): LIGAR põe o
 *  time todo em auto E a política em "nunca" (autonomia total: sem pausas de
 *  gate e permissão auto); DESLIGAR volta o time a herdar e a política pra do
 *  preset. Puro — as duas superfícies aplicam o resultado. */
export function toggleTeamAutonomyWithGate(input: {
  phases: MissionPhaseDef[]
  gatePolicy: MissionGatePolicy
  /** Política do PRESET base (a "anterior" pra onde o desligar volta). */
  presetGatePolicy: MissionGatePolicy | null | undefined
}): { phases: MissionPhaseDef[]; gatePolicy: MissionGatePolicy } {
  const turningOn = teamAutonomy(input.phases) !== "auto"
  return turningOn
    ? { phases: setTeamAutonomy(input.phases, "auto"), gatePolicy: "nunca" }
    : {
        phases: setTeamAutonomy(input.phases, "inherit"),
        gatePolicy: normalizeGatePolicy(input.presetGatePolicy),
      }
}

// ── Salvar o rascunho como time (MH3.1) ──

export type SavePresetError = "vazio" | "duplicado"

/** Valida o nome do time a salvar: vazio ou duplicado (case-insensitive, sem
 *  espaços das pontas) → erro honesto pro inline da UI. null = pode salvar. */
export function validatePresetName(
  name: string,
  existing: { name: string }[],
): SavePresetError | null {
  const t = name.trim()
  if (!t) return "vazio"
  const lower = t.toLowerCase()
  if (existing.some((p) => p.name.trim().toLowerCase() === lower)) {
    return "duplicado"
  }
  return null
}

/** Copy pt-BR dos erros do salvar (inline nas duas superfícies). */
export const SAVE_PRESET_ERROR_COPY: Record<SavePresetError, string> = {
  vazio: "Dê um nome ao Plano de voo.",
  duplicado: "Já existe um Plano de voo com esse nome.",
}

/** Salva o rascunho corrente como um time NOVO: valida o nome, monta o preset
 *  (fases clonadas + teto + política) e devolve a lista atualizada + o preset
 *  salvo (o seletor passa a apontar pra ele). Puro — quem persiste é a
 *  superfície (setSettings). `id` injetável só pra teste. */
export function saveDraftAsPreset(input: {
  name: string
  presets: MissionPreset[]
  phases: MissionPhaseDef[]
  maxCostUsd: number | null
  gatePolicy?: MissionGatePolicy
  id?: string
}):
  | { ok: true; presets: MissionPreset[]; preset: MissionPreset }
  | { ok: false; error: SavePresetError } {
  const error = validatePresetName(input.name, input.presets)
  if (error) return { ok: false, error }
  const preset: MissionPreset = {
    id: input.id ?? `preset-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim(),
    phases: clonePhases(input.phases),
    maxCostUsd: input.maxCostUsd,
    gatePolicy: normalizeGatePolicy(input.gatePolicy),
  }
  return { ok: true, presets: [...input.presets, preset], preset }
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
