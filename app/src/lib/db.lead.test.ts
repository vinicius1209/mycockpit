// S4.2 — round-trip de lead_proposals no SQLite (mini-engine em memória,
// padrão db.cards.test.ts): insert → listOpenProposals (só dismissed = 0,
// mais novas primeiro) → dismissProposal (soft: a linha fica, fora da fila).

import { beforeEach, describe, expect, it, vi } from "vitest"

interface FakeProposalRow {
  id: string
  project_id: string | null
  body: string
  created_at: number
  dismissed: number
}

const h = vi.hoisted(() => ({
  proposals: [] as FakeProposalRow[],
}))

vi.mock("@tauri-apps/plugin-sql", () => {
  const fakeDb = {
    execute: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("CREATE TABLE") || sql.startsWith("CREATE INDEX")) {
        return { rowsAffected: 0 }
      }
      if (sql.startsWith("ALTER TABLE")) {
        return { rowsAffected: 0 }
      }
      if (sql.startsWith("INSERT INTO lead_proposals")) {
        const [id, project_id, body, created_at] = params as [
          string,
          string | null,
          string,
          number,
        ]
        h.proposals.push({ id, project_id, body, created_at, dismissed: 0 })
        return { rowsAffected: 1 }
      }
      if (sql.startsWith("UPDATE lead_proposals SET dismissed = 1 WHERE id")) {
        const [id] = params as [string]
        for (const p of h.proposals) if (p.id === id) p.dismissed = 1
        return { rowsAffected: 1 }
      }
      // supersede (D4): proposta nova dispensa as abertas do MESMO escopo
      if (
        sql.startsWith(
          "UPDATE lead_proposals SET dismissed = 1 WHERE dismissed = 0 AND project_id IS NULL",
        )
      ) {
        for (const p of h.proposals)
          if (p.dismissed === 0 && p.project_id === null) p.dismissed = 1
        return { rowsAffected: 1 }
      }
      if (
        sql.startsWith(
          "UPDATE lead_proposals SET dismissed = 1 WHERE dismissed = 0 AND project_id = $1",
        )
      ) {
        const [pid] = params as [string]
        for (const p of h.proposals)
          if (p.dismissed === 0 && p.project_id === pid) p.dismissed = 1
        return { rowsAffected: 1 }
      }
      throw new Error(`SQL não mapeado no fake (execute): ${sql}`)
    },
    select: async (sql: string) => {
      if (sql.includes("FROM lead_proposals WHERE dismissed = 0")) {
        return h.proposals
          .filter((p) => p.dismissed === 0)
          .sort((a, b) => b.created_at - a.created_at)
          .map((p) => ({ ...p }))
      }
      throw new Error(`SQL não mapeado no fake (select): ${sql}`)
    },
  }
  return { default: { load: async () => fakeDb } }
})

// isTauri() exige window.__TAURI_INTERNALS__ (ambiente node não tem window).
;(globalThis as Record<string, unknown>).window = { __TAURI_INTERNALS__: {} }

import { dismissProposal, insertProposal, listOpenProposals } from "@/lib/db"

beforeEach(() => {
  h.proposals.length = 0
})

describe("lead_proposals (S4.2): round-trip", () => {
  it("insert → list devolve a proposta aberta (mais novas primeiro)", async () => {
    const a = await insertProposal({ projectId: "p1", body: "proposta A" })
    const b = await insertProposal({ projectId: null, body: "proposta B" })
    // força ordem determinística (created_at pode empatar no mesmo ms)
    h.proposals.find((p) => p.id === a)!.created_at = 10
    h.proposals.find((p) => p.id === b)!.created_at = 20

    const open = await listOpenProposals()
    expect(open.map((p) => p.id)).toEqual([b, a])
    expect(open[1]).toMatchObject({
      id: a,
      projectId: "p1",
      body: "proposta A",
    })
    expect(open[0].projectId).toBeNull() // board inteiro
  })

  it("dismissProposal tira da fila mas NÃO apaga a linha (soft)", async () => {
    // escopos diferentes: o supersede do insert não interfere neste teste
    const a = await insertProposal({ projectId: "p1", body: "proposta A" })
    const b = await insertProposal({ projectId: null, body: "proposta B" })

    await dismissProposal(a)

    const open = await listOpenProposals()
    expect(open.map((p) => p.id)).toEqual([b])
    // a linha dispensada segue no banco (nada destrutivo automático)
    expect(h.proposals.find((p) => p.id === a)?.dismissed).toBe(1)
  })

  it("supersede (D4): a 2ª proposta do MESMO projeto dispensa a 1ª", async () => {
    const velha = await insertProposal({ projectId: "p1", body: "triagem seg" })
    const nova = await insertProposal({ projectId: "p1", body: "triagem ter" })

    const open = await listOpenProposals()
    expect(open.map((p) => p.id)).toEqual([nova])
    // soft: a superseded fica no banco, só sai da fila
    expect(h.proposals.find((p) => p.id === velha)?.dismissed).toBe(1)
  })

  it("supersede (D4): proposta nova do board inteiro dispensa só as sem-projeto", async () => {
    const semProjeto = await insertProposal({ projectId: null, body: "board seg" })
    const doProjeto = await insertProposal({ projectId: "p1", body: "do p1" })
    const novaGeral = await insertProposal({ projectId: null, body: "board ter" })

    const open = await listOpenProposals()
    expect(open.map((p) => p.id).sort()).toEqual([doProjeto, novaGeral].sort())
    expect(h.proposals.find((p) => p.id === semProjeto)?.dismissed).toBe(1)
  })

  it("supersede (D4): escopos diferentes coexistem (projeto A não apaga B)", async () => {
    const a = await insertProposal({ projectId: "p1", body: "do p1" })
    const b = await insertProposal({ projectId: "p2", body: "do p2" })

    const open = await listOpenProposals()
    expect(open.map((p) => p.id).sort()).toEqual([a, b].sort())
  })
})
