// E1 (S1.3/S1.4) — store do board: gate de terminais no move, dispatch por
// gesto humano (conversa NOVA + link + working) e carimbo lazy do assignee.
// Banco e stores vizinhos mocados; o que se verifica é a COREOGRAFIA.

import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  chat: {
    // activeId fica null DE PROPÓSITO: o dispatch tem que usar o id RETORNADO
    // por newConversation (D2), nunca inferir via activeId.
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
  createCard: vi.fn(
    async (c: { projectId: string; title: string; body?: string | null }) => ({
      id: "card-novo",
      projectId: c.projectId,
      title: c.title,
      body: c.body ?? null,
      state: "backlog" as const,
      assigneeAgent: null,
      conversationId: null,
      owner: null,
      pinned: false,
      pinRank: null,
      createdAt: 1,
      updatedAt: 1,
    }),
  ),
  setCardState: vi.fn(async () => {}),
  closeCard: vi.fn(async () => {}),
  linkCardConversation: vi.fn(async () => {}),
  setCardAssignee: vi.fn(async () => {}),
}))
vi.mock("@/store/chat", () => ({ useChat: { getState: () => h.chat } }))
vi.mock("@/store/app", () => ({ useApp: { getState: () => h.app } }))

import {
  closeCard as dbCloseCard,
  linkCardConversation as dbLinkCardConversation,
  setCardAssignee as dbSetCardAssignee,
  setCardState as dbSetCardState,
  type CardRecord,
  type CardState,
} from "@/lib/db"
import { openCardConversation, useCards } from "@/store/cards"

function card(over: Partial<CardRecord> = {}): CardRecord {
  return {
    id: "c1",
    projectId: "p1",
    title: "intenção",
    body: null,
    state: "backlog",
    assigneeAgent: null,
    conversationId: null,
    owner: null,
    pinned: false,
    pinRank: null,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

/** Semeia o store com os cards dados (byProject coerente via load fake). */
function seedStore(cards: CardRecord[]): void {
  const byProject: Record<string, CardRecord[]> = {}
  for (const c of cards) (byProject[c.projectId] ??= []).push(c)
  useCards.setState({ all: cards, byProject })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.chat.activeId = null
  useCards.setState({ all: [], byProject: {}, loaded: false, selectedId: null })
})

describe("cards (E1): store", () => {
  it("create adiciona o card no backlog do projeto (byProject agrupa)", async () => {
    await useCards.getState().create("p1", "nova intenção")
    const s = useCards.getState()
    expect(s.all).toHaveLength(1)
    expect(s.all[0].state).toBe("backlog")
    expect(s.byProject.p1).toHaveLength(1)
  })

  it("move aplica transição válida e persiste (working → review)", async () => {
    seedStore([card({ state: "working" })])
    await useCards.getState().move("c1", "review")
    expect(vi.mocked(dbSetCardState)).toHaveBeenCalledWith("c1", "review")
    expect(useCards.getState().all[0].state).toBe("review")
  })

  it("move LANÇA em done/cancelled sem tocar no banco (gate humano)", async () => {
    seedStore([card({ state: "review" })])
    for (const terminal of ["done", "cancelled"] as CardState[]) {
      await expect(useCards.getState().move("c1", terminal)).rejects.toThrow(
        /gesto humano/,
      )
    }
    expect(vi.mocked(dbSetCardState)).not.toHaveBeenCalled()
    expect(useCards.getState().all[0].state).toBe("review")
  })

  it("move lança em transição inválida (backlog → review)", async () => {
    seedStore([card({ state: "backlog" })])
    await expect(useCards.getState().move("c1", "review")).rejects.toThrow(
      /transição de card inválida/,
    )
    expect(vi.mocked(dbSetCardState)).not.toHaveBeenCalled()
  })

  it("closeCard fecha review → done pelo gate humano", async () => {
    seedStore([card({ state: "review" })])
    await useCards.getState().closeCard("c1", "done")
    expect(vi.mocked(dbCloseCard)).toHaveBeenCalledWith("c1", "done")
    expect(useCards.getState().all[0].state).toBe("done")
  })
})

describe("cards (E1): dispatch por gesto humano", () => {
  it("cria conversa NOVA, grava conversation_id e o card vira working", async () => {
    seedStore([card({ state: "backlog" })])
    const convId = await useCards.getState().dispatch("c1")
    expect(convId).toBe("conv-nova")
    expect(h.chat.newConversation).toHaveBeenCalledWith("p1")
    expect(vi.mocked(dbLinkCardConversation)).toHaveBeenCalledWith(
      "c1",
      "conv-nova",
    )
    expect(vi.mocked(dbSetCardState)).toHaveBeenCalledWith("c1", "working")
    const c = useCards.getState().all[0]
    expect(c.state).toBe("working")
    expect(c.conversationId).toBe("conv-nova")
  })

  it("lança fora do backlog (nunca sequestra thread nem redespacha)", async () => {
    seedStore([card({ state: "working", conversationId: "conv-x" })])
    await expect(useCards.getState().dispatch("c1")).rejects.toThrow(
      /backlog/,
    )
    expect(h.chat.newConversation).not.toHaveBeenCalled()
  })

  it("duplo-clique não cria duas conversas (guarda in-flight, D2)", async () => {
    seedStore([card({ state: "backlog" })])
    const [a, b] = await Promise.all([
      useCards.getState().dispatch("c1"),
      useCards.getState().dispatch("c1"),
    ])
    expect(h.chat.newConversation).toHaveBeenCalledTimes(1)
    expect([a, b].filter((x) => x === "conv-nova")).toHaveLength(1)
    expect([a, b].filter((x) => x === null)).toHaveLength(1)
    // a guarda solta ao final: um card devolvido ao backlog pode redespachar
    seedStore([card({ state: "backlog" })])
    await expect(useCards.getState().dispatch("c1")).resolves.toBe("conv-nova")
  })

  it("noteConversationAgent carimba o assignee do card ligado, uma vez", () => {
    seedStore([card({ state: "working", conversationId: "conv-nova" })])
    useCards.getState().noteConversationAgent("conv-nova", "codex")
    expect(useCards.getState().all[0].assigneeAgent).toBe("codex")
    expect(vi.mocked(dbSetCardAssignee)).toHaveBeenCalledWith("c1", "codex")
    // mesmo agent de novo = no-op (não regrava)
    useCards.getState().noteConversationAgent("conv-nova", "codex")
    expect(vi.mocked(dbSetCardAssignee)).toHaveBeenCalledTimes(1)
    // conversa sem card ligado = no-op silencioso
    useCards.getState().noteConversationAgent("conv-sem-card", "claude-code")
    expect(vi.mocked(dbSetCardAssignee)).toHaveBeenCalledTimes(1)
  })

  it("noteConversationAgent ignora card terminal (histórico fechado)", () => {
    seedStore([
      card({ state: "done", conversationId: "conv-9", assigneeAgent: "codex" }),
    ])
    useCards.getState().noteConversationAgent("conv-9", "claude-code")
    expect(useCards.getState().all[0].assigneeAgent).toBe("codex")
    expect(vi.mocked(dbSetCardAssignee)).not.toHaveBeenCalled()
  })
})

describe("cards (E1): abrir da fila (S1.6)", () => {
  it("com conversa ligada navega até ela (padrão openStalledConv)", async () => {
    seedStore([card({ state: "review", conversationId: "conv-9" })])
    await openCardConversation("c1")
    expect(h.app.setActiveProject).toHaveBeenCalledWith("p1")
    expect(h.chat.openProject).toHaveBeenCalledWith("p1")
    expect(h.chat.switchConversation).toHaveBeenCalledWith("conv-9")
    expect(h.app.setViewMode).toHaveBeenCalledWith("linear")
  })

  it("sem conversa seleciona o card no board do Painel", async () => {
    seedStore([card({ state: "blocked", conversationId: null })])
    await openCardConversation("c1")
    expect(useCards.getState().selectedId).toBe("c1")
    expect(h.app.setViewMode).toHaveBeenCalledWith("painel")
    expect(h.chat.switchConversation).not.toHaveBeenCalled()
  })
})
