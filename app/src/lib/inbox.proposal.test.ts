// S4.2 — derivação proposal→Decision: propostas do lead não-dispensadas
// entram na fila "Precisam de você" (o dismiss persistido fica no SQL —
// listOpenProposals só devolve dismissed = 0, então dispensar = sumir da
// derivação na próxima varredura).

import { describe, expect, it } from "vitest"
import type { LeadProposalRecord } from "@/lib/db"
import { proposalDecisions } from "@/lib/inbox"
import type { Project } from "@/lib/types"

function proposal(over: Partial<LeadProposalRecord> = {}): LeadProposalRecord {
  return {
    id: "prop-1",
    projectId: null,
    body: "1. Priorize o card A\n2. Destrave o card B",
    createdAt: 100,
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

const projects = [project("p1", "alpha")]

describe("proposalDecisions (S4.2)", () => {
  it("proposta aberta vira Decision proposal com excerpt (1ª linha) e body inteiro", () => {
    const out = proposalDecisions([proposal({ projectId: "p1" })], projects)
    expect(out).toHaveLength(1)
    const d = out[0]
    if (d.kind !== "proposal") throw new Error("kind errado")
    expect(d.proposalId).toBe("prop-1")
    expect(d.projectId).toBe("p1")
    expect(d.projectName).toBe("alpha")
    expect(d.excerpt).toBe("1. Priorize o card A")
    expect(d.body).toContain("Destrave o card B")
    expect(d.createdAt).toBe(100)
  })

  it("proposta do board inteiro (sem projectId) entra sem projectName", () => {
    const out = proposalDecisions([proposal()], projects)
    expect(out).toHaveLength(1)
    const d = out[0]
    if (d.kind !== "proposal") throw new Error("kind errado")
    expect(d.projectId).toBeUndefined()
    expect(d.projectName).toBeUndefined()
  })

  it("projeto arquivado: a proposta some da fila (regra dos cards)", () => {
    const out = proposalDecisions(
      [proposal({ projectId: "morto" })],
      projects,
    )
    expect(out).toHaveLength(0)
  })

  it("excerpt pula linhas vazias e trunca a 1ª linha longa", () => {
    const longa = "x".repeat(200)
    const out = proposalDecisions(
      [proposal({ body: `\n   \n${longa}\nresto` })],
      projects,
    )
    const d = out[0]
    if (d.kind !== "proposal") throw new Error("kind errado")
    expect(d.excerpt.length).toBeLessThanOrEqual(141)
    expect(d.excerpt.endsWith("…")).toBe(true)
  })
})
