// O ÚLTIMO METRO: o que o usuário escolheu no dialog chega mesmo no spawn?
//
// A pergunta que este arquivo faz é a que faltou em 27/07 e custou uma
// automação inteira: "o valor chega no processo?". Permissão e esforço são
// argumentos POSICIONAIS do runAgent — um deles ficar em `null` não quebra
// compilador nenhum, não quebra teste nenhum, e só aparece no sandbox às 7h da
// manhã, com o Codex negando o shell.
//
// Também cobre o segundo buraco do mesmo episódio: a falha chegava ao
// histórico e ao sino SEM motivo ("falhou", e abra a conversa pra descobrir).

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, runAgent: vi.fn(async () => {}) }
})
vi.mock("@/lib/doctrine", async (orig) => ({
  ...(await orig<typeof import("@/lib/doctrine")>()),
  readDoctrine: vi.fn(async () => ({ exists: false, content: "", bytes: 0 })),
}))
vi.mock("@/lib/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/db")>()
  return {
    ...mod,
    isTauri: () => true,
    insertScheduleRun: vi.fn(async () => {}),
    markScheduleRun: vi.fn(async () => {}),
    setScheduleNextRun: vi.fn(async () => {}),
    markScheduleCompleted: vi.fn(async () => {}),
    listSchedules: vi.fn(async () => []),
  }
})

import { runAgent } from "@/lib/agent"
import { insertScheduleRun, type ScheduleRecord } from "@/lib/db"
import type { AgentProbe } from "@/lib/detect"
import { useApp } from "@/store/app"
import { useChat, type ChatItem } from "@/store/chat"
import { useNotifs } from "@/store/notifications"
import { dispatchSchedule } from "./scheduleEngine"

/** Posições do runAgent que este arquivo vigia (lib/agent.runAgent). */
const ARG = { model: 3, effort: 4, prompt: 5, permission: 8 } as const

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
    model: "gpt-5.6-codex",
    effort: "xhigh",
    planId: null,
    prompt: "faz a varredura",
    permission: "auto",
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

/** O chat stubado, com os items que o turno "deixou" (o desfecho é lido daí).
 *  O convId é sorteado pelo motor, então a conversa nasce no `byId` pela mesma
 *  porta que o app usa: o registerConversation. */
function stubChat(items: ChatItem[] = []) {
  useChat.setState({
    byId: {},
    registerConversation: vi.fn(async (_p: string, id: string) => {
      useChat.setState((s) => ({
        byId: { ...s.byId, [id]: { items } as never },
      }))
    }),
    start: vi.fn(),
    handleEvent: vi.fn(),
    finish: vi.fn(),
    persist: vi.fn(async () => {}),
  })
}

const chamada = () => vi.mocked(runAgent).mock.calls[0]
const linha = () =>
  vi.mocked(insertScheduleRun).mock.calls[0][0] as {
    status: string
    error: string | null
  }

beforeEach(() => {
  vi.clearAllMocks()
  stubChat()
  useApp.setState({
    projects: [{ id: "p1", name: "alpha", path: "/proj/alpha", createdAt: 1 }],
    settings: {
      ...useApp.getState().settings,
      detected: { codex: probe() } as Record<string, AgentProbe>,
    },
  })
  useNotifs.setState({ items: [] })
})

describe("dispatchSchedule — a escolha chega ao spawn", () => {
  it("permissão 'auto' viaja até o runAgent (era rebaixada pra leitura no caminho)", async () => {
    await dispatchSchedule(schedule({ permission: "auto" }))
    expect(chamada()[ARG.permission]).toBe("auto")
  })

  it("'padrao' e 'leitura' seguem chegando como estão", async () => {
    await dispatchSchedule(schedule({ permission: "padrao" }))
    expect(chamada()[ARG.permission]).toBe("padrao")
    vi.clearAllMocks()
    await dispatchSchedule(schedule({ permission: "leitura" }))
    expect(chamada()[ARG.permission]).toBe("leitura")
  })

  it("'liberado' gravado à mão no SQLite continua barrado no disparo", async () => {
    await dispatchSchedule(schedule({ permission: "liberado" as never }))
    expect(chamada()[ARG.permission]).toBe("leitura")
  })

  it("o esforço escolhido vira o argumento de effort do runAgent", async () => {
    await dispatchSchedule(schedule({ effort: "xhigh" }))
    expect(chamada()[ARG.effort]).toBe("xhigh")
  })

  it("effort ausente ou 'default' não manda flag nenhuma (null)", async () => {
    await dispatchSchedule(schedule({ effort: null }))
    expect(chamada()[ARG.effort]).toBeNull()
    vi.clearAllMocks()
    await dispatchSchedule(schedule({ effort: "default" }))
    expect(chamada()[ARG.effort]).toBeNull()
  })

  it("o modelo persistido é normalizado antes do spawn (id que saiu do CLI)", async () => {
    await dispatchSchedule(schedule({ model: "default" }))
    expect(chamada()[ARG.model]).toBeNull()
  })
})

describe("dispatchSchedule — a falha diz POR QUÊ", () => {
  it("erro no fio vira o motivo da linha de histórico e do sino", async () => {
    stubChat([
      {
        kind: "error",
        id: "e1",
        message: "sandbox_apply: Operation not permitted",
      },
    ])

    await dispatchSchedule(schedule())

    expect(linha().status).toBe("failed")
    expect(linha().error).toBe("sandbox_apply: Operation not permitted")
    expect(useNotifs.getState().items[0].subtitle).toBe(
      "sandbox_apply: Operation not permitted",
    )
  })

  it("result com ok=false usa o texto do próprio result", async () => {
    stubChat([
      {
        kind: "result",
        id: "r1",
        ok: false,
        text: "não consegui ler o JSON:\n  fora do diretório do run",
        costUsd: 0.12,
      },
    ])

    await dispatchSchedule(schedule())

    expect(linha().error).toBe(
      "não consegui ler o JSON: fora do diretório do run",
    )
  })

  it("turno que deu certo não inventa motivo nem notifica", async () => {
    stubChat([{ kind: "result", id: "r1", ok: true, costUsd: 0.02 }])

    await dispatchSchedule(schedule())

    expect(linha().status).toBe("ok")
    expect(linha().error).toBeNull()
    expect(useNotifs.getState().items).toHaveLength(0)
  })

  it("falha de SPAWN (o invoke lança) entra com a mensagem do invoke", async () => {
    vi.mocked(runAgent).mockRejectedValueOnce(
      new Error("codex: command not found"),
    )

    await dispatchSchedule(schedule())

    expect(linha().status).toBe("failed")
    expect(linha().error).toBe("codex: command not found")
  })
})
