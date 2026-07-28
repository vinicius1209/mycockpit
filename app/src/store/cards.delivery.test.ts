// S4.1 — hook card→delivery no closeCard: fechar como done um card COM
// conversa ligada grava a entrega (2º produtor do recall M1), best-effort.
// Regras verificadas: cancelled não grava; done sem conversa não grava; falha
// do insert não quebra o closeCard.

import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  chat: {
    activeId: null as string | null,
    newConversation: vi.fn(async (_projectId: string) => "conv-nova"),
    openProject: vi.fn(async () => {}),
    switchConversation: vi.fn(async () => {}),
  },
  app: {
    setActiveProject: vi.fn(),
    setViewMode: vi.fn(),
  },
}))

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  isTauri: () => false, // não dispara a hidratação de boot no import
  listCards: vi.fn(async () => []),
  closeCard: vi.fn(async () => {}),
  insertDelivery: vi.fn(async () => {}),
  listCardCosts: vi.fn(async () => ({})),
}))
vi.mock("@/store/chat", () => ({
  useChat: { getState: () => h.chat },
  hasExecutorTurn: (items: { kind: string }[]) => items.some((it) => it.kind !== "advice"),
  executorItems: (items: { kind: string }[]) => items.filter((it) => it.kind !== "advice"),
}))
vi.mock("@/store/app", () => ({ useApp: { getState: () => h.app } }))

import {
  closeCard as dbCloseCard,
  insertDelivery,
  listCardCosts,
  type CardRecord,
} from "@/lib/db"
import { useCards, type CardRow } from "@/store/cards"

function card(over: Partial<CardRecord> = {}): CardRecord {
  return {
    id: "c1",
    projectId: "p1",
    title: "corrigir o parser",
    body: null,
    state: "review",
    assigneeAgent: null,
    conversationId: null,
    owner: null,
    pinned: false,
    pinRank: null,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...over,
  }
}

function seedStore(cards: CardRow[]): void {
  const byProject: Record<string, CardRow[]> = {}
  for (const c of cards) (byProject[c.projectId] ??= []).push(c)
  useCards.setState({ all: cards, byProject })
}

beforeEach(() => {
  vi.clearAllMocks()
  useCards.setState({ all: [], byProject: {}, loaded: false, selectedId: null })
})

describe("closeCard → delivery (S4.1)", () => {
  it("done COM conversa grava a entrega com custo, título e 1ª linha do body", async () => {
    vi.mocked(listCardCosts).mockResolvedValueOnce({
      "conv-9": { total: 1.25, estimated: false },
    })
    seedStore([
      card({
        conversationId: "conv-9",
        assigneeAgent: "codex",
        body: "  \nrefatorar o parser de eventos\nsegunda linha ignorada",
      }),
    ])

    await useCards.getState().closeCard("c1", "done")

    expect(vi.mocked(listCardCosts)).toHaveBeenCalledWith(["conv-9"])
    expect(vi.mocked(insertDelivery)).toHaveBeenCalledWith({
      projectId: "p1",
      task: "corrigir o parser",
      planSummary: "refatorar o parser de eventos",
      // v1 honesto: conversa linear não tem diff de worktree rastreado.
      filesTouched: [],
      costUsd: 1.25,
      agent: "codex",
      model: null,
    })
    expect(useCards.getState().all[0].state).toBe("done")
  })

  it("assignee nunca resolvido grava agent \"\" (honesto, sem chutar claude-code)", async () => {
    seedStore([card({ conversationId: "conv-9", assigneeAgent: null })])
    await useCards.getState().closeCard("c1", "done")
    expect(vi.mocked(insertDelivery)).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "" }),
    )
  })

  it("cancelled NÃO grava entrega (intenção abortada não é entrega)", async () => {
    seedStore([card({ state: "backlog", conversationId: "conv-9" })])
    await useCards.getState().closeCard("c1", "cancelled")
    expect(vi.mocked(insertDelivery)).not.toHaveBeenCalled()
    expect(vi.mocked(listCardCosts)).not.toHaveBeenCalled()
  })

  it("done SEM conversa NÃO grava (sem conversa não há evidência de execução)", async () => {
    seedStore([card({ conversationId: null })])
    await useCards.getState().closeCard("c1", "done")
    expect(vi.mocked(insertDelivery)).not.toHaveBeenCalled()
  })

  it("falha do insert não quebra o closeCard (best-effort + warn)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(insertDelivery).mockRejectedValueOnce(new Error("disco cheio"))
    seedStore([card({ conversationId: "conv-9" })])

    await expect(
      useCards.getState().closeCard("c1", "done"),
    ).resolves.toBeUndefined()

    expect(useCards.getState().all[0].state).toBe("done")
    expect(vi.mocked(dbCloseCard)).toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("falha SÓ no custo degrada pra costUsd null sem perder a entrega", async () => {
    vi.mocked(listCardCosts).mockRejectedValueOnce(new Error("db travado"))
    seedStore([card({ conversationId: "conv-9" })])
    await useCards.getState().closeCard("c1", "done")
    expect(vi.mocked(insertDelivery)).toHaveBeenCalledWith(
      expect.objectContaining({ costUsd: null }),
    )
  })

  it("conversa sem linha em turn_costs grava costUsd null (não inventa zero)", async () => {
    vi.mocked(listCardCosts).mockResolvedValueOnce({})
    seedStore([card({ conversationId: "conv-9" })])
    await useCards.getState().closeCard("c1", "done")
    expect(vi.mocked(insertDelivery)).toHaveBeenCalledWith(
      expect.objectContaining({ costUsd: null }),
    )
  })
})
