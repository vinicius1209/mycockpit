// A fila que a faixa e o sino leem juntos (ADR-271): a disputa ao vivo entra
// antes de a varredura vê-la, e não duplica quando ela vê.

import { describe, expect, it } from "vitest"
import type { CardRecord } from "@/lib/db"
import { montarFila, type Decision } from "@/lib/inbox"
import type { Project } from "@/lib/types"

const projects: Project[] = [
  {
    id: "p1",
    name: "frota",
    path: "/tmp/p1",
    createdAt: 1,
    hasClaudeMd: false,
    hasAgentsMd: false,
    status: "idle",
  },
]

const card: CardRecord = {
  id: "k1",
  projectId: "p1",
  title: "Migrar o sino",
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
}

const base = {
  varridas: [] as Decision[],
  decidindo: [] as string[],
  projects,
  cards: [] as CardRecord[],
  projetoDe: (convId: string) => (convId.startsWith("c") ? "p1" : undefined),
  promptDe: () => "Qual abordagem?",
}

describe("montarFila", () => {
  it("a disputa que acabou de nascer entra sem esperar a varredura", () => {
    const fila = montarFila({ ...base, decidindo: ["c1"] })
    expect(fila).toEqual([
      { kind: "fusion", convId: "c1", projectId: "p1", projectName: "frota", title: "Qual abordagem?" },
    ])
  })

  it("quando a varredura já tem a disputa, ela não aparece duas vezes", () => {
    const varrida: Decision = {
      kind: "fusion",
      convId: "c1",
      projectId: "p1",
      projectName: "frota",
      title: "Qual abordagem?",
      createdAt: 5,
    }
    const fila = montarFila({ ...base, varridas: [varrida], decidindo: ["c1"] })
    expect(fila).toEqual([varrida])
  })

  it("disputa de conversa sem projeto conhecido fica de fora", () => {
    expect(montarFila({ ...base, decidindo: ["x9"] })).toEqual([])
  })

  it("disputa vem antes do card, mesmo chegando depois", () => {
    const fila = montarFila({ ...base, decidindo: ["c1"], cards: [card] })
    expect(fila.map((d) => d.kind)).toEqual(["fusion", "card"])
  })
})
