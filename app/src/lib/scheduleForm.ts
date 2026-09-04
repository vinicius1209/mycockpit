// O RASCUNHO do form de automação (criar E editar), como lógica PURA: sem
// React, sem store, sem Tauri. Extraído do ScheduledView pela catraca de
// tamanho, e a extração valeu por si: o form agora tem UMA régua de validade,
// testável valor a valor, em vez de um encadeado de ternários no meio do JSX.
//
// A régua que importa: `draftInput` devolve `null` quando o rascunho não vira
// automação. É ela que desabilita o botão E é ela que o store recebe — não
// existe caminho em que a tela habilita e o store recusa (ou pior, o inverso).

import {
  computeNextRun,
  parseCronExpr,
  parseLocalDateTime,
  toLocalDateTimeValue,
  type Recurrence,
} from "@/lib/schedules"
import type { NewScheduleInput } from "@/store/schedules"
import type { ScheduleRecord } from "@/lib/db"
import { normalizeSchedulePermission } from "@/lib/sessionMode"
import { parseRecurrence } from "@/lib/schedules"

export type RecurrenceMode = "once" | "daily" | "weekly" | "cron"

/** O que a automação DISPARA. Os dois são "um pedido que roda sozinho"; muda
 *  quem executa — um agent num turno, ou o time inteiro de um Plano de voo. */
export type ScheduleFlow = "agent" | "mission"

/** Estado bruto do form (strings como os inputs entregam). O `model`/`effort`
 *  guardam o valor cru do picker, com "default" significando "sem flag". */
export interface ScheduleDraft {
  name: string
  projectId: string
  kind: ScheduleFlow
  agent: string
  model: string
  effort: string
  planId: string
  prompt: string
  permission: ReturnType<typeof normalizeSchedulePermission>
  mode: RecurrenceMode
  /** "HH:MM" dos modos diário/semanal. */
  time: string
  /** 0=dom … 6=sáb (modo semanal). */
  weekday: number
  /** Expressão de 5 campos (modo avançado). */
  cron: string
  /** Valor cru do `<input type="datetime-local">` (modo "uma vez"). */
  onceAt: string
}

/** Default do campo de data: a PRÓXIMA hora cheia. Previsível e sempre no
 *  futuro (um "agora + 5min" nasceria colado no limite da guarda). */
export function nextFullHourValue(now: number = Date.now()): string {
  const d = new Date(now)
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return toLocalDateTimeValue(d.getTime())
}

/** Rascunho em branco, ancorado no projeto e no agent que o app já usa. */
export function emptyDraft(input: {
  projectId: string
  agent: string
  model: string
  now?: number
}): ScheduleDraft {
  return {
    name: "",
    projectId: input.projectId,
    kind: "agent",
    agent: input.agent,
    model: input.model,
    effort: "default",
    planId: "",
    prompt: "",
    permission: "leitura",
    mode: "daily",
    time: "08:00",
    weekday: 1,
    cron: "0 8 * * *",
    onceAt: nextFullHourValue(input.now),
  }
}

/** Rascunho de uma automação EXISTENTE (o "Editar"). A recorrência gravada
 *  volta pro modo e pros campos que a produziram; recorrência corrompida cai
 *  no diário 08:00, que é o default do form — nunca num estado inventado que
 *  o usuário salvaria sem perceber. */
export function draftFromSchedule(
  s: ScheduleRecord,
  now: number = Date.now(),
): ScheduleDraft {
  const base = emptyDraft({
    projectId: s.projectId,
    agent: s.agent,
    model: s.model ?? "default",
    now,
  })
  const rec = parseRecurrence(s.recurrence)
  const comum: ScheduleDraft = {
    ...base,
    name: s.name,
    // "lead" é legado sem produtor (ADR-078): editar uma dessas a converte no
    // fluxo de prompt, que é o único que a tela sabe montar.
    kind: s.kind === "mission" ? "mission" : "agent",
    model: s.model ?? "default",
    effort: s.effort ?? "default",
    planId: s.planId ?? "",
    prompt: s.prompt,
    permission: normalizeSchedulePermission(s.permission),
  }
  if (rec?.kind === "once") {
    return { ...comum, mode: "once", onceAt: toLocalDateTimeValue(rec.at) }
  }
  if (rec?.kind === "cron") return { ...comum, mode: "cron", cron: rec.expr }
  if (rec?.kind === "weekly") {
    return {
      ...comum,
      mode: "weekly",
      weekday: rec.weekday,
      time: `${String(rec.hour).padStart(2, "0")}:${String(rec.minute).padStart(2, "0")}`,
    }
  }
  if (rec?.kind === "daily") {
    return {
      ...comum,
      mode: "daily",
      time: `${String(rec.hour).padStart(2, "0")}:${String(rec.minute).padStart(2, "0")}`,
    }
  }
  return comum
}

/** A recorrência que o rascunho descreve. null = campo incompleto, cron
 *  inválido ou "uma vez" no passado (que nasceria sem disparo nenhum). */
export function draftRecurrence(
  d: ScheduleDraft,
  now: number = Date.now(),
): Recurrence | null {
  if (d.mode === "once") {
    const at = parseLocalDateTime(d.onceAt)
    if (at == null) return null
    const rec: Recurrence = { kind: "once", at }
    return computeNextRun(rec, new Date(now)) == null ? null : rec
  }
  if (d.mode === "cron") {
    const expr = d.cron.trim()
    return parseCronExpr(expr) ? { kind: "cron", expr } : null
  }
  const m = /^(\d{2}):(\d{2})$/.exec(d.time)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) return null
  return d.mode === "daily"
    ? { kind: "daily", hour, minute }
    : { kind: "weekly", weekday: d.weekday, hour, minute }
}

/** O rascunho vira automação? `null` = não, e é a MESMA resposta que
 *  desabilita o botão e que o handler usa pra desistir — uma régua só.
 *
 *  O Plano de voo NÃO exige agent/modelo: quem executa são as fases do plano,
 *  cada uma com o seu (o registro guarda o agent só como resquício do form). */
export function draftInput(
  d: ScheduleDraft,
  now: number = Date.now(),
): NewScheduleInput | null {
  const recurrence = draftRecurrence(d, now)
  if (!recurrence) return null
  if (!d.name.trim() || !d.projectId || !d.prompt.trim()) return null
  if (d.kind === "mission" && !d.planId) return null
  return {
    name: d.name,
    projectId: d.projectId,
    kind: d.kind,
    agent: d.agent,
    model: d.model === "default" ? null : d.model,
    effort: d.kind === "mission" || d.effort === "default" ? null : d.effort,
    prompt: d.prompt,
    permission: d.permission,
    planId: d.kind === "mission" ? d.planId : null,
    recurrence,
  }
}
