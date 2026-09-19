// R3 do docs/companion-chat-prd.md: o celular recebe as conversas recentes de
// cada projeto. Metas no formato de `listConversations` (db/conversations.ts).

import { describe, expect, it } from "vitest"
import { conversasRecentes, projetosDoCompanion } from "./companionProjetos"
import type { ConversationMeta } from "@/lib/db/conversations"

const T0 = 1_789_600_000_000
const meta = (id: string, minutos: number, extra: Partial<ConversationMeta> = {}): ConversationMeta => ({
  id,
  title: `Conversa ${id}`,
  updatedAt: T0 + minutos * 60_000,
  color: null,
  worktreePath: null,
  agent: "claude-code",
  parentId: null,
  hasDraft: false,
  ...extra,
})
const nunca = () => false

describe("conversasRecentes", () => {
  it("mais recentes primeiro, com teto", () => {
    const metas = Array.from({ length: 25 }, (_, i) => meta(`c${i}`, i))
    const lista = conversasRecentes(metas, nunca, new Set(), 20)
    expect(lista).toHaveLength(20)
    expect(lista[0].convId).toBe("c24")
    expect(lista.at(-1)?.convId).toBe("c5")
  })

  it("quem roda ou pede você entra mesmo fora do teto", () => {
    const metas = Array.from({ length: 25 }, (_, i) => meta(`c${i}`, i))
    const lista = conversasRecentes(metas, (id) => id === "c0", new Set(["c1"]), 20)
    expect(lista.map((c) => c.convId)).toContain("c0")
    expect(lista.find((c) => c.convId === "c1")?.pedeVoce).toBe(true)
    expect(lista.find((c) => c.convId === "c0")?.running).toBe(true)
  })

  it("leva a frase pronta do último turno, e fica sem o campo quando não há", () => {
    const metas = [meta("com", 2), meta("sem", 1)]
    const frases: Record<string, string> = { com: "Extraiu o parser pra lib/ e cobriu o caso vazio." }
    const lista = conversasRecentes(metas, nunca, new Set(), 20, (id) => frases[id] ?? null)
    expect(lista[0].frase).toBe("Extraiu o parser pra lib/ e cobriu o caso vazio.")
    expect("frase" in lista[1]).toBe(false)
  })

  it("título vazio vira Conversa, sem inventar outro nome", () => {
    const [c] = conversasRecentes([meta("x", 1, { title: "  " })], nunca, new Set())
    expect(c.title).toBe("Conversa")
  })
})

describe("projetosDoCompanion", () => {
  it("mantém a mesa de cada motor e acrescenta as recentes", () => {
    const metas = [
      meta("mesa-velha", 1, { title: "Mesa · claude-code" }),
      meta("mesa-nova", 5, { title: "Mesa · claude-code" }),
      meta("outra", 9, { title: "Checkout duplicado", agent: "codex" }),
    ]
    const [p] = projetosDoCompanion({
      projects: [{ id: "p1", name: "atlas" }],
      usableAgents: ["claude-code", "codex"],
      metasByProject: { p1: metas },
      prefixoDaMesa: "Mesa · ",
      rodando: nunca,
      pedeVoce: new Set(),
    })
    expect(p.agents).toEqual([
      { agent: "claude-code", deskConvId: "mesa-nova", deskTitle: "Mesa · claude-code" },
      { agent: "codex" },
    ])
    expect(p.recent.map((c) => c.convId)).toEqual(["outra", "mesa-nova", "mesa-velha"])
  })

  it("projeto sem metas carregadas chega vazio, não some", () => {
    const [p] = projetosDoCompanion({
      projects: [{ id: "p2", name: "lumen" }],
      usableAgents: ["codex"],
      metasByProject: {},
      prefixoDaMesa: "Mesa · ",
      rodando: nunca,
      pedeVoce: new Set(),
    })
    expect(p).toEqual({ id: "p2", name: "lumen", agents: [{ agent: "codex" }], recent: [] })
  })
})
