// Automação LEGADA do tipo "lead" (ADR-078): o tipo saiu, mas a linha salva
// no banco de quem já criou uma continua lá.
//
// O que este arquivo protege é o desfecho PERIGOSO. Uma automação de lead não
// fazia nada (lia cards de um board que não tem mais como criar card) e
// reportava OK. O jeito preguiçoso de removê-la seria tratar `kind` antigo
// como "agent" — e aí uma automação que não fazia NADA passaria a DESPACHAR um
// agent de código, com prompt vazio, no horário, sem ninguém pedir.
//
// Regra: ela é desligada uma vez, com a causa escrita, e NUNCA roda agent.

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
    setScheduleEnabled: vi.fn(async () => {}),
    listSchedules: vi.fn(async () => []),
  }
})

import { runAgent } from "@/lib/agent"
import {
  insertScheduleRun,
  markScheduleRun,
  setScheduleEnabled,
  type ScheduleRecord,
} from "@/lib/db"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useNotifs } from "@/store/notifications"
import { dispatchSchedule } from "./scheduleEngine"

function leadLegado(over: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id: "s-lead",
    name: "triagem do lead",
    projectId: "p1",
    kind: "lead",
    agent: "lead",
    model: null,
    effort: null,
    planId: null,
    prompt: "",
    permission: "leitura",
    recurrence: JSON.stringify({ kind: "daily", hour: 8, minute: 0 }),
    enabled: true,
    nextRun: null,
    lastRunAt: null,
    lastRunStatus: null,
    completedAt: null,
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
  useApp.setState({
    projects: [{ id: "p1", name: "alpha", path: "/proj/alpha", createdAt: 1 }],
  })
  useNotifs.setState({ items: [] })
})

describe("dispatchSchedule — automação legada do lead", () => {
  it("NUNCA vira despacho de agent (o desfecho perigoso)", async () => {
    const { registerConversation } = stubChat()

    await dispatchSchedule(leadLegado())

    // As três formas de ela "virar agent": rodar o CLI, criar conversa, ou
    // gastar. Nenhuma pode acontecer.
    expect(runAgent).not.toHaveBeenCalled()
    expect(registerConversation).not.toHaveBeenCalled()
    expect(insertScheduleRun).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleId: "s-lead", convId: null, cost: null }),
    )
  })

  it("é DESLIGADA, e sem horário pendurado", async () => {
    stubChat()

    await dispatchSchedule(leadLegado())

    // next_run null junto: desligar deixando horário futuro daria uma
    // automação que mostra "próxima: amanhã 08:00" e nunca roda.
    expect(setScheduleEnabled).toHaveBeenCalledWith("s-lead", false, null)
  })

  it("o desfecho é FALHA, não sucesso — era o defeito original", async () => {
    stubChat()

    await dispatchSchedule(leadLegado())

    expect(insertScheduleRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    )
    expect(markScheduleRun).toHaveBeenCalledWith(
      "s-lead",
      expect.any(Number),
      "failed",
    )
  })

  it("avisa com a CAUSA, não com um genérico", async () => {
    stubChat()

    await dispatchSchedule(leadLegado())

    const [aviso] = useNotifs.getState().items
    expect(aviso.title).toContain("triagem do lead")
    // A causa tem que estar na frase: sem ela, o usuário fica com uma
    // automação desligada e nenhuma pista do porquê.
    expect(aviso.subtitle).toMatch(/board/i)
    expect(aviso.subtitle).toMatch(/removid/i)
  })

  it("automação normal (agent) segue passando por aqui sem mudança", async () => {
    stubChat()

    await dispatchSchedule(
      leadLegado({ id: "s-agent", kind: "agent", agent: "claude-code", prompt: "oi" }),
    )

    // Nada de desligar nem de falha automática: o caminho normal é outro.
    expect(setScheduleEnabled).not.toHaveBeenCalled()
  })
})
