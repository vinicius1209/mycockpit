// A régua ÚNICA de validade do form de automação. Ela existe pra que o botão
// "Criar" e o handler que grava respondam à MESMA pergunta: antes o botão
// tinha um encadeado de condições no JSX e o store tinha as guardas dele, e as
// duas listas só coincidiam por sorte.

import { describe, expect, it } from "vitest"
import {
  draftFromSchedule,
  draftInput,
  draftRecurrence,
  emptyDraft,
  nextFullHourValue,
  type ScheduleDraft,
} from "./scheduleForm"
import type { ScheduleRecord } from "@/lib/db"

const MIN = 60_000
const AGORA = new Date(2026, 8, 4, 13, 20, 0, 0).getTime()

function draft(over: Partial<ScheduleDraft> = {}): ScheduleDraft {
  return {
    ...emptyDraft({ projectId: "p1", agent: "codex", model: "gpt-5.6-codex", now: AGORA }),
    name: "varredura noturna",
    prompt: "roda a suíte",
    ...over,
  }
}

describe("draftRecurrence", () => {
  it("diário e semanal saem da hora digitada", () => {
    expect(draftRecurrence(draft({ mode: "daily", time: "08:30" }), AGORA)).toEqual(
      { kind: "daily", hour: 8, minute: 30 },
    )
    expect(
      draftRecurrence(draft({ mode: "weekly", weekday: 5, time: "17:00" }), AGORA),
    ).toEqual({ kind: "weekly", weekday: 5, hour: 17, minute: 0 })
  })

  it("cron válido passa; inválido é null (sem ranges na v1)", () => {
    expect(draftRecurrence(draft({ mode: "cron", cron: "0 8 * * 1" }), AGORA)).toEqual(
      { kind: "cron", expr: "0 8 * * 1" },
    )
    expect(draftRecurrence(draft({ mode: "cron", cron: "0 8 * * 1-5" }), AGORA)).toBeNull()
    expect(draftRecurrence(draft({ mode: "cron", cron: "0 8 * *" }), AGORA)).toBeNull()
  })

  it("'uma vez' no passado é null: automação que nasce morta é teatro", () => {
    const passado = draft({ mode: "once", onceAt: "2026-09-04T13:00" })
    expect(draftRecurrence(passado, AGORA)).toBeNull()
    const futuro = draft({ mode: "once", onceAt: "2026-09-04T18:30" })
    expect(draftRecurrence(futuro, AGORA)).toEqual({
      kind: "once",
      at: new Date(2026, 8, 4, 18, 30).getTime(),
    })
  })

  it("data impossível (31/02) não vira 03/03 em silêncio", () => {
    expect(
      draftRecurrence(draft({ mode: "once", onceAt: "2027-02-31T10:00" }), AGORA),
    ).toBeNull()
  })
})

describe("draftInput — o que habilita o botão é o que o store recebe", () => {
  it("rascunho completo vira input, com 'default' virando null", () => {
    const input = draftInput(
      draft({ model: "default", effort: "default" }),
      AGORA,
    )
    expect(input).not.toBeNull()
    expect(input?.model).toBeNull()
    expect(input?.effort).toBeNull()
  })

  it("o esforço escolhido atravessa", () => {
    expect(draftInput(draft({ effort: "xhigh" }), AGORA)?.effort).toBe("xhigh")
  })

  it("nome, projeto ou prompt em branco = null (o botão fica desabilitado)", () => {
    expect(draftInput(draft({ name: "   " }), AGORA)).toBeNull()
    expect(draftInput(draft({ projectId: "" }), AGORA)).toBeNull()
    expect(draftInput(draft({ prompt: "" }), AGORA)).toBeNull()
  })

  it("Plano de voo exige plano; prompt não carrega planId pendurado", () => {
    expect(draftInput(draft({ kind: "mission", planId: "" }), AGORA)).toBeNull()
    const missao = draftInput(
      draft({ kind: "mission", planId: "preset-abc" }),
      AGORA,
    )
    expect(missao?.kind).toBe("mission")
    expect(missao?.planId).toBe("preset-abc")
    // no Plano de voo o effort é POR FASE: o do form não pode viajar junto e
    // prometer um controle que o disparo ignora.
    expect(
      draftInput(draft({ kind: "mission", planId: "x", effort: "high" }), AGORA)
        ?.effort,
    ).toBeNull()
    expect(
      draftInput(draft({ kind: "agent", planId: "preset-abc" }), AGORA)?.planId,
    ).toBeNull()
  })
})

describe("draftFromSchedule — editar abre no estado REAL do registro", () => {
  function persisted(over: Partial<ScheduleRecord> = {}): ScheduleRecord {
    return {
      id: "s1",
      name: "faxina",
      projectId: "p9",
      kind: "agent",
      agent: "codex",
      model: "gpt-5.6-codex",
      effort: "high",
      planId: null,
      prompt: "limpa",
      permission: "auto",
      recurrence: JSON.stringify({ kind: "weekly", weekday: 5, hour: 17, minute: 0 }),
      enabled: true,
      nextRun: null,
      lastRunAt: null,
      lastRunStatus: null,
      completedAt: null,
      createdAt: 0,
      ...over,
    }
  }

  it("a recorrência gravada volta pro modo e pros campos que a produziram", () => {
    const d = draftFromSchedule(persisted(), AGORA)
    expect(d.mode).toBe("weekly")
    expect(d.weekday).toBe(5)
    expect(d.time).toBe("17:00")
    expect(d.permission).toBe("auto")
    expect(d.effort).toBe("high")
    expect(d.projectId).toBe("p9")
  })

  it("'uma vez' reabre com o instante exato no campo de data", () => {
    const at = new Date(2026, 8, 4, 18, 30).getTime()
    const d = draftFromSchedule(
      persisted({ recurrence: JSON.stringify({ kind: "once", at }) }),
      AGORA,
    )
    expect(d.mode).toBe("once")
    expect(d.onceAt).toBe("2026-09-04T18:30")
  })

  it("recorrência corrompida cai no default do form, não num estado inventado", () => {
    const d = draftFromSchedule(persisted({ recurrence: "{ isto não é json" }), AGORA)
    expect(d.mode).toBe("daily")
    expect(d.time).toBe("08:00")
    // o resto do registro continua fiel: só a recorrência ilegível foi trocada.
    expect(d.prompt).toBe("limpa")
  })

  it("automação LEGADA de lead abre no fluxo de prompt (o único que a tela monta)", () => {
    expect(draftFromSchedule(persisted({ kind: "lead" }), AGORA).kind).toBe("agent")
  })

  it("ida e volta: editar sem tocar em nada devolve a MESMA recorrência", () => {
    const s = persisted()
    const input = draftInput(draftFromSchedule(s, AGORA), AGORA)
    expect(JSON.stringify(input?.recurrence)).toBe(s.recurrence)
    expect(input?.permission).toBe(s.permission)
    expect(input?.effort).toBe(s.effort)
    expect(input?.model).toBe(s.model)
  })
})

describe("nextFullHourValue", () => {
  it("é a próxima hora cheia, sempre no futuro", () => {
    expect(nextFullHourValue(AGORA)).toBe("2026-09-04T14:00")
    // 23:20 vira 00:00 do dia seguinte (o Date rola o dia sozinho).
    expect(nextFullHourValue(new Date(2026, 8, 4, 23, 20).getTime())).toBe(
      "2026-09-05T00:00",
    )
  })

  it("o rascunho em branco nasce com um horário que o botão aceita", () => {
    const d = emptyDraft({ projectId: "p1", agent: "codex", model: "m", now: AGORA })
    expect(draftRecurrence({ ...d, mode: "once" }, AGORA)).not.toBeNull()
    expect(AGORA + 60 * MIN).toBeGreaterThan(AGORA) // sanidade do relógio fixo
  })
})
