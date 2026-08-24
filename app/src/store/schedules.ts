// F6 — store das automações agendadas: espelho em memória de `schedules` +
// `schedule_runs` (SQLite). Recarregado no boot, a cada tick do motor (App.tsx)
// e após cada ação da view. Fail-soft: fora do Tauri fica vazio.
import { create } from "zustand"
import {
  deleteSchedule as dbDeleteSchedule,
  insertSchedule,
  listScheduleRuns,
  listSchedules,
  rescheduleSchedule,
  setScheduleEnabled,
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
  /** "Reagendar" da automação de uma vez: novo instante (epoch ms), religa e
   *  limpa a marca de concluída. LANÇA se o instante não for futuro. */
  reschedule: (id: string, at: number) => Promise<void>
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
    // fail-closed: "uma vez" no passado NUNCA dispararia. O form já barra, isto
    // é a rede — melhor recusar do que gravar algo que nasce morto.
    if (
      input.recurrence.kind === "once" &&
      computeNextRun(input.recurrence, new Date()) == null
    ) {
      throw new Error("O horário escolhido já passou")
    }
    const s: ScheduleRecord = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      projectId: input.projectId,
      // Só se CRIA "agent". "lead" segue existindo no tipo e no banco porque
      // linhas antigas precisam continuar LEGÍVEIS pra serem desligadas com a
      // causa escrita (ADR-078) — o que sumiu foi o produtor, não o leitor.
      kind: "agent",
      agent: input.agent,
      model: input.model,
      prompt: input.prompt.trim(),
      // regra dura: só leitura|padrao chega aqui (o tipo já barra 'liberado').
      permission: input.permission === "padrao" ? "padrao" : "leitura",
      recurrence: JSON.stringify(input.recurrence),
      enabled: true,
      nextRun: computeNextRun(input.recurrence, new Date()),
      lastRunAt: null,
      lastRunStatus: null,
      completedAt: null,
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

  reschedule: async (id, at) => {
    const rec: Recurrence = { kind: "once", at }
    // mesma guarda do create: reagendar pro passado devolveria a automação pra
    // lista já morta. Lança pra view mostrar o motivo (nada de falha muda).
    if (computeNextRun(rec, new Date()) == null) {
      throw new Error("O horário escolhido já passou")
    }
    await rescheduleSchedule(id, JSON.stringify(rec), at)
    await get().reload()
  },
}))
