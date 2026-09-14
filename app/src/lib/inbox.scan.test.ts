// INBOX — a varredura junta o que nasceu no app e espera o humano.
//
// Estes casos viviam em `inbox.sdd.test.ts` e sobreviveram ao corte da aba
// Features (remocao-features-prd, guarda G3): disputa e proposta continuam
// sendo a fila, e a regra do projeto arquivado continua valendo.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Project } from "@/lib/types"

let fusionPendentes: {
  convId: string
  projectId: string
  title: string | null
  createdAt?: number
}[] = []
let propostas: {
  id: string
  projectId: string | null
  body: string
  createdAt: number
}[] = []

vi.mock("@/lib/db", () => ({
  listPendingDecisions: () => Promise.resolve(fusionPendentes),
  listOpenProposals: () => Promise.resolve(propostas),
}))

import { scanDecisions } from "@/lib/inbox"

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

const ingresso = project("p-ingresso", "meuingresso3.0")

beforeEach(() => {
  fusionPendentes = []
  propostas = []
})

describe("scanDecisions", () => {
  it("disputa do fusion e proposta do lead entram na fila", async () => {
    fusionPendentes = [
      { convId: "c1", projectId: ingresso.id, title: "quem escreve melhor", createdAt: 7 },
    ]
    propostas = [
      { id: "prop-1", projectId: ingresso.id, body: "1. Priorize o card A", createdAt: 5 },
    ]
    const ds = await scanDecisions([ingresso])
    expect(ds.map((d) => d.kind)).toEqual(["fusion", "proposal"])
    const [fusion] = ds
    if (fusion.kind !== "fusion") throw new Error("kind errado")
    expect(fusion.projectName).toBe("meuingresso3.0")
    expect(fusion.createdAt).toBe(7)
  })

  it("disputa sem título ganha o rótulo padrão", async () => {
    fusionPendentes = [{ convId: "c1", projectId: ingresso.id, title: null }]
    const [d] = await scanDecisions([ingresso])
    expect(d.kind === "fusion" && d.title).toBe("Disputa aguardando decisão")
  })

  it("disputa de projeto arquivado fica fora (reaparece se ele voltar)", async () => {
    fusionPendentes = [{ convId: "c1", projectId: "p-arquivado", title: "x" }]
    expect(await scanDecisions([ingresso])).toEqual([])
  })

  it("sem nada pendente, a fila é vazia", async () => {
    expect(await scanDecisions([ingresso])).toEqual([])
  })
})
