// A automação é quem SABE que ninguém está olhando: ela marca o run como
// desassistido antes do runAgent e desmarca no fim. Sem essa marca o vigia não
// tem como distinguir "turno seu esperando você" de "turno de madrugada
// esperando ninguém" — e o segundo congela pra sempre (approval.rs bloqueia sem
// timeout). Sem a desmarca, um run já morto continuaria elegível a expirar.

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
    setScheduleNextRun: vi.fn(async () => {}),
    listSchedules: vi.fn(async () => []),
  }
})

import { runAgent } from "@/lib/agent"
import type { AgentProbe } from "@/lib/detect"
import type { ScheduleRecord } from "@/lib/db"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useNotifs } from "@/store/notifications"
import { dispatchSchedule } from "./scheduleEngine"
import {
  _resetUnattendedRuns,
  isUnattendedRun,
  unattendedConvOf,
  unattendedRunIds,
} from "./unattendedRuns"

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
    name: "varredura noturna",
    projectId: "p1",
    kind: "agent",
    agent: "codex",
    model: null,
    prompt: "faz a varredura",
    permission: "padrao",
    recurrence: JSON.stringify({ kind: "daily", hour: 3, minute: 0 }),
    enabled: true,
    nextRun: null,
    lastRunAt: null,
    lastRunStatus: null,
    completedAt: null,
    createdAt: 0,
    ...over,
  }
}

/** Ações do chat stubadas (o teste mira a MARCA, não a coreografia do run). */
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
  _resetUnattendedRuns()
  stubChat()
  useApp.setState({
    projects: [{ id: "p1", name: "alpha", path: "/proj/alpha", createdAt: 1 }],
  })
  useApp.setState({
    settings: { ...useApp.getState().settings, detected: { codex: probe() } },
  })
  useNotifs.setState({ items: [] })
})

describe("dispatchSchedule — marca de run desassistido", () => {
  it("marca o run (com a conversa) DURANTE o disparo e desmarca no fim", async () => {
    let marcadoDurante = false
    let convDurante: string | null = null
    let runIdVisto = ""
    vi.mocked(runAgent).mockImplementation(async (runId) => {
      runIdVisto = runId
      marcadoDurante = isUnattendedRun(runId)
      convDurante = unattendedConvOf(runId)
    })

    await dispatchSchedule(schedule())

    expect(marcadoDurante).toBe(true)
    expect(convDurante).not.toBeNull()
    // fim do run = nada mais pode expirar por ele (o "timer" foi cancelado).
    expect(isUnattendedRun(runIdVisto)).toBe(false)
    expect(unattendedRunIds().size).toBe(0)
  })

  it("a marca aponta pra CONVERSA do run (é onde o aviso do timeout vai parar)", async () => {
    let convDoRun = ""
    let convMarcada = ""
    vi.mocked(runAgent).mockImplementation(async (runId, convId) => {
      convDoRun = convId
      convMarcada = unattendedConvOf(runId) ?? ""
    })

    await dispatchSchedule(schedule())

    // conversa errada = notice num fio que ninguém vai abrir: o desfecho tem
    // que cair na conversa que a automação criou.
    expect(convDoRun).not.toBe("")
    expect(convMarcada).toBe(convDoRun)
  })

  it("desmarca também quando o run EXPLODE (invoke falhou)", async () => {
    let runIdVisto = ""
    vi.mocked(runAgent).mockImplementation(async (runId) => {
      runIdVisto = runId
      throw new Error("spawn falhou")
    })

    await dispatchSchedule(schedule())

    expect(runIdVisto).not.toBe("")
    expect(isUnattendedRun(runIdVisto)).toBe(false)
  })

  it("automação bloqueada no preflight não deixa marca (nem run houve)", async () => {
    useApp.setState({
      settings: {
        ...useApp.getState().settings,
        detected: { codex: probe({ auth: "missing" }) },
      },
    })
    vi.mocked(runAgent).mockImplementation(async () => {})

    await dispatchSchedule(schedule({ id: "s2" }))

    expect(runAgent).not.toHaveBeenCalled()
    expect(unattendedRunIds().size).toBe(0)
  })
})
