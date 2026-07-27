// Recorrência "uma vez": a automação roda UMA vez e se encerra. O motor marca
// o encerramento ANTES do run (mesma razão do next_run avançado no disparo: se
// o app fechar no meio, ela não pode voltar a disparar) e o registro NÃO é
// apagado — fica na lista, desabilitada e concluída, com "Reagendar".
//
// Harness copiado do scheduleEngine.test.ts: db mockado, chat stubado, o teste
// mira a GUARDA (o que foi gravado), não a coreografia do run.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, runAgent: vi.fn(async () => {}) }
})
vi.mock("@/lib/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/db")>()
  return {
    ...mod,
    isTauri: () => true,
    insertScheduleRun: vi.fn(async () => {}),
    markScheduleRun: vi.fn(async () => {}),
    markScheduleCompleted: vi.fn(async () => {}),
    setScheduleNextRun: vi.fn(async () => {}),
    listSchedules: vi.fn(async () => []),
  }
})

import { runAgent } from "@/lib/agent"
import type { AgentProbe } from "@/lib/detect"
import {
  listSchedules,
  markScheduleCompleted,
  setScheduleNextRun,
  type ScheduleRecord,
} from "@/lib/db"
import { CATCHUP_GRACE_MS } from "@/lib/schedules"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useNotifs } from "@/store/notifications"
import { dispatchSchedule, tickSchedules } from "./scheduleEngine"

const MIN = 60_000
const T0 = new Date(2026, 6, 25, 18, 30, 0, 0).getTime() // 25/07/2026 18:30

function probe(patch: Partial<AgentProbe> = {}): AgentProbe {
  return {
    installed: true,
    version: "1.0.0",
    auth: "ok",
    detail: null,
    latest: null,
    checkedAt: 0,
    ...patch,
  }
}

function schedule(over: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id: "s1",
    name: "merge da PR da release",
    projectId: "p1",
    kind: "agent",
    agent: "codex",
    model: null,
    prompt: "faz o merge da PR da release",
    permission: "padrao",
    recurrence: JSON.stringify({ kind: "once", at: T0 }),
    enabled: true,
    nextRun: T0,
    lastRunAt: null,
    lastRunStatus: null,
    completedAt: null,
    createdAt: 0,
    ...over,
  }
}

function stubChat() {
  useChat.setState({
    byId: {},
    registerConversation: vi.fn(async () => {}),
    start: vi.fn(),
    handleEvent: vi.fn(),
    finish: vi.fn(),
    persist: vi.fn(async () => {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  stubChat()
  useApp.setState({
    projects: [{ id: "p1", name: "alpha", path: "/proj/alpha", createdAt: 1 }],
    settings: { ...useApp.getState().settings, detected: { codex: probe() } },
  })
  useNotifs.setState({ items: [] })
})

describe("dispatchSchedule — automação de uma vez", () => {
  it("encerra a automação no disparo agendado (concluída, sem próximo)", async () => {
    await dispatchSchedule(schedule())

    expect(markScheduleCompleted).toHaveBeenCalledWith("s1", expect.any(Number))
    // nada de recalcular calendário: "uma vez" não tem próximo horário.
    expect(setScheduleNextRun).not.toHaveBeenCalled()
  })

  it('"Rodar agora" TAMBÉM encerra: o merge não pode sair duas vezes', async () => {
    // o manual normalmente não mexe no calendário, mas aqui deixar o disparo
    // de pé faria a automação rodar de novo no horário original.
    await dispatchSchedule(schedule({ id: "s2" }), { manual: true })

    expect(markScheduleCompleted).toHaveBeenCalledWith("s2", expect.any(Number))
    expect(setScheduleNextRun).not.toHaveBeenCalled()
  })

  it("run que FALHOU também encerra (v1 não tem retry; re-rodar é gesto humano)", async () => {
    // CLI deslogada = falha no preflight, antes do spawn. A marca de encerrada
    // já foi gravada: a alternativa seria uma automação ligada e sem disparo.
    useApp.setState({
      settings: {
        ...useApp.getState().settings,
        detected: { codex: probe({ auth: "missing" }) },
      },
    })

    await dispatchSchedule(schedule({ id: "s3" }))

    expect(markScheduleCompleted).toHaveBeenCalledWith("s3", expect.any(Number))
    expect(useNotifs.getState().items[0].title).toContain("Automação falhou")
  })

  it("recorrência recorrente segue no calendário (não encerra nada)", async () => {
    await dispatchSchedule(
      schedule({
        id: "s4",
        recurrence: JSON.stringify({ kind: "daily", hour: 3, minute: 0 }),
      }),
    )

    expect(markScheduleCompleted).not.toHaveBeenCalled()
    expect(setScheduleNextRun).toHaveBeenCalledWith("s4", expect.any(Number))
  })
})

// O tick é quem decide sozinho, sem humano na frente da tela: é aqui que "roda
// UMA vez" precisa valer mesmo quando o app esteve fechado.
describe("tickSchedules — a automação de uma vez no calendário real", () => {
  it("vencida DENTRO da graça: roda e se encerra no mesmo tick", async () => {
    vi.mocked(listSchedules).mockResolvedValue([
      schedule({ nextRun: Date.now() - MIN }),
    ])

    await tickSchedules()

    expect(runAgent).toHaveBeenCalledTimes(1)
    expect(markScheduleCompleted).toHaveBeenCalledWith("s1", expect.any(Number))
  })

  it("perdida com o app FECHADO não roda sozinha nem vira concluída: fica sem próxima", async () => {
    // fora da graça de 5min = catch-up explícito. Rodar um merge de release 8h
    // atrasado, sem ninguém olhando, é pior do que não rodar.
    vi.mocked(listSchedules).mockResolvedValue([
      schedule({ nextRun: Date.now() - CATCHUP_GRACE_MS - MIN }),
    ])

    await tickSchedules()

    expect(runAgent).not.toHaveBeenCalled()
    // e NÃO se marca concluída: ela não rodou. Fica ligada e sem next_run —
    // o estado "não vai rodar" da lista, com Reagendar à mão.
    expect(markScheduleCompleted).not.toHaveBeenCalled()
    expect(setScheduleNextRun).toHaveBeenCalledWith("s1", null)
    expect(useNotifs.getState().items[0].title).toContain("perdida")
  })

  it("a concluída é ignorada nos ticks seguintes (nunca dispara duas vezes)", async () => {
    vi.mocked(listSchedules).mockResolvedValue([
      schedule({
        enabled: false,
        nextRun: null,
        completedAt: Date.now() - MIN,
      }),
    ])

    await tickSchedules()

    expect(runAgent).not.toHaveBeenCalled()
    expect(markScheduleCompleted).not.toHaveBeenCalled()
    expect(setScheduleNextRun).not.toHaveBeenCalled()
    expect(useNotifs.getState().items).toEqual([])
  })
})
