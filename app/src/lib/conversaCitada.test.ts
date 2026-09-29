import { describe, expect, it } from "vitest"
import { presentTool } from "@/lib/toolview"
import { rankearMencoes, indexarMencoes } from "@/lib/mentionRank"
import {
  CONVERSA_TODAS,
  blocoDeConversas,
  comporConversasNoPrompt,
  concessaoDoPrompt,
  conversasCitadas,
  enderecoDaConversa,
  enderecosDeConversa,
  partesComConversas,
  rotuloDaConversa,
} from "./conversaCitada"

// Metas no formato do banco: ids uuid como o app grava, títulos em pt-BR.
const parser = { id: "1a2b3c4d-0000-4000-8000-000000000001", title: "Refatorar o parser de OFX", updatedAt: 3 }
const migracao = { id: "9f8e7d6c-0000-4000-8000-000000000002", title: "Migração 63, índice de custo", updatedAt: 2 }
const atual = { id: "55555555-0000-4000-8000-000000000003", title: "Composer novo", updatedAt: 9 }
const metas = [parser, migracao, atual]

describe("citar conversa com @ (ADR-287)", () => {
  it("o endereço leva o nome e o id; o rótulo volta só do valor", () => {
    expect(enderecoDaConversa(parser)).toBe("conversa/refatorar-o-parser-de-ofx-1a2b3c4d")
    expect(rotuloDaConversa("conversa/refatorar-o-parser-de-ofx-1a2b3c4d")).toBe("refatorar o parser de ofx")
    expect(rotuloDaConversa(CONVERSA_TODAS)).toBe("Todas as conversas deste projeto")
  })

  it("o menu tem 'todas' primeiro, as outras por atividade, e nunca a aberta", () => {
    expect(enderecosDeConversa(metas, atual.id)).toEqual([
      CONVERSA_TODAS,
      "conversa/refatorar-o-parser-de-ofx-1a2b3c4d",
      "conversa/migracao-63-indice-de-custo-9f8e7d6c",
    ])
    expect(enderecosDeConversa([atual], atual.id)).toEqual([])
  })

  it("resolve pelo id, mesmo com a conversa renomeada depois", () => {
    const renomeada = { ...parser, title: "Parser OFX, fuso local" }
    const { conversas } = conversasCitadas("veja @conversa/refatorar-o-parser-de-ofx-1a2b3c4d", [renomeada])
    expect(conversas).toEqual([renomeada])
  })

  it("a moldura vai antes do texto, e a concessão sai exatamente dela", () => {
    const prompt = comporConversasNoPrompt(
      "Continue de @conversa/refatorar-o-parser-de-ofx-1a2b3c4d e @conversa/todas",
      metas,
    )
    expect(prompt.startsWith("<conversas-citadas>")).toBe(true)
    expect(prompt).toContain(`- conversation: ${parser.id} · Refatorar o parser de OFX`)
    expect(prompt.endsWith("e @conversa/todas")).toBe(true)
    expect(concessaoDoPrompt(prompt)).toEqual({ ids: [parser.id], todas: true })
  })

  it("sem citação que resolva, nada de moldura nem concessão", () => {
    expect(comporConversasNoPrompt("sem menção", metas)).toBe("sem menção")
    expect(comporConversasNoPrompt("@conversa/sumiu-deadbeef", metas)).toBe("@conversa/sumiu-deadbeef")
    expect(blocoDeConversas([], false)).toBeNull()
    expect(concessaoDoPrompt("texto qualquer")).toBeNull()
  })

  it("a bolha separa as menções do texto", () => {
    expect(partesComConversas("veja @conversa/todas agora")).toEqual([
      { texto: "veja ", conversa: false },
      { texto: "@conversa/todas", conversa: true },
      { texto: " agora", conversa: false },
    ])
  })

  it("no menu, a conversa casa pelo nome, não pelo prefixo", () => {
    const indice = indexarMencoes([
      { value: "conversa/refatorar-o-parser-de-ofx-1a2b3c4d", kind: "conversa" },
      { value: "conversa/migracao-63-indice-de-custo-9f8e7d6c", kind: "conversa" },
    ])
    expect(rankearMencoes(indice, "par", {}, 10).map((i) => i.value)).toEqual(["conversa/refatorar-o-parser-de-ofx-1a2b3c4d"])
    expect(rankearMencoes(indice, "conv", {}, 10)).toEqual([])
  })

  it("as ações do agente dizem que a busca foi em conversa citada", () => {
    expect(presentTool("mcp__frota-context__context_search", { query: "fuso", conversation: parser.id }).verb).toBe("Buscar na conversa citada")
    expect(presentTool("mcp__frota-context__context_search", { query: "fuso", conversation: "todas" }).verb).toBe("Buscar nas conversas do projeto")
    expect(presentTool("mcp__frota-context__context_search", { query: "fuso" }).verb).toBe("Buscar na memória")
    expect(presentTool("mcp__frota-context__context_read", { ref: `conversation:${parser.id}:item:4` }).verb).toBe("Ler a conversa citada")
  })
})
