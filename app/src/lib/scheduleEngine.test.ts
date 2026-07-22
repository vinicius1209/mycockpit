// D2 (follow-up F-A) — preflight de availability nas automações agendadas:
// CLI ausente/deslogada às 3h não ganha spawn nem conversa; a falha entra no
// histórico (schedule_runs) com o MOTIVO real na notificação, e o next_run
// segue avançando (sem retry em loop — re-rodar é decisão humana).

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
import {
  insertScheduleRun,
  markScheduleRun,
  setScheduleNextRun,
  type ScheduleRecord,
} from "@/lib/db"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useNotifs } from "@/store/notifications"
import { dispatchSchedule } from "./scheduleEngine"

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
    permission: "leitura",
    recurrence: JSON.stringify({ kind: "daily", hour: 3, minute: 0 }),
    enabled: true,
    nextRun: null,
    lastRunAt: null,
    lastRunStatus: null,
    createdAt: 0,
    ...over,
  }
}

/** Ações do chat stubadas (o teste mira a GUARDA, não a coreografia do run —
 *  essa tem o caminho normal do app). setState merge substitui só as usadas. */
function stubChat() {
  const registerConversation = vi.fn(async () => {})
  useChat.setState({
    byId: {},
    registerConversation,
    start: vi.fn(),
    handleEvent: vi.fn(),
    finish: vi.fn(),
    persist: vi.fn(async () => {}),
  })
  return { registerConversation }
}

function armDetected(detected: Record<string, AgentProbe>) {
  const settings = useApp.getState().settings
  useApp.setState({ settings: { ...settings, detected } })
}

beforeEach(() => {
  vi.clearAllMocks()
  useApp.setState({
    projects: [
      {
        id: "p1",
        name: "alpha",
        path: "/proj/alpha",
        createdAt: 1,
      },
    ],
  })
  useNotifs.setState({ items: [] })
})

describe("dispatchSchedule — preflight de availability (D2)", () => {
  it("CLI deslogada: NÃO spawna nem cria conversa; falha registrada com o motivo real", async () => {
    const { registerConversation } = stubChat()
    armDetected({ codex: probe({ auth: "missing" }) })

    await dispatchSchedule(schedule())

    // nada de run nem conversa gasta
    expect(runAgent).not.toHaveBeenCalled()
    expect(registerConversation).not.toHaveBeenCalled()
    // a falha entra no histórico com o shape existente (sem conversa)
    expect(insertScheduleRun).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: "s1",
        status: "failed",
        convId: null,
        cost: null,
      }),
    )
    expect(markScheduleRun).toHaveBeenCalledWith(
      "s1",
      expect.any(Number),
      "failed",
    )
    // a notificação carrega o MOTIVO real, não um erro genérico
    const notif = useNotifs.getState().items[0]
    expect(notif.title).toContain("Automação falhou")
    expect(notif.subtitle).toContain("sem login")
    // o calendário AVANÇOU (disparo agendado): sem retry em loop
    expect(setScheduleNextRun).toHaveBeenCalledWith("s1", expect.any(Number))
  })

  it("CLI ausente também bloqueia antes do spawn", async () => {
    stubChat()
    armDetected({
      codex: probe({ installed: false, version: null, auth: "missing" }),
    })

    await dispatchSchedule(schedule({ id: "s2" }))

    expect(runAgent).not.toHaveBeenCalled()
    expect(useNotifs.getState().items[0].subtitle).toContain(
      "não está instalado",
    )
  })

  it("auth ok (ou incerta) segue pro spawn normal", async () => {
    stubChat()
    armDetected({ codex: probe() })
    await dispatchSchedule(schedule({ id: "s3" }))
    expect(runAgent).toHaveBeenCalledTimes(1)

    vi.mocked(runAgent).mockClear()
    armDetected({ codex: probe({ auth: "unknown" }) })
    await dispatchSchedule(schedule({ id: "s4" }))
    expect(runAgent).toHaveBeenCalledTimes(1)
  })
})
