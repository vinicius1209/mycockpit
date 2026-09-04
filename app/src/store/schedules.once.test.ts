// Recorrência "uma vez" no store: as duas guardas de horário (criar e
// reagendar) e o Reagendar, que devolve a automação concluída ao calendário
// SEM apagar o histórico. Banco e motor mocados: o que se verifica é o que
// chega no banco.

import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  // assinaturas tipadas: o teste inspeciona o REGISTRO que chega no banco.
  insertSchedule: vi.fn(async (_s: unknown) => {}),
  rescheduleSchedule: vi.fn(
    async (_id: string, _recurrence: string, _nextRun: number) => {},
  ),
}))

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  isTauri: () => false,
  listSchedules: vi.fn(async () => []),
  listScheduleRuns: vi.fn(async () => []),
  insertSchedule: h.insertSchedule,
  rescheduleSchedule: h.rescheduleSchedule,
  setScheduleEnabled: vi.fn(async () => {}),
  deleteSchedule: vi.fn(async () => {}),
}))
// o motor puxa runAgent/lead/chat inteiros — o store não precisa deles aqui.
vi.mock("@/lib/scheduleEngine", () => ({
  dispatchSchedule: vi.fn(async () => {}),
  isScheduleRunning: () => false,
}))

import { setScheduleEnabled, type ScheduleRecord } from "@/lib/db"
import { useSchedules } from "./schedules"

const MIN = 60_000

/** Uma automação de uma vez já persistida (o que o store enxerga na lista). */
function persisted(at: number, over: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id: "s1",
    name: "merge da PR da release",
    projectId: "p1",
    kind: "agent",
    agent: "codex",
    model: null,
    effort: null,
    planId: null,
    prompt: "faz o merge da PR da release",
    permission: "padrao",
    recurrence: JSON.stringify({ kind: "once", at }),
    enabled: false,
    nextRun: null,
    lastRunAt: null,
    lastRunStatus: null,
    completedAt: null,
    createdAt: 0,
    ...over,
  }
}

function input(at: number) {
  return {
    name: "merge da PR da release",
    projectId: "p1",
    kind: "agent" as const,
    agent: "codex",
    model: null,
    effort: null,
    planId: null,
    prompt: "faz o merge da PR da release",
    permission: "padrao" as const,
    recurrence: { kind: "once" as const, at },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useSchedules.setState({ schedules: [], runs: [], loaded: false })
})

describe("create — guarda do 'uma vez' no passado", () => {
  it("recusa horário que já passou em vez de gravar algo que nunca dispara", async () => {
    await expect(
      useSchedules.getState().create(input(Date.now() - MIN)),
    ).rejects.toThrow(/já passou/)
    expect(h.insertSchedule).not.toHaveBeenCalled()
  })

  it("barra também o instante EXATO de agora (a régua é estritamente futuro)", async () => {
    // "agora" já é passado quando o motor acordar: o computeNextRun devolve
    // null e a automação nasceria morta.
    await expect(
      useSchedules.getState().create(input(Date.now())),
    ).rejects.toThrow(/já passou/)
    expect(h.insertSchedule).not.toHaveBeenCalled()
  })

  it("horário futuro grava a recorrência once e o next_run no instante exato", async () => {
    const at = Date.now() + 60 * MIN
    await useSchedules.getState().create(input(at))

    const gravado = h.insertSchedule.mock.calls[0][0] as ScheduleRecord
    expect(JSON.parse(gravado.recurrence)).toEqual({ kind: "once", at })
    expect(gravado.nextRun).toBe(at)
    expect(gravado.enabled).toBe(true)
    // nasce sem marca de encerramento: quem carimba é o motor, ao rodar.
    expect(gravado.completedAt).toBeNull()
  })
})

describe("create — os outros kinds seguem intactos (sem regressão)", () => {
  it("daily nasce ligada, com próximo horário e sem marca de encerramento", async () => {
    await useSchedules.getState().create({
      ...input(Date.now() + MIN),
      recurrence: { kind: "daily", hour: 3, minute: 0 },
    })

    const gravado = h.insertSchedule.mock.calls[0][0] as ScheduleRecord
    expect(JSON.parse(gravado.recurrence)).toEqual({
      kind: "daily",
      hour: 3,
      minute: 0,
    })
    expect(gravado.nextRun).toBeGreaterThan(Date.now())
    expect(gravado.enabled).toBe(true)
    expect(gravado.completedAt).toBeNull()
  })

  it("a guarda do passado é SÓ do 'uma vez': cron que nunca casa ainda é gravado", async () => {
    // 31 de fevereiro nunca acontece — o registro entra com next_run null e a
    // lista mostra "não vai rodar". Recusar aqui seria mudar o contrato do cron.
    await useSchedules.getState().create({
      ...input(Date.now() + MIN),
      recurrence: { kind: "cron", expr: "0 0 31 2 *" },
    })

    const gravado = h.insertSchedule.mock.calls[0][0] as ScheduleRecord
    expect(gravado.nextRun).toBeNull()
    expect(gravado.enabled).toBe(true)
  })
})

describe("toggle — pausar/religar uma 'uma vez' (pausada ≠ concluída)", () => {
  it("religar com o instante ainda no futuro restaura o MESMO horário", async () => {
    const at = Date.now() + 120 * MIN
    useSchedules.setState({ schedules: [persisted(at)], runs: [], loaded: true })

    await useSchedules.getState().toggle("s1", true)

    expect(setScheduleEnabled).toHaveBeenCalledWith("s1", true, at)
  })

  it("religar depois do horário NÃO inventa próximo disparo (fica 'não vai rodar')", async () => {
    // um next_run recalculado aqui seria mentira: "uma vez" que passou não tem
    // próximo. A UI avisa e oferece Reagendar.
    useSchedules.setState({
      schedules: [persisted(Date.now() - MIN)],
      runs: [],
      loaded: true,
    })

    await useSchedules.getState().toggle("s1", true)

    expect(setScheduleEnabled).toHaveBeenCalledWith("s1", true, null)
  })
})

describe("reschedule — o botão Reagendar da automação concluída", () => {
  it("grava a nova recorrência once com o next_run no novo instante", async () => {
    const at = Date.now() + 120 * MIN
    await useSchedules.getState().reschedule("s1", at)

    expect(h.rescheduleSchedule).toHaveBeenCalledWith(
      "s1",
      JSON.stringify({ kind: "once", at }),
      at,
    )
  })

  it("recusa reagendar pro passado (a automação voltaria pra lista já morta)", async () => {
    await expect(
      useSchedules.getState().reschedule("s1", Date.now() - MIN),
    ).rejects.toThrow(/já passou/)
    expect(h.rescheduleSchedule).not.toHaveBeenCalled()
  })
})
