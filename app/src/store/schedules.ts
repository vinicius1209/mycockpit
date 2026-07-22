// F6 — store das automações agendadas: espelho em memória de `schedules` +
// `schedule_runs` (SQLite). Recarregado no boot, a cada tick do motor (App.tsx)
// e após cada ação da view. Fail-soft: fora do Tauri fica vazio.
import { create } from "zustand"
import {
  deleteSchedule as dbDeleteSchedule,
  insertSchedule,
  listScheduleRuns,
  listSchedules,
  setScheduleEnabled,
  type ScheduleKind,
  type SchedulePermission,
  type ScheduleRecord,
  type ScheduleRunRecord,
} from "@/lib/db"
import {
  computeNextRun,
  parseRecurrence,
  type Recurrence,
} from "@/lib/schedules"
import { dispatchSchedule } from "@/lib/scheduleEngine"

export interface NewScheduleInput {
  name: string
  projectId: string
  /** S4.3: "lead" agenda proposePlan (sem agent/prompt); default "agent". */
  kind?: ScheduleKind
  agent: string
  model: string | null
  prompt: string
  permission: SchedulePermission
  recurrence: Recurrence
}

interface SchedulesState {
  schedules: ScheduleRecord[]
  /** Histórico recente (todas as automações; a view agrupa por scheduleId). */
  runs: ScheduleRunRecord[]
  loaded: boolean

  reload: () => Promise<void>
  create: (input: NewScheduleInput) => Promise<void>
  toggle: (id: string, enabled: boolean) => Promise<void>
  remove: (id: string) => Promise<void>
  /** "Rodar agora": dispara já, SEM mexer no next_run do calendário. */
  runNow: (id: string) => Promise<void>
}

export const useSchedules = create<SchedulesState>((set, get) => ({
  schedules: [],
  runs: [],
  loaded: false,

  reload: async () => {
    const schedules = (await listSchedules()) ?? []
    const runs = await listScheduleRuns()
    set({ schedules, runs, loaded: true })
  },

  create: async (input) => {
    const kind: ScheduleKind = input.kind === "lead" ? "lead" : "agent"
    const s: ScheduleRecord = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      projectId: input.projectId,
      kind,
      // schedule do lead não roda agent de código: normaliza os campos do
      // fluxo agent pra valores neutros e auto-descritivos no banco.
      agent: kind === "lead" ? "lead" : input.agent,
      model: kind === "lead" ? null : input.model,
      prompt: kind === "lead" ? "" : input.prompt.trim(),
      // regra dura: só leitura|padrao chega aqui (o tipo já barra 'liberado').
      permission:
        kind === "lead"
          ? "leitura"
          : input.permission === "padrao"
            ? "padrao"
            : "leitura",
      recurrence: JSON.stringify(input.recurrence),
      enabled: true,
      nextRun: computeNextRun(input.recurrence, new Date()),
      lastRunAt: null,
      lastRunStatus: null,
      createdAt: Date.now(),
    }
    await insertSchedule(s)
    await get().reload()
  },

  toggle: async (id, enabled) => {
    const s = get().schedules.find((x) => x.id === id)
    if (!s) return
    // religar recalcula o próximo tiro a partir de AGORA (um next_run velho
    // dispararia na hora); pausar zera (pausado não conta pro badge).
    let nextRun: number | null = null
    if (enabled) {
      const rec = parseRecurrence(s.recurrence)
      nextRun = rec ? computeNextRun(rec, new Date()) : null
    }
    await setScheduleEnabled(id, enabled, nextRun)
    await get().reload()
  },

  remove: async (id) => {
    await dbDeleteSchedule(id)
    await get().reload()
  },

  runNow: async (id) => {
    const s = get().schedules.find((x) => x.id === id)
    if (!s) return
    await dispatchSchedule(s, { manual: true })
    await get().reload()
  },
}))
