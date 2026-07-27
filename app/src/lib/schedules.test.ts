import { describe, expect, it } from "vitest"
import {
  CATCHUP_GRACE_MS,
  computeNextRun,
  fmtRunShort,
  fmtUntilShort,
  nextRuns,
  nextScheduled,
  parseCronExpr,
  parseLocalDateTime,
  parseRecurrence,
  recurrenceToText,
  scheduleLifecycle,
  splitDueAndMissed,
  toLocalDateTimeValue,
  upcomingScheduled,
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

describe("computeNextRun — once (uma vez)", () => {
  // 25/07/2026 18:30 — o caso real: "hoje às 18:30, merge da PR da release".
  const quando = at(2026, 7, 25, 18, 30).getTime()
  const once: Recurrence = { kind: "once", at: quando }

  it("devolve o instante enquanto ele está no futuro", () => {
    expect(computeNextRun(once, at(2026, 7, 25, 9, 0))).toBe(quando)
    expect(computeNextRun(once, at(2026, 7, 25, 18, 29))).toBe(quando)
  })
  it("no instante EXATO já não dispara (estritamente depois, como os outros)", () => {
    expect(computeNextRun(once, at(2026, 7, 25, 18, 30))).toBeNull()
  })
  it("passou = null pra sempre — nunca re-dispara", () => {
    expect(computeNextRun(once, at(2026, 7, 25, 18, 31))).toBeNull()
    expect(computeNextRun(once, at(2027, 1, 1, 0, 0))).toBeNull()
  })
  it("nextRuns devolve UM disparo só (o preview do dialog não mente)", () => {
    expect(nextRuns(once, at(2026, 7, 25, 9, 0), 3)).toEqual([quando])
    expect(nextRuns(once, at(2026, 7, 26, 9, 0), 3)).toEqual([])
  })
  it("uma vez vencida NÃO entra em due nem em missed (fica sem next_run)", () => {
    const now = at(2026, 7, 25, 20, 0).getTime()
    const rows = [{ enabled: true, nextRun: null }]
    expect(splitDueAndMissed(rows, now)).toEqual({ due: [], missed: [] })
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
  it("aceita once com epoch ms inteiro (inclusive no passado, que ainda é legítimo)", () => {
    // o instante passado continua válido: a automação que já rodou precisa dele
    // pra lista mostrar o que foi agendado e oferecer o Reagendar.
    const ts = at(2026, 7, 25, 18, 30).getTime()
    expect(parseRecurrence(`{"kind":"once","at":${ts}}`)).toEqual({
      kind: "once",
      at: ts,
    })
    expect(parseRecurrence('{"kind":"once","at":1}')).toEqual({
      kind: "once",
      at: 1,
    })
  })
  it("rejeita once sem epoch válido (string, zero, fração, ausente)", () => {
    expect(parseRecurrence('{"kind":"once","at":"18:30"}')).toBeNull()
    expect(parseRecurrence('{"kind":"once","at":0}')).toBeNull()
    expect(parseRecurrence('{"kind":"once","at":-1}')).toBeNull()
    expect(parseRecurrence('{"kind":"once","at":1.5}')).toBeNull()
    expect(parseRecurrence('{"kind":"once"}')).toBeNull()
  })
})

describe("parseLocalDateTime + toLocalDateTimeValue (input datetime-local)", () => {
  it("lê o valor cru do input como hora LOCAL", () => {
    expect(parseLocalDateTime("2026-07-25T18:30")).toBe(
      at(2026, 7, 25, 18, 30).getTime(),
    )
  })
  it("descarta os segundos (o motor trabalha em minuto)", () => {
    expect(parseLocalDateTime("2026-07-25T18:30:59")).toBe(
      at(2026, 7, 25, 18, 30).getTime(),
    )
  })
  it("rejeita formato incompleto, lixo e data impossível (31/04 não vira 01/05)", () => {
    expect(parseLocalDateTime("")).toBeNull()
    expect(parseLocalDateTime("2026-07-25")).toBeNull()
    expect(parseLocalDateTime("25/07/2026 18:30")).toBeNull()
    expect(parseLocalDateTime("2026-04-31T10:00")).toBeNull()
    expect(parseLocalDateTime("2026-13-01T10:00")).toBeNull()
    expect(parseLocalDateTime("2026-07-25T24:00")).toBeNull()
  })
  it("faz o caminho de volta (epoch → valor do input) sem perder o minuto", () => {
    const ts = at(2026, 7, 5, 8, 5).getTime()
    expect(toLocalDateTimeValue(ts)).toBe("2026-07-05T08:05")
    expect(parseLocalDateTime(toLocalDateTimeValue(ts))).toBe(ts)
  })
})

describe("scheduleLifecycle (concluída ≠ pausada ≠ sem próxima)", () => {
  it("concluída manda sobre tudo: ela é desabilitada por consequência", () => {
    expect(
      scheduleLifecycle({ enabled: false, nextRun: null, completedAt: 123 }),
    ).toBe("concluida")
  })
  it("pausada é o gesto do usuário (nunca rodou e se encerrou)", () => {
    expect(
      scheduleLifecycle({ enabled: false, nextRun: null, completedAt: null }),
    ).toBe("pausada")
    // pausada com horário futuro guardado segue pausada (religar a traz de volta)
    expect(
      scheduleLifecycle({ enabled: false, nextRun: 9_000, completedAt: null }),
    ).toBe("pausada")
  })
  it("ligada e sem próximo disparo = 'não vai rodar' (horário perdido/cron morto)", () => {
    expect(
      scheduleLifecycle({ enabled: true, nextRun: null, completedAt: null }),
    ).toBe("sem_proxima")
  })
  it("ligada com próxima execução = ativa", () => {
    expect(
      scheduleLifecycle({ enabled: true, nextRun: 9_000, completedAt: null }),
    ).toBe("ativa")
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
    expect(
      recurrenceToText({
        kind: "once",
        at: at(2026, 7, 25, 18, 30).getTime(),
      }),
    ).toBe("uma vez em 25/07 às 18:30")
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

describe("nextRuns + fmtRunShort (preview 'Próximas:' do dialog)", () => {
  it("3 próximas de um daily 08:00: hoje (antes das 8), amanhã e depois", () => {
    const daily: Recurrence = { kind: "daily", hour: 8, minute: 0 }
    // ter 14/07/2026 06:00 → ter 14, qua 15 e qui 16 às 08:00
    expect(nextRuns(daily, at(2026, 7, 14, 6, 0), 3)).toEqual([
      at(2026, 7, 14, 8, 0).getTime(),
      at(2026, 7, 15, 8, 0).getTime(),
      at(2026, 7, 16, 8, 0).getTime(),
    ])
  })
  it("formata cada item como 'ter 08:00' (dia curto + hora local)", () => {
    // 14/07/2026 é uma terça
    expect(fmtRunShort(at(2026, 7, 14, 8, 0).getTime())).toBe("ter 08:00")
    expect(fmtRunShort(at(2026, 7, 17, 17, 5).getTime())).toBe("sex 17:05")
  })
  it("cron que nunca casa devolve lista vazia (a UI mostra o aviso)", () => {
    expect(
      nextRuns({ kind: "cron", expr: "0 0 31 2 *" }, at(2026, 7, 14), 3),
    ).toEqual([])
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

describe("upcomingScheduled (quadro de avisos do office)", () => {
  const rows = [
    { enabled: true, nextRun: 3000 },
    { enabled: true, nextRun: 1000 },
    { enabled: false, nextRun: 500 }, // pausado não conta
    { enabled: true, nextRun: null }, // sem next_run não conta
    { enabled: true, nextRun: 2000 },
  ]
  it("lista em ordem crescente de next_run, só habilitados com next_run", () => {
    expect(upcomingScheduled(rows, 4).map((s) => s.nextRun)).toEqual([
      1000, 2000, 3000,
    ])
  })
  it("respeita o teto max (o quadro mostra até 4)", () => {
    expect(upcomingScheduled(rows, 2).map((s) => s.nextRun)).toEqual([
      1000, 2000,
    ])
    expect(upcomingScheduled(rows, 0)).toEqual([])
  })
  it("max=1 coincide com o nextScheduled (mesma régua do badge)", () => {
    expect(upcomingScheduled(rows, 1)[0]).toBe(nextScheduled(rows))
    expect(upcomingScheduled([], 4)).toEqual([])
  })
  it("não muta a lista de entrada (sort em cópia)", () => {
    const antes = rows.map((s) => s.nextRun)
    upcomingScheduled(rows, 4)
    expect(rows.map((s) => s.nextRun)).toEqual(antes)
  })
})
