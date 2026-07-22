// S4.3 — schedule do LEAD no dispatchSchedule: chama proposePlan em vez de
// runAgent. Sem conversa criada, sem preflight de CLI (o lead não roda agent
// de código) e com o desfecho gravado em schedule_runs (ok/failed).

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, runAgent: vi.fn(async () => {}) }
})
vi.mock("@/lib/lead", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/lead")>()
  return { ...mod, proposePlan: vi.fn(async () => "prop-1") }
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
import {
  insertScheduleRun,
  markScheduleRun,
  setScheduleNextRun,
  type ScheduleRecord,
} from "@/lib/db"
import { proposePlan } from "@/lib/lead"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useNotifs } from "@/store/notifications"
import { dispatchSchedule } from "./scheduleEngine"

function leadSchedule(over: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id: "s-lead",
    name: "triagem do lead",
    projectId: "p1",
    kind: "lead",
    agent: "lead",
    model: null,
    prompt: "",
    permission: "leitura",
    recurrence: JSON.stringify({ kind: "daily", hour: 8, minute: 0 }),
    enabled: true,
    nextRun: null,
    lastRunAt: null,
    lastRunStatus: null,
    createdAt: 0,
    ...over,
  }
}

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

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(proposePlan).mockResolvedValue("prop-1")
  useApp.setState({
    projects: [{ id: "p1", name: "alpha", path: "/proj/alpha", createdAt: 1 }],
  })
  useNotifs.setState({ items: [] })
})

describe("dispatchSchedule — kind lead (S4.3)", () => {
  it("chama proposePlan e NÃO cria conversa nem roda agent", async () => {
    const { registerConversation } = stubChat()

    await dispatchSchedule(leadSchedule())

    expect(proposePlan).toHaveBeenCalledWith("p1")
    expect(runAgent).not.toHaveBeenCalled()
    expect(registerConversation).not.toHaveBeenCalled()
    // desfecho no histórico, sem conversa e sem custo próprio
    expect(insertScheduleRun).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: "s-lead",
        status: "ok",
        convId: null,
        cost: null,
      }),
    )
    expect(markScheduleRun).toHaveBeenCalledWith(
      "s-lead",
      expect.any(Number),
      "ok",
    )
    // disparo agendado avança o next_run normalmente
    expect(setScheduleNextRun).toHaveBeenCalledWith(
      "s-lead",
      expect.any(Number),
    )
    // sucesso não polui o sino
    expect(useNotifs.getState().items).toHaveLength(0)
  })

  it("ignora o preflight de CLI: sem nenhuma CLI detectada o lead roda mesmo assim", async () => {
    stubChat()
    const settings = useApp.getState().settings
    useApp.setState({ settings: { ...settings, detected: {} } })

    await dispatchSchedule(leadSchedule({ id: "s2" }))

    expect(proposePlan).toHaveBeenCalledTimes(1)
    expect(vi.mocked(insertScheduleRun).mock.calls[0][0].status).toBe("ok")
  })

  it("board vazio (proposePlan null) ainda é execução ok: rodou, não havia o que propor", async () => {
    stubChat()
    vi.mocked(proposePlan).mockResolvedValueOnce(null)
    await dispatchSchedule(leadSchedule({ id: "s3" }))
    expect(markScheduleRun).toHaveBeenCalledWith("s3", expect.any(Number), "ok")
  })

  it("proposePlan falhou: run failed + a causa REAL no sino (D2, não um genérico)", async () => {
    stubChat()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(proposePlan).mockRejectedValueOnce(
      new Error("claude não está instalado"),
    )

    await dispatchSchedule(leadSchedule({ id: "s4" }))

    expect(insertScheduleRun).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleId: "s4", status: "failed" }),
    )
    expect(markScheduleRun).toHaveBeenCalledWith(
      "s4",
      expect.any(Number),
      "failed",
    )
    const notif = useNotifs.getState().items[0]
    expect(notif.title).toContain("Automação falhou")
    // a mensagem do erro real (helper off, claude ausente/deslogado...) sobe
    // intacta — mesmo padrão do toast do BoardLane no caminho manual
    expect(notif.subtitle).toBe("claude não está instalado")
    warn.mockRestore()
  })

  it("erro sem mensagem: o sino cai no fallback genérico (nunca subtitle vazio)", async () => {
    stubChat()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(proposePlan).mockRejectedValueOnce(new Error("  "))

    await dispatchSchedule(leadSchedule({ id: "s5" }))

    expect(useNotifs.getState().items[0].subtitle).toBe(
      "O lead não conseguiu escrever a proposta.",
    )
    warn.mockRestore()
  })
})
