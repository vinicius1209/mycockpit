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
    // TAREFA 3: o dispatch deixa a intenção do card como RASCUNHO do composer.
    setDraft: vi.fn(),
    // sentinela anti auto-send: o dispatch NUNCA dispara turno sozinho.
    send: vi.fn(),
  },
  app: {
    // projetos VIVOS do app: a guarda de projeto arquivado do dispatch (B1)
    // consulta esta lista — cards de projeto fora dela não despacham.
    projects: [{ id: "p1", name: "alpha", path: "/proj/alpha", createdAt: 1 }],
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
  updateCard: vi.fn(async () => {}),
  setCardArchived: vi.fn(async () => {}),
  deleteCard: vi.fn(async () => {}),
}))
vi.mock("@/store/chat", () => ({ useChat: { getState: () => h.chat } }))
vi.mock("@/store/app", () => ({ useApp: { getState: () => h.app } }))

import {
  closeCard as dbCloseCard,
  deleteCard as dbDeleteCard,
  linkCardConversation as dbLinkCardConversation,
  setCardArchived as dbSetCardArchived,
  setCardAssignee as dbSetCardAssignee,
  setCardState as dbSetCardState,
  updateCard as dbUpdateCard,
  type CardRecord,
  type CardState,
} from "@/lib/db"
import { openCardConversation, useCards, type CardRow } from "@/store/cards"

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
    archivedAt: null,
    ...over,
  }
}

/** Semeia o store com os cards dados (byProject coerente via load fake). */
function seedStore(cards: CardRow[]): void {
  const byProject: Record<string, CardRow[]> = {}
  for (const c of cards) (byProject[c.projectId] ??= []).push(c)
  useCards.setState({ all: cards, byProject })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.chat.activeId = null
  useCards.setState({
    all: [],
    archived: [],
    byProject: {},
    loaded: false,
    selectedId: null,
  })
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
    expect(vi.mocked(dbSetCardState)).toHaveBeenCalledWith(
      "c1",
      "review",
      expect.any(Number),
    )
    expect(useCards.getState().all[0].state).toBe("review")
  })

  it("move carimba o MESMO relógio no banco e no store (F1: sem drift de ms)", async () => {
    seedStore([card({ state: "working" })])
    await useCards.getState().move("c1", "review")
    const nowNoBanco = vi.mocked(dbSetCardState).mock.calls[0][2]
    expect(useCards.getState().all[0].updatedAt).toBe(nowNoBanco)
  })

  it("mutação real limpa o stalledSince transient (F3: badge não mente)", async () => {
    seedStore([{ ...card({ state: "working" }), stalledSince: 123 }])
    await useCards.getState().move("c1", "review")
    expect(useCards.getState().all[0].stalledSince).toBeUndefined()
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

  it("update persiste título/body e carimba banco e store com o MESMO relógio", async () => {
    seedStore([card({ title: "antes", body: "corpo antigo" })])
    await useCards.getState().update("c1", { title: "depois", body: "corpo novo" })
    expect(vi.mocked(dbUpdateCard)).toHaveBeenCalledWith(
      "c1",
      { title: "depois", body: "corpo novo" },
      expect.any(Number),
    )
    const nowNoBanco = vi.mocked(dbUpdateCard).mock.calls[0][2]
    const c = useCards.getState().all[0]
    expect(c.title).toBe("depois")
    expect(c.body).toBe("corpo novo")
    expect(c.updatedAt).toBe(nowNoBanco)
  })

  it("update REJEITA título vazio sem tocar no banco (o toast vem do caller)", async () => {
    seedStore([card({ title: "antes" })])
    for (const vazio of ["", "   "]) {
      await expect(
        useCards.getState().update("c1", { title: vazio }),
      ).rejects.toThrow(/precisa de um título/)
    }
    expect(vi.mocked(dbUpdateCard)).not.toHaveBeenCalled()
    expect(useCards.getState().all[0].title).toBe("antes")
  })

  it("update só de body mantém o título e apara o título quando enviado", async () => {
    seedStore([card({ title: "antes", body: null })])
    await useCards.getState().update("c1", { body: "só contexto" })
    expect(vi.mocked(dbUpdateCard)).toHaveBeenCalledWith(
      "c1",
      { body: "só contexto" },
      expect.any(Number),
    )
    expect(useCards.getState().all[0].title).toBe("antes")
    // título com espaços nas pontas entra aparado
    await useCards.getState().update("c1", { title: "  novo  " })
    expect(useCards.getState().all[0].title).toBe("novo")
  })

  it("closeCard fecha review → done pelo gate humano", async () => {
    seedStore([card({ state: "review" })])
    await useCards.getState().closeCard("c1", "done")
    expect(vi.mocked(dbCloseCard)).toHaveBeenCalledWith(
      "c1",
      "done",
      expect.any(Number),
    )
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
      expect.any(Number),
    )
    expect(vi.mocked(dbSetCardState)).toHaveBeenCalledWith(
      "c1",
      "working",
      expect.any(Number),
    )
    // F1: a mutação inteira (link + state + patch local) usa UM relógio só
    const nowNoBanco = vi.mocked(dbSetCardState).mock.calls[0][2]
    expect(vi.mocked(dbLinkCardConversation).mock.calls[0][2]).toBe(nowNoBanco)
    const c = useCards.getState().all[0]
    expect(c.state).toBe("working")
    expect(c.conversationId).toBe("conv-nova")
    expect(c.updatedAt).toBe(nowNoBanco)
  })

  it("dispatch deixa a intenção (título+body) como RASCUNHO do composer, sem auto-send", async () => {
    seedStore([
      card({ state: "backlog", title: "Refatorar login", body: "Critérios:\n- MFA" }),
    ])
    await useCards.getState().dispatch("c1")
    // formato natural de pedido: título na 1ª linha, body após linha em branco
    expect(h.chat.setDraft).toHaveBeenCalledWith(
      "conv-nova",
      "Refatorar login\n\nCritérios:\n- MFA",
    )
    // rascunho, nunca turno: o envio é gesto humano (revisão no composer)
    expect(h.chat.send).not.toHaveBeenCalled()
  })

  it("dispatch de card sem body rascunha só o título", async () => {
    seedStore([card({ state: "backlog", title: "Só a intenção", body: null })])
    await useCards.getState().dispatch("c1")
    expect(h.chat.setDraft).toHaveBeenCalledWith("conv-nova", "Só a intenção")
    expect(h.chat.send).not.toHaveBeenCalled()
  })

  it("lança fora do backlog (nunca sequestra thread nem redespacha)", async () => {
    seedStore([card({ state: "working", conversationId: "conv-x" })])
    await expect(useCards.getState().dispatch("c1")).rejects.toThrow(
      /backlog/,
    )
    expect(h.chat.newConversation).not.toHaveBeenCalled()
  })

  it("LANÇA em projeto arquivado, no STORE (B1: remoto e desktop herdam a guarda)", async () => {
    seedStore([card({ state: "backlog", projectId: "p-arquivado" })])
    await expect(useCards.getState().dispatch("c1")).rejects.toThrow(
      /Projeto arquivado/,
    )
    // nada roda: nem conversa nova nem estado no banco
    expect(h.chat.newConversation).not.toHaveBeenCalled()
    expect(vi.mocked(dbSetCardState)).not.toHaveBeenCalled()
    expect(useCards.getState().all[0].state).toBe("backlog")
    // a guarda in-flight soltou: com o projeto restaurado, o card despacha
    h.app.projects.push({ id: "p-arquivado", name: "volta", path: "/v", createdAt: 2 })
    try {
      await expect(useCards.getState().dispatch("c1")).resolves.toBe("conv-nova")
    } finally {
      h.app.projects.pop()
    }
  })

  it("LANÇA em card inexistente (D1: estado stale recebe motivo, não silêncio)", async () => {
    seedStore([card({ state: "backlog" })])
    await expect(useCards.getState().dispatch("c-fantasma")).rejects.toThrow(
      /Card não encontrado no board/,
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
    expect(vi.mocked(dbSetCardAssignee)).toHaveBeenCalledWith(
      "c1",
      "codex",
      expect.any(Number),
    )
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

describe("cards (E1): arquivar / restaurar / apagar", () => {
  it("archive tira de `all` e põe em `archived` (topo, com archivedAt)", async () => {
    seedStore([card({ id: "c1", state: "working" })])
    await useCards.getState().archive("c1")
    const s = useCards.getState()
    expect(s.all).toHaveLength(0)
    expect(s.byProject.p1 ?? []).toHaveLength(0) // sai também do byProject
    expect(s.archived).toHaveLength(1)
    expect(s.archived[0].id).toBe("c1")
    expect(s.archived[0].archivedAt).not.toBeNull()
    expect(dbSetCardArchived).toHaveBeenCalledTimes(1)
  })

  it("restore volta de `archived` pra `all` no mesmo estado", async () => {
    useCards.setState({
      archived: [card({ id: "c1", state: "review", archivedAt: 99 })],
    })
    await useCards.getState().restore("c1")
    const s = useCards.getState()
    expect(s.archived).toHaveLength(0)
    expect(s.all).toHaveLength(1)
    expect(s.all[0].state).toBe("review")
    expect(s.all[0].archivedAt).toBeNull()
    expect(dbSetCardArchived).toHaveBeenCalledWith("c1", null, expect.any(Number))
  })

  it("remove apaga de vez das duas listas e limpa a seleção", async () => {
    seedStore([card({ id: "c1" })])
    useCards.setState({ selectedId: "c1" })
    await useCards.getState().remove("c1")
    const s = useCards.getState()
    expect(s.all).toHaveLength(0)
    expect(s.archived).toHaveLength(0)
    expect(s.selectedId).toBeNull()
    expect(dbDeleteCard).toHaveBeenCalledWith("c1")
  })

  it("card arquivado NÃO aparece no board (all) após load particionar", async () => {
    // simula o load particionando: um ativo em all, um arquivado em archived.
    useCards.setState({
      all: [card({ id: "ativo" })],
      archived: [card({ id: "velho", archivedAt: 5 })],
    })
    const s = useCards.getState()
    expect(s.all.map((c) => c.id)).toEqual(["ativo"])
    expect(s.archived.map((c) => c.id)).toEqual(["velho"])
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
