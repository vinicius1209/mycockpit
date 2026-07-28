// Lógica pura do marketplace de Especialistas (E2): categorias, filtro, resumo,
// seed do preview e a montagem do input de criação.

import { describe, expect, it } from "vitest"
import {
  buildCreateInput,
  canCreate,
  emptyCreateForm,
  especialistaResumo,
  filterEspecialistas,
  marketplaceCategories,
  previewSeed,
} from "./marketplace"
import type { AgentDef } from "./agentDefs"

function def(patch: Partial<AgentDef>): AgentDef {
  return {
    id: "projeto:x",
    name: "X",
    personalityMd: "",
    skills: [],
    policy: null,
    backend: "claude-code",
    model: null,
    effort: null,
    category: "Geral",
    rubric: [],
    avatarStyle: "glass",
    avatarSeed: "x",
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    digest: "d",
    scope: "projeto",
    slug: "x",
    path: "/x.md",
    ...patch,
  }
}

describe("marketplaceCategories", () => {
  it("dedup + 'Todos' na frente + ordenado, ausência vira 'Geral'", () => {
    const cats = marketplaceCategories([
      def({ category: "Engenharia" }),
      def({ category: "Design" }),
      def({ category: "Engenharia" }),
      def({ category: "" }), // sem categoria → Geral
    ])
    expect(cats[0]).toBe("Todos")
    expect(cats).toEqual(["Todos", "Design", "Engenharia", "Geral"])
  })
})

describe("filterEspecialistas", () => {
  const defs = [
    def({ name: "Aline", slug: "aline", category: "Engenharia", personalityMd: "Trava fronteiras." }),
    def({ name: "Vault", slug: "vault", category: "Qualidade", personalityMd: "Passa a rubrica de risco." }),
  ]

  it("'Todos' + busca vazia devolve tudo", () => {
    expect(filterEspecialistas(defs, "Todos", "")).toHaveLength(2)
  })

  it("filtra por categoria", () => {
    const r = filterEspecialistas(defs, "Qualidade", "")
    expect(r.map((d) => d.name)).toEqual(["Vault"])
  })

  it("busca no nome, no slug e no briefing", () => {
    expect(filterEspecialistas(defs, "Todos", "aline").map((d) => d.name)).toEqual(["Aline"])
    expect(filterEspecialistas(defs, "Todos", "risco").map((d) => d.name)).toEqual(["Vault"])
    expect(filterEspecialistas(defs, "Todos", "vault").map((d) => d.name)).toEqual(["Vault"])
  })

  it("categoria E busca combinam", () => {
    expect(filterEspecialistas(defs, "Engenharia", "risco")).toHaveLength(0)
  })
})

describe("especialistaResumo", () => {
  it("pega a 1ª linha não-vazia, sem o '#' do heading", () => {
    expect(especialistaResumo("# UI Engineer\nCuida da interface.")).toBe(
      "UI Engineer",
    )
    expect(especialistaResumo("\n\nTrava a fronteira antes de escrever.")).toBe(
      "Trava a fronteira antes de escrever.",
    )
  })

  it("trunca respeitando o teto", () => {
    const r = especialistaResumo("a".repeat(200), 10)
    expect(r.length).toBe(10)
    expect(r.endsWith("…")).toBe(true)
  })

  it("briefing vazio vira string vazia (sem estourar)", () => {
    expect(especialistaResumo("")).toBe("")
  })
})

describe("previewSeed (avatar do criar + 'variar')", () => {
  it("salt 0 é o próprio slug do nome (= default, some do arquivo)", () => {
    expect(previewSeed("Aline", 0)).toBe("aline")
    expect(previewSeed("UI Engineer", 0)).toBe("ui-engineer")
  })

  it("'variar' muda a seed (sufixo numérico)", () => {
    expect(previewSeed("Aline", 1)).toBe("aline-1")
    expect(previewSeed("Aline", 2)).toBe("aline-2")
    expect(previewSeed("Aline", 1)).not.toBe(previewSeed("Aline", 0))
  })

  it("nome vazio ainda dá uma seed base", () => {
    expect(previewSeed("", 0)).toBe("especialista")
  })
})

describe("buildCreateInput", () => {
  it("mapeia o form pro AgentPresetInput com os defaults do E2", () => {
    const input = buildCreateInput({
      ...emptyCreateForm(),
      name: "  Aline  ",
      category: "Engenharia",
      personalityMd: "Você é a Aline.",
      rubric: ["Fronteiras", "Corridas"],
      skillsText: "revisar-pr, testes",
      policy: "  nunca commita  ",
      model: "gpt-x",
      effort: "high",
      avatarStyle: "bottts",
    })
    expect(input.name).toBe("Aline")
    expect(input.category).toBe("Engenharia")
    expect(input.rubric).toEqual(["Fronteiras", "Corridas"])
    expect(input.skills).toEqual(["revisar-pr", "testes"])
    expect(input.policy).toBe("nunca commita")
    expect(input.model).toBe("gpt-x")
    expect(input.effort).toBe("high")
    expect(input.avatarStyle).toBe("bottts")
    // seed = slug do nome (salt 0) → serialize omite do arquivo
    expect(input.avatarSeed).toBe("aline")
  })

  it("defaults: sem categoria vira 'Geral', model/effort 'default' viram null, policy vazia null", () => {
    const input = buildCreateInput({
      ...emptyCreateForm(),
      name: "Sem Cat",
      category: "   ",
      personalityMd: "corpo",
    })
    expect(input.category).toBe("Geral")
    expect(input.model).toBeNull()
    expect(input.effort).toBeNull()
    expect(input.policy).toBeNull()
  })

  it("'variar' entra na seed do input (avatarSalt)", () => {
    const input = buildCreateInput({
      ...emptyCreateForm(),
      name: "Aline",
      personalityMd: "corpo",
      avatarSalt: 2,
    })
    expect(input.avatarSeed).toBe("aline-2")
  })
})

describe("canCreate (gate do form)", () => {
  it("exige nome E briefing", () => {
    expect(canCreate(emptyCreateForm())).toBe(false)
    expect(canCreate({ ...emptyCreateForm(), name: "Aline" })).toBe(false)
    expect(
      canCreate({ ...emptyCreateForm(), name: "Aline", personalityMd: "corpo" }),
    ).toBe(true)
  })
})
