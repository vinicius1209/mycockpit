import { describe, expect, it } from "vitest"
import {
  CATCHUP_GRACE_MS,
  computeNextRun,
  fmtUntilShort,
  nextScheduled,
  parseCronExpr,
  parseRecurrence,
  recurrenceToText,
  splitDueAndMissed,
  type Recurrence,
} from "./schedules"

// Datas em hora LOCAL (o produto agenda em hora local) — determinístico em
// qualquer TZ porque construímos e comparamos sempre via new Date(y, m, d, …).
const at = (
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
): Date => new Date(y, mo - 1, d, h, mi, 0, 0)

describe("parseCronExpr (subset v1)", () => {
  it("aceita *, */n, listas e números", () => {
    expect(parseCronExpr("* * * * *")).toEqual({
      minute: null,
      hour: null,
      dom: null,
      month: null,
      dow: null,
    })
    expect(parseCronExpr("*/15 * * * *")?.minute).toEqual([0, 15, 30, 45])
    expect(parseCronExpr("0 8 * * 1,3")?.dow).toEqual([1, 3])
    expect(parseCronExpr("5 0 1 1 *")?.dom).toEqual([1])
  })
  it("ordena e deduplica listas", () => {
    expect(parseCronExpr("30,0,30 * * * *")?.minute).toEqual([0, 30])
  })
  it("rejeita ranges (fora do subset v1), campos fora do domínio e lixo", () => {
    expect(parseCronExpr("1-5 * * * *")).toBeNull() // range não suportado
    expect(parseCronExpr("60 * * * *")).toBeNull() // minuto > 59
    expect(parseCronExpr("* 24 * * *")).toBeNull() // hora > 23
    expect(parseCronExpr("* * 0 * *")).toBeNull() // dom < 1
    expect(parseCronExpr("* * * 13 *")).toBeNull() // mês > 12
    expect(parseCronExpr("* * * * 7")).toBeNull() // dow > 6 (v1: 0-6)
    expect(parseCronExpr("a * * * *")).toBeNull()
    expect(parseCronExpr("* * * *")).toBeNull() // 4 campos
    expect(parseCronExpr("*/0 * * * *")).toBeNull() // passo zero
  })
})

describe("computeNextRun — daily", () => {
  const daily: Recurrence = { kind: "daily", hour: 8, minute: 0 }
  it("hoje, quando o horário ainda não passou", () => {
    expect(computeNextRun(daily, at(2026, 7, 14, 6, 30))).toBe(
      at(2026, 7, 14, 8, 0).getTime(),
    )
  })
  it("amanhã, quando o horário já passou (inclusive o exato — estritamente depois)", () => {
    expect(computeNextRun(daily, at(2026, 7, 14, 9, 0))).toBe(
      at(2026, 7, 15, 8, 0).getTime(),
    )
    expect(computeNextRun(daily, at(2026, 7, 14, 8, 0))).toBe(
      at(2026, 7, 15, 8, 0).getTime(),
    )
  })
  it("vira o mês (31/jan → 1/fev) e o ano (31/dez → 1/jan)", () => {
    expect(computeNextRun(daily, at(2026, 1, 31, 12, 0))).toBe(
      at(2026, 2, 1, 8, 0).getTime(),
    )
    expect(computeNextRun(daily, at(2026, 12, 31, 23, 59))).toBe(
      at(2027, 1, 1, 8, 0).getTime(),
    )
  })
})

describe("computeNextRun — weekly", () => {
  // 14/07/2026 é uma TERÇA (weekday 2).
  const mondayNine: Recurrence = { kind: "weekly", weekday: 1, hour: 9, minute: 0 }
  it("no mesmo dia, quando é o weekday e o horário não passou", () => {
    const tue: Recurrence = { kind: "weekly", weekday: 2, hour: 18, minute: 30 }
    expect(computeNextRun(tue, at(2026, 7, 14, 10, 0))).toBe(
      at(2026, 7, 14, 18, 30).getTime(),
    )
  })
  it("pula pra próxima semana quando o horário do dia já passou", () => {
    const tue: Recurrence = { kind: "weekly", weekday: 2, hour: 9, minute: 0 }
    expect(computeNextRun(tue, at(2026, 7, 14, 9, 0))).toBe(
      at(2026, 7, 21, 9, 0).getTime(),
    )
  })
  it("acha o próximo weekday dentro da semana (ter → seg = 6 dias)", () => {
    expect(computeNextRun(mondayNine, at(2026, 7, 14, 12, 0))).toBe(
      at(2026, 7, 20, 9, 0).getTime(),
    )
  })
  it("vira o mês quando o próximo weekday cai no mês seguinte", () => {
    // 30/07/2026 é quinta; próxima segunda = 03/08.
    expect(computeNextRun(mondayNine, at(2026, 7, 30, 12, 0))).toBe(
      at(2026, 8, 3, 9, 0).getTime(),
    )
  })
})

describe("computeNextRun — cron", () => {
  it("*/15: próximo múltiplo de 15min", () => {
    const r: Recurrence = { kind: "cron", expr: "*/15 * * * *" }
    expect(computeNextRun(r, at(2026, 7, 14, 10, 7))).toBe(
      at(2026, 7, 14, 10, 15).getTime(),
    )
    // exatamente num tiro → o PRÓXIMO (estritamente depois)
    expect(computeNextRun(r, at(2026, 7, 14, 10, 45))).toBe(
      at(2026, 7, 14, 11, 0).getTime(),
    )
  })
  it("hora fixa: hoje se não passou, senão amanhã (virada de dia)", () => {
    const r: Recurrence = { kind: "cron", expr: "30 8 * * *" }
    expect(computeNextRun(r, at(2026, 7, 14, 8, 0))).toBe(
      at(2026, 7, 14, 8, 30).getTime(),
    )
    expect(computeNextRun(r, at(2026, 7, 14, 9, 0))).toBe(
      at(2026, 7, 15, 8, 30).getTime(),
    )
  })
  it("dia da semana: 0 9 * * 1 acha a próxima segunda", () => {
    const r: Recurrence = { kind: "cron", expr: "0 9 * * 1" }
    expect(computeNextRun(r, at(2026, 7, 14, 12, 0))).toBe(
      at(2026, 7, 20, 9, 0).getTime(),
    )
  })
  it("dia do mês: 0 9 1 * * vira o mês (15/jul → 1/ago)", () => {
    const r: Recurrence = { kind: "cron", expr: "0 9 1 * *" }
    expect(computeNextRun(r, at(2026, 7, 15, 12, 0))).toBe(
      at(2026, 8, 1, 9, 0).getTime(),
    )
  })
  it("mês fixo: 0 0 1 1 * pula pro próximo 1º de janeiro", () => {
    const r: Recurrence = { kind: "cron", expr: "0 0 1 1 *" }
    expect(computeNextRun(r, at(2026, 7, 14, 0, 0))).toBe(
      at(2027, 1, 1, 0, 0).getTime(),
    )
  })
  it("dom E dow restritos = OU (regra clássica do cron)", () => {
    // dia 20 OU sexta. De ter 14/07: a sexta 17/07 vem antes do dia 20.
    const r: Recurrence = { kind: "cron", expr: "0 9 20 * 5" }
    expect(computeNextRun(r, at(2026, 7, 14, 12, 0))).toBe(
      at(2026, 7, 17, 9, 0).getTime(),
    )
  })
  it("expressão que nunca casa retorna null (ex.: 31 de fevereiro)", () => {
    const r: Recurrence = { kind: "cron", expr: "0 0 31 2 *" }
    expect(computeNextRun(r, at(2026, 7, 14))).toBeNull()
  })
  it("expressão inválida retorna null", () => {
    expect(
      computeNextRun({ kind: "cron", expr: "não é cron" }, at(2026, 7, 14)),
    ).toBeNull()
  })
})

describe("parseRecurrence", () => {
  it("aceita os três kinds válidos", () => {
    expect(parseRecurrence('{"kind":"daily","hour":8,"minute":0}')).toEqual({
      kind: "daily",
      hour: 8,
      minute: 0,
    })
    expect(
      parseRecurrence('{"kind":"weekly","weekday":5,"hour":17,"minute":30}'),
    ).toEqual({ kind: "weekly", weekday: 5, hour: 17, minute: 30 })
    expect(parseRecurrence('{"kind":"cron","expr":"*/5 * * * *"}')).toEqual({
      kind: "cron",
      expr: "*/5 * * * *",
    })
  })
  it("rejeita JSON quebrado, kind desconhecido e campos fora do range", () => {
    expect(parseRecurrence("{nope")).toBeNull()
    expect(parseRecurrence('{"kind":"monthly","day":1}')).toBeNull()
    expect(parseRecurrence('{"kind":"daily","hour":24,"minute":0}')).toBeNull()
    expect(
      parseRecurrence('{"kind":"weekly","weekday":7,"hour":8,"minute":0}'),
    ).toBeNull()
    expect(parseRecurrence('{"kind":"cron","expr":"1-5 * * * *"}')).toBeNull()
  })
})

describe("recurrenceToText", () => {
  it("humaniza cada kind (e o inválido)", () => {
    expect(recurrenceToText({ kind: "daily", hour: 8, minute: 0 })).toBe(
      "diário às 08:00",
    )
    expect(
      recurrenceToText({ kind: "weekly", weekday: 1, hour: 9, minute: 5 }),
    ).toBe("semanal (seg) às 09:05")
    expect(recurrenceToText({ kind: "cron", expr: "*/5 * * * *" })).toBe(
      "cron */5 * * * *",
    )
    expect(recurrenceToText(null)).toBe("recorrência inválida")
  })
})

describe("splitDueAndMissed (catch-up puro)", () => {
  const now = at(2026, 7, 14, 12, 0).getTime()
  const sched = (enabled: boolean, nextRun: number | null) => ({
    enabled,
    nextRun,
  })
  it("vencido dentro da graça dispara; além dela vira 'missed'", () => {
    const dueOne = sched(true, now - 60_000) // 1min atrás → roda
    const missedOne = sched(true, now - CATCHUP_GRACE_MS - 1) // >5min → perdido
    const { due, missed } = splitDueAndMissed([dueOne, missedOne], now)
    expect(due).toEqual([dueOne])
    expect(missed).toEqual([missedOne])
  })
  it("exatamente na borda da graça ainda roda (≤ grace)", () => {
    const edge = sched(true, now - CATCHUP_GRACE_MS)
    expect(splitDueAndMissed([edge], now).due).toEqual([edge])
  })
  it("futuro, desabilitado e sem next_run ficam fora dos dois grupos", () => {
    const rows = [
      sched(true, now + 60_000), // futuro
      sched(false, now - 60_000), // pausado
      sched(true, null), // sem next_run
    ]
    const { due, missed } = splitDueAndMissed(rows, now)
    expect(due).toEqual([])
    expect(missed).toEqual([])
  })
})

describe("nextScheduled + fmtUntilShort", () => {
  it("acha o menor next_run entre os habilitados", () => {
    const rows = [
      { enabled: true, nextRun: 3000 },
      { enabled: true, nextRun: 1000 },
      { enabled: false, nextRun: 500 }, // pausado não conta
      { enabled: true, nextRun: null },
    ]
    expect(nextScheduled(rows)?.nextRun).toBe(1000)
    expect(nextScheduled([])).toBeNull()
  })
  it("formata o delta curto do badge", () => {
    expect(fmtUntilShort(10_000)).toBe("agora")
    expect(fmtUntilShort(12 * 60_000)).toBe("12min")
    expect(fmtUntilShort(2 * 3600_000)).toBe("2h")
    expect(fmtUntilShort(3 * 24 * 3600_000)).toBe("3d")
  })
})
