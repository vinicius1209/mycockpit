// E1 (S1.6) — mapeamento card → Decision: só review/blocked entram na fila
// "Precisam de você"; a saída é derivação pura (mudou de estado, some).

import { describe, expect, it } from "vitest"
import type { CardRecord } from "@/lib/db"
import { cardDecisions } from "@/lib/inbox"
import type { Project } from "@/lib/types"

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

function project(id: string, name: string): Project {
  return {
    id,
    name,
    path: `/tmp/${id}`,
    createdAt: 1,
    hasClaudeMd: false,
    hasAgentsMd: false,
    status: "idle",
  }
}

const projects = [project("p1", "meu-projeto")]

describe("cardDecisions (E1)", () => {
  it("review e blocked entram na fila; o resto fica fora", () => {
    const out = cardDecisions(
      [
        card({ id: "a", state: "backlog" }),
        card({ id: "b", state: "working" }),
        card({ id: "c", state: "review" }),
        card({ id: "d", state: "blocked" }),
        card({ id: "e", state: "done" }),
        card({ id: "f", state: "cancelled" }),
      ],
      projects,
    )
    expect(out.map((d) => (d.kind === "card" ? d.cardId : ""))).toEqual([
      "c",
      "d",
    ])
  })

  it("mapeia os campos do Decision (kind card)", () => {
    const [d] = cardDecisions(
      [card({ id: "c9", state: "review", title: "Revisar o parser" })],
      projects,
    )
    expect(d).toEqual({
      kind: "card",
      cardId: "c9",
      projectId: "p1",
      projectName: "meu-projeto",
      title: "Revisar o parser",
      state: "review",
    })
  })

  it("card de projeto desconhecido (arquivado) fica fora, como as disputas", () => {
    const out = cardDecisions(
      [card({ projectId: "p-arquivado", state: "blocked" })],
      projects,
    )
    expect(out).toEqual([])
  })

  it("propaga o stalledSince do vigia (S2.3) pro destaque da fila", () => {
    const [d] = cardDecisions(
      [{ ...card({ id: "c9", state: "blocked" }), stalledSince: 123 }],
      projects,
    )
    expect(d.kind === "card" && d.stalledSince).toBe(123)
    // sem marca do vigia, o campo fica ausente (card na fila, mas não mudo)
    const [semMarca] = cardDecisions([card({ state: "review" })], projects)
    expect(semMarca.kind === "card" && semMarca.stalledSince).toBeUndefined()
  })

  it("o card SAI da fila quando muda de estado (derivação pura)", () => {
    const emReview = [card({ state: "review" })]
    expect(cardDecisions(emReview, projects)).toHaveLength(1)
    const retomado = [card({ state: "working" })]
    expect(cardDecisions(retomado, projects)).toHaveLength(0)
  })
})
