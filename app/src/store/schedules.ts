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
  updateSchedule,
  type ScheduleKind,
  type SchedulePermission,
  type ScheduleRecord,
  type ScheduleRunRecord,
} from "@/lib/db"
import { normalizeSchedulePermission } from "@/lib/sessionMode"
import {
  computeNextRun,
  parseRecurrence,
  type Recurrence,
} from "@/lib/schedules"
import { dispatchSchedule } from "@/lib/scheduleEngine"

export interface NewScheduleInput {
  name: string
  projectId: string
  /** "agent" = um prompt; "mission" = um Plano de voo (loop agêntico). O form
   *  só produz estes dois; "lead" é legado de leitura (ADR-078). */
  kind: Extract<ScheduleKind, "agent" | "mission">
  agent: string
  model: string | null
  /** null = default do agent (nenhuma flag no spawn). */
  effort: string | null
  prompt: string
  permission: SchedulePermission
  /** Plano de voo, obrigatório quando `kind === "mission"`. */
  planId: string | null
  recurrence: Recurrence
}

interface SchedulesState {
  schedules: ScheduleRecord[]
  /** Histórico recente (todas as automações; a view agrupa por scheduleId). */
  runs: ScheduleRunRecord[]
  loaded: boolean

  reload: () => Promise<void>
  create: (input: NewScheduleInput) => Promise<void>
  /** Edita uma automação existente (mesmo form do criar). O next_run é
   *  RECALCULADO da recorrência nova; histórico e id não se tocam. LANÇA com o
   *  motivo quando o rascunho é inválido — a view mostra em vez de fingir. */
  edit: (id: string, input: NewScheduleInput) => Promise<void>
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
    // fail-closed: Plano de voo sem plano escolhido nasceria sem nada pra
    // rodar (e o disparo é que descobriria). Recusa aqui.
    if (input.kind === "mission" && !input.planId) {
      throw new Error("Escolha um Plano de voo")
    }
    const s: ScheduleRecord = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      projectId: input.projectId,
      // Só se CRIA "agent" e "mission". "lead" segue existindo no tipo e no
      // banco porque linhas antigas precisam continuar LEGÍVEIS pra serem
      // desligadas com a causa escrita (ADR-078) — o que sumiu foi o produtor,
      // não o leitor.
      kind: input.kind,
      agent: input.agent,
      model: input.model,
      effort: input.effort,
      prompt: input.prompt.trim(),
      // clamp ÚNICO do vocabulário (lib/sessionMode) — o que estava escrito à
      // mão aqui engolia o "auto" que a tela oferecia (ADR-161).
      permission: normalizeSchedulePermission(input.permission),
      planId: input.kind === "mission" ? input.planId : null,
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

  edit: async (id, input) => {
    // MESMAS guardas do create: horário morto e Plano de voo vazio não passam
    // por edição do que já existe (senão a edição vira a porta dos fundos).
    if (
      input.recurrence.kind === "once" &&
      computeNextRun(input.recurrence, new Date()) == null
    ) {
      throw new Error("O horário escolhido já passou")
    }
    if (input.kind === "mission" && !input.planId) {
      throw new Error("Escolha um Plano de voo")
    }
    await updateSchedule(id, {
      name: input.name.trim(),
      projectId: input.projectId,
      kind: input.kind,
      agent: input.agent,
      model: input.model,
      effort: input.effort,
      prompt: input.prompt.trim(),
      permission: normalizeSchedulePermission(input.permission),
      planId: input.kind === "mission" ? input.planId : null,
      recurrence: JSON.stringify(input.recurrence),
      nextRun: computeNextRun(input.recurrence, new Date()),
    })
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
