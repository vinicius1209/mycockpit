// E1 (S1.1/S1.2) — CRUD de cards e máquina de estados, com o Database do
// plugin-sql MOCKADO por um mini-engine em memória: cada statement que o
// db.ts emite tem um handler; SQL não mapeado LANÇA (drift do schema aparece
// no teste, não em produção).

import { beforeEach, describe, expect, it, vi } from "vitest"

interface FakeCardRow {
  id: string
  project_id: string
  title: string
  body: string | null
  state: string
  assignee_agent: string | null
  conversation_id: string | null
  owner: string | null
  pinned: number
  pin_rank: number | null
  created_at: number
  updated_at: number
  archived_at?: number | null
}

const h = vi.hoisted(() => ({
  cards: [] as FakeCardRow[],
  /** Ordem dos statements de escrita (D1: limpeza ANTES do DELETE). */
  log: [] as string[],
}))

vi.mock("@tauri-apps/plugin-sql", () => {
  const fakeDb = {
    execute: async (sql: string, params: unknown[] = []) => {
      if (
        sql.startsWith("CREATE TABLE") ||
        sql.startsWith("CREATE INDEX") ||
        sql.startsWith("ALTER TABLE cards ADD COLUMN")
      ) {
        return { rowsAffected: 0 }
      }
      if (sql.startsWith("UPDATE cards SET archived_at = $1")) {
        const [archivedAt, updatedAt, id] = params as [
          number | null,
          number,
          string,
        ]
        for (const c of h.cards) {
          if (c.id === id) {
            c.archived_at = archivedAt
            c.updated_at = updatedAt
          }
        }
        return { rowsAffected: 1 }
      }
      if (sql.startsWith("DELETE FROM cards WHERE id")) {
        const [id] = params as [string]
        const i = h.cards.findIndex((c) => c.id === id)
        if (i >= 0) h.cards.splice(i, 1)
        return { rowsAffected: i >= 0 ? 1 : 0 }
      }
      if (sql.startsWith("INSERT INTO cards")) {
        const [
          id,
          project_id,
          title,
          body,
          state,
          assignee_agent,
          conversation_id,
          owner,
          pinned,
          pin_rank,
          created_at,
          updated_at,
        ] = params as [
          string,
          string,
          string,
          string | null,
          string,
          string | null,
          string | null,
          string | null,
          number,
          number | null,
          number,
          number,
        ]
        h.cards.push({
          id,
          project_id,
          title,
          body,
          state,
          assignee_agent,
          conversation_id,
          owner,
          pinned,
          pin_rank,
          created_at,
          updated_at,
        })
        return { rowsAffected: 1 }
      }
      if (sql.startsWith("UPDATE cards SET title = COALESCE")) {
        const [title, body, pinned, pinRank, updatedAt, id] = params as [
          string | null,
          string | null,
          number | null,
          number | null,
          number,
          string,
        ]
        for (const c of h.cards) {
          if (c.id !== id) continue
          c.title = title ?? c.title
          c.body = body ?? c.body
          c.pinned = pinned ?? c.pinned
          c.pin_rank = pinRank ?? c.pin_rank
          c.updated_at = updatedAt
        }
        return { rowsAffected: 1 }
      }
      if (
        sql.startsWith("UPDATE cards SET state = $1, updated_at = $2 WHERE id")
      ) {
        const [state, updatedAt, id] = params as [string, number, string]
        for (const c of h.cards) {
          if (c.id === id) {
            c.state = state
            c.updated_at = updatedAt
          }
        }
        return { rowsAffected: 1 }
      }
      if (
        sql.startsWith(
          "UPDATE cards SET conversation_id = $1, updated_at = $2 WHERE id",
        )
      ) {
        const [convId, updatedAt, id] = params as [string, number, string]
        for (const c of h.cards) {
          if (c.id === id) {
            c.conversation_id = convId
            c.updated_at = updatedAt
          }
        }
        return { rowsAffected: 1 }
      }
      if (sql.startsWith("UPDATE cards SET assignee_agent = $1")) {
        const [agent, updatedAt, id] = params as [string, number, string]
        for (const c of h.cards) {
          if (c.id === id) {
            c.assignee_agent = agent
            c.updated_at = updatedAt
          }
        }
        return { rowsAffected: 1 }
      }
      if (sql.startsWith("UPDATE cards SET state = 'backlog'")) {
        h.log.push("cards-backlog")
        const [updatedAt, convId] = params as [number, string]
        for (const c of h.cards) {
          if (
            c.conversation_id === convId &&
            c.state !== "done" &&
            c.state !== "cancelled"
          ) {
            c.state = "backlog"
            c.updated_at = updatedAt
          }
        }
        return { rowsAffected: 1 }
      }
      if (sql.startsWith("UPDATE cards SET conversation_id = NULL")) {
        h.log.push("cards-unlink")
        const [updatedAt, convId] = params as [number, string]
        for (const c of h.cards) {
          if (c.conversation_id === convId) {
            c.conversation_id = null
            c.updated_at = updatedAt
          }
        }
        return { rowsAffected: 1 }
      }
      if (sql.startsWith("DELETE FROM conversations")) {
        h.log.push("delete-conv")
        return { rowsAffected: 1 }
      }
      throw new Error(`SQL não mapeado no fake (execute): ${sql}`)
    },
    select: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("SELECT state FROM cards WHERE id")) {
        const [id] = params as [string]
        return h.cards.filter((c) => c.id === id).map((c) => ({ state: c.state }))
      }
      if (sql.includes("FROM cards WHERE project_id")) {
        const [pid] = params as [string]
        return h.cards
          .filter((c) => c.project_id === pid)
          .sort((a, b) => a.created_at - b.created_at)
          .map((c) => ({ ...c }))
      }
      if (sql.includes("FROM cards ORDER BY")) {
        return [...h.cards]
          .sort((a, b) => a.created_at - b.created_at)
          .map((c) => ({ ...c }))
      }
      throw new Error(`SQL não mapeado no fake (select): ${sql}`)
    },
  }
  return { default: { load: async () => fakeDb } }
})

// isTauri() exige window.__TAURI_INTERNALS__ (ambiente node não tem window).
;(globalThis as Record<string, unknown>).window = { __TAURI_INTERNALS__: {} }

import {
  assertCardTransition,
  closeCard,
  createCard,
  linkCardConversation,
  listCards,
  setCardState,
  updateCard,
} from "@/lib/db"
import { deleteConversation } from "@/lib/db/conversations"

/** Semeia uma linha direto no fake (pra estados que exigiriam N transições). */
function seed(over: Partial<FakeCardRow> = {}): FakeCardRow {
  const row: FakeCardRow = {
    id: crypto.randomUUID(),
    project_id: "p1",
    title: "card",
    body: null,
    state: "backlog",
    assignee_agent: null,
    conversation_id: null,
    owner: null,
    pinned: 0,
    pin_rank: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...over,
  }
  h.cards.push(row)
  return row
}

beforeEach(() => {
  h.cards.length = 0
  h.log.length = 0
})

describe("cards (E1): CRUD", () => {
  it("createCard grava no backlog e listCards filtra por projeto", async () => {
    const a = await createCard({ projectId: "p1", title: "Refatorar login" })
    await createCard({ projectId: "p2", title: "Outro projeto" })
    expect(a.state).toBe("backlog")
    expect(a.conversationId).toBeNull()
    const doP1 = await listCards("p1")
    expect(doP1).toHaveLength(1)
    expect(doP1[0].title).toBe("Refatorar login")
    const todos = await listCards()
    expect(todos).toHaveLength(2)
  })

  it("updateCard aplica patch parcial sem tocar no resto", async () => {
    const c = await createCard({ projectId: "p1", title: "antes", body: "corpo" })
    await updateCard(c.id, { title: "depois" })
    const [row] = await listCards("p1")
    expect(row.title).toBe("depois")
    expect(row.body).toBe("corpo")
    expect(row.state).toBe("backlog")
  })

  it("linkCardConversation grava o conversation_id", async () => {
    const c = await createCard({ projectId: "p1", title: "ligado" })
    await linkCardConversation(c.id, "conv-1")
    const [row] = await listCards("p1")
    expect(row.conversationId).toBe("conv-1")
  })
})

describe("cards (E1): máquina de estados", () => {
  it("setCardState segue a máquina: backlog → working", async () => {
    const c = await createCard({ projectId: "p1", title: "x" })
    await setCardState(c.id, "working")
    const [row] = await listCards("p1")
    expect(row.state).toBe("working")
  })

  it("setCardState lança em transição inválida (backlog → review)", async () => {
    const c = await createCard({ projectId: "p1", title: "x" })
    await expect(setCardState(c.id, "review")).rejects.toThrow(
      /transição de card inválida/,
    )
  })

  it("setCardState recusa terminais: done/cancelled só via closeCard", async () => {
    const c = seed({ state: "review" })
    await expect(setCardState(c.id, "done")).rejects.toThrow(/gesto humano/)
    await expect(setCardState(c.id, "cancelled")).rejects.toThrow(/gesto humano/)
    expect(h.cards[0].state).toBe("review")
  })

  it("closeCard fecha review → done; de working direto lança", async () => {
    const emReview = seed({ state: "review" })
    await closeCard(emReview.id, "done")
    expect(h.cards[0].state).toBe("done")

    const emVoo = seed({ state: "working" })
    await expect(closeCard(emVoo.id, "done")).rejects.toThrow(
      /transição de card inválida/,
    )
  })

  it("closeCard cancela do backlog (abandonar é direito do humano)", async () => {
    const c = seed({ state: "backlog" })
    await closeCard(c.id, "cancelled")
    expect(h.cards[0].state).toBe("cancelled")
  })

  it("estado terminal não sai mais (done → working lança)", async () => {
    const c = seed({ state: "done" })
    await expect(setCardState(c.id, "working")).rejects.toThrow(
      /transição de card inválida/,
    )
  })

  it("assertCardTransition é a fonte única (helper puro)", () => {
    expect(() => assertCardTransition("backlog", "working")).not.toThrow()
    expect(() => assertCardTransition("working", "review")).not.toThrow()
    expect(() => assertCardTransition("review", "done")).not.toThrow()
    expect(() => assertCardTransition("backlog", "done")).toThrow()
    expect(() => assertCardTransition("done", "working")).toThrow()
  })
})

describe("cards (E1): card órfão de conversa deletada", () => {
  it("deleteConversation devolve o card ligado pro backlog, sem conversation_id", async () => {
    const c = seed({ state: "working", conversation_id: "conv-9" })
    await deleteConversation("conv-9")
    expect(h.cards[0].state).toBe("backlog")
    expect(h.cards[0].conversation_id).toBeNull()
    expect(c.id).toBe(h.cards[0].id) // o card NUNCA morre junto
  })

  it("card terminal preserva o estado, mas perde o link", async () => {
    seed({ state: "done", conversation_id: "conv-9" })
    await deleteConversation("conv-9")
    expect(h.cards[0].state).toBe("done")
    expect(h.cards[0].conversation_id).toBeNull()
  })

  it("card de OUTRA conversa fica intocado", async () => {
    seed({ state: "working", conversation_id: "conv-outra" })
    await deleteConversation("conv-9")
    expect(h.cards[0].state).toBe("working")
    expect(h.cards[0].conversation_id).toBe("conv-outra")
  })

  it("a limpeza dos cards roda ANTES do DELETE da conversa (D1)", async () => {
    seed({ state: "working", conversation_id: "conv-9" })
    await deleteConversation("conv-9")
    expect(h.log).toEqual(["cards-backlog", "cards-unlink", "delete-conv"])
  })
})
