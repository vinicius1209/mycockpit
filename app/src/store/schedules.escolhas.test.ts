// As ESCOLHAS do form chegando ao banco: permissão (inclusive "auto"),
// esforço do modelo, Plano de voo e a edição de uma automação existente.
//
// O caso real que abriu este arquivo (04/09/2026): escolher "Auto" no dialog
// gravava 'leitura'. O `create` tinha um clamp escrito à mão
// (`=== "padrao" ? "padrao" : "leitura"`) que o ADR-023 esqueceu de mexer
// quando abriu o modo. A tela mostrava o botão selecionado, o banco guardava
// outra coisa e o Codex rodava confinado em read-only.

import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  insertSchedule: vi.fn(async (_s: unknown) => {}),
  updateSchedule: vi.fn(async (_id: string, _e: unknown) => {}),
}))

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  isTauri: () => false,
  listSchedules: vi.fn(async () => []),
  listScheduleRuns: vi.fn(async () => []),
  insertSchedule: h.insertSchedule,
  updateSchedule: h.updateSchedule,
  setScheduleEnabled: vi.fn(async () => {}),
  deleteSchedule: vi.fn(async () => {}),
  rescheduleSchedule: vi.fn(async () => {}),
}))
vi.mock("@/lib/scheduleEngine", () => ({
  dispatchSchedule: vi.fn(async () => {}),
  isScheduleRunning: () => false,
}))

import type { ScheduleEdit, ScheduleRecord } from "@/lib/db"
import { useSchedules, type NewScheduleInput } from "./schedules"

function input(over: Partial<NewScheduleInput> = {}): NewScheduleInput {
  return {
    name: "varredura noturna",
    projectId: "p1",
    kind: "agent",
    agent: "codex",
    model: "gpt-5.6-codex",
    effort: "high",
    prompt: "roda a suíte e me diz o que quebrou",
    permission: "auto",
    planId: null,
    recurrence: { kind: "daily", hour: 3, minute: 0 },
    ...over,
  }
}

const gravado = () => h.insertSchedule.mock.calls[0][0] as ScheduleRecord
const editado = () => h.updateSchedule.mock.calls[0][1] as ScheduleEdit

beforeEach(() => {
  vi.clearAllMocks()
  useSchedules.setState({ schedules: [], runs: [], loaded: false })
})

describe("create — a escolha do usuário chega ao banco", () => {
  it("'auto' é GRAVADO como auto (o clamp à mão engolia e virava leitura)", async () => {
    await useSchedules.getState().create(input({ permission: "auto" }))
    expect(gravado().permission).toBe("auto")
  })

  it("'padrao' e 'leitura' seguem intactos", async () => {
    await useSchedules.getState().create(input({ permission: "padrao" }))
    expect(gravado().permission).toBe("padrao")
    vi.clearAllMocks()
    await useSchedules.getState().create(input({ permission: "leitura" }))
    expect(gravado().permission).toBe("leitura")
  })

  it("'liberado' vindo por fora do tipo continua barrado (fail-closed)", async () => {
    await useSchedules
      .getState()
      .create(input({ permission: "liberado" as never }))
    expect(gravado().permission).toBe("leitura")
  })

  it("o esforço do modelo é persistido junto do modelo", async () => {
    await useSchedules.getState().create(input({ effort: "xhigh" }))
    expect(gravado().effort).toBe("xhigh")
    expect(gravado().model).toBe("gpt-5.6-codex")
  })

  it("automação de Plano de voo grava o plano e o fluxo", async () => {
    await useSchedules
      .getState()
      .create(input({ kind: "mission", planId: "preset-abc" }))
    expect(gravado().kind).toBe("mission")
    expect(gravado().planId).toBe("preset-abc")
  })

  it("Plano de voo SEM plano é recusado em vez de nascer sem nada pra rodar", async () => {
    await expect(
      useSchedules.getState().create(input({ kind: "mission", planId: null })),
    ).rejects.toThrow(/Plano de voo/)
    expect(h.insertSchedule).not.toHaveBeenCalled()
  })

  it("automação de prompt não carrega plano, mesmo se o rascunho trouxer um", async () => {
    // trocar de "Plano de voo" pra "Prompt" no form não pode deixar um planId
    // pendurado: o disparo leria o fluxo errado.
    await useSchedules
      .getState()
      .create(input({ kind: "agent", planId: "preset-abc" }))
    expect(gravado().planId).toBeNull()
  })
})

describe("edit — consertar em vez de excluir e redigitar", () => {
  it("salva as mudanças e RECALCULA o próximo disparo da recorrência nova", async () => {
    const antes = Date.now()
    await useSchedules.getState().edit("s1", input({ permission: "auto" }))
    const e = editado()
    expect(h.updateSchedule.mock.calls[0][0]).toBe("s1")
    expect(e.permission).toBe("auto")
    expect(e.effort).toBe("high")
    expect(JSON.parse(e.recurrence)).toEqual({
      kind: "daily",
      hour: 3,
      minute: 0,
    })
    expect(e.nextRun).toBeGreaterThan(antes)
  })

  it("as MESMAS guardas do criar valem na edição (nada entra pela porta dos fundos)", async () => {
    await expect(
      useSchedules.getState().edit(
        "s1",
        input({ recurrence: { kind: "once", at: Date.now() - 60_000 } }),
      ),
    ).rejects.toThrow(/já passou/)
    await expect(
      useSchedules.getState().edit("s1", input({ kind: "mission", planId: null })),
    ).rejects.toThrow(/Plano de voo/)
    expect(h.updateSchedule).not.toHaveBeenCalled()
  })
})
