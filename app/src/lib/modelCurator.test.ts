import { describe, expect, it } from "vitest"
import {
  anthropicAlias,
  filterCandidates,
  parseCuratorProposals,
  catalogEntryFor,
} from "@/lib/modelCurator"
import { mergeModelOptions, type AgentModelOption } from "@/lib/agents"
import type { CatalogModel } from "@/lib/catalog"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse("2026-07-14T00:00:00Z")

function cm(over: Partial<CatalogModel>): CatalogModel {
  return {
    provider: "anthropic",
    id: "claude-x",
    name: "X",
    input: 3,
    output: 15,
    cache_read: 0.3,
    context: 200_000,
    release_date: new Date(NOW - 10 * DAY).toISOString().slice(0, 10),
    ...over,
  }
}

/** Pickers típicos (subset dos estáticos do registry). */
const PICKERS = {
  "claude-code": new Set(["default", "opus", "opus[1m]", "sonnet", "haiku"]),
  codex: new Set(["default", "gpt-5.6-sol", "gpt-5.5", "o3"]),
}

describe("anthropicAlias", () => {
  it("reduz ids do catálogo ao alias simples do CLI", () => {
    expect(anthropicAlias("claude-sonnet-4-5-20250929")).toBe("sonnet")
    expect(anthropicAlias("claude-opus-4-6")).toBe("opus")
    expect(anthropicAlias("claude-3-5-haiku-20241022")).toBe("haiku")
    expect(anthropicAlias("claude-fable-5")).toBe("fable")
  })

  it("família desconhecida ou id não-claude → null", () => {
    expect(anthropicAlias("claude-nova-9")).toBeNull()
    expect(anthropicAlias("gpt-5.7")).toBeNull()
  })
})

describe("filterCandidates", () => {
  it("aceita modelo novo fora do picker (openai usa o id direto)", () => {
    const out = filterCandidates(
      [cm({ provider: "openai", id: "gpt-5.7" })],
      NOW,
      PICKERS,
      new Set(),
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ agent: "codex", value: "gpt-5.7" })
  })

  it("anthropic que reduz a alias JÁ no picker não é candidato", () => {
    const out = filterCandidates(
      [cm({ id: "claude-opus-4-7" })], // → "opus", já no picker
      NOW,
      PICKERS,
      new Set(),
    )
    expect(out).toHaveLength(0)
  })

  it("anthropic com alias novo (fora do picker) vira candidato pelo alias", () => {
    const out = filterCandidates(
      [cm({ id: "claude-fable-5" })],
      NOW,
      PICKERS,
      new Set(),
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ agent: "claude-code", value: "fable" })
  })

  it("anthropic sem alias reduzível usa o id completo", () => {
    const out = filterCandidates([cm({ id: "claude-nova-9" })], NOW, PICKERS, new Set())
    expect(out[0]?.value).toBe("claude-nova-9")
  })

  it("corta por data: >60 dias, sem release_date ou data inválida ficam fora", () => {
    const old = cm({ id: "claude-fable-5", release_date: new Date(NOW - 61 * DAY).toISOString().slice(0, 10) })
    const none = cm({ id: "claude-fable-5", release_date: null })
    const bad = cm({ id: "claude-fable-5", release_date: "não-é-data" })
    expect(filterCandidates([old, none, bad], NOW, PICKERS, new Set())).toHaveLength(0)
  })

  it("dentro da janela de 60 dias entra", () => {
    const recent = cm({ id: "claude-fable-5", release_date: new Date(NOW - 59 * DAY).toISOString().slice(0, 10) })
    expect(filterCandidates([recent], NOW, PICKERS, new Set())).toHaveLength(1)
  })

  it("provider fora de anthropic/openai fica fora", () => {
    const out = filterCandidates([cm({ provider: "google", id: "gemini-4" })], NOW, PICKERS, new Set())
    expect(out).toHaveLength(0)
  })

  it("já proposto (qualquer status) não volta", () => {
    const out = filterCandidates(
      [cm({ provider: "openai", id: "gpt-5.7" })],
      NOW,
      PICKERS,
      new Set(["codex:gpt-5.7"]),
    )
    expect(out).toHaveLength(0)
  })

  it("dois releases da mesma família → um candidato só (dedupe por alias)", () => {
    const out = filterCandidates(
      [cm({ id: "claude-fable-5" }), cm({ id: "claude-fable-5-20260701" })],
      NOW,
      PICKERS,
      new Set(),
    )
    expect(out).toHaveLength(1)
  })
})

describe("parseCuratorProposals", () => {
  const allowed = new Set(["fable", "gpt-5.7"])

  it("aceita JSON válido (mesmo com prosa em volta)", () => {
    const raw = `Aqui está:\n[{"value":"fable","label":"Fable","description":"Topo de linha, caro, tarefas críticas"}]\nEspero ter ajudado.`
    expect(parseCuratorProposals(raw, allowed)).toEqual([
      { value: "fable", label: "Fable", description: "Topo de linha, caro, tarefas críticas" },
    ])
  })

  it("resposta malformada → [] em silêncio", () => {
    expect(parseCuratorProposals("não sei", allowed)).toEqual([])
    expect(parseCuratorProposals("[{quebrado", allowed)).toEqual([])
    expect(parseCuratorProposals(`{"value":"fable"}`, allowed)).toEqual([])
  })

  it("descarta value alucinado (fora dos candidatos), campos não-string e duplicatas", () => {
    const raw = JSON.stringify([
      { value: "inventado", label: "X", description: "y" },
      { value: "fable", label: 3, description: "y" },
      { value: "gpt-5.7", label: "Sol 5.7", description: "Frontier, caro" },
      { value: "gpt-5.7", label: "de novo", description: "dup" },
      "string solta",
    ])
    expect(parseCuratorProposals(raw, allowed)).toEqual([
      { value: "gpt-5.7", label: "Sol 5.7", description: "Frontier, caro" },
    ])
  })
})

describe("mergeModelOptions", () => {
  const base: AgentModelOption[] = [
    { value: "default", label: "Padrão" },
    { value: "opus", label: "Opus" },
  ]

  it("anexa extras no fim sem duplicar value (base vence)", () => {
    const merged = mergeModelOptions(base, [
      { value: "opus", label: "Opus proposto" },
      { value: "fable", label: "Fable" },
    ])
    expect(merged.map((o) => o.value)).toEqual(["default", "opus", "fable"])
    expect(merged[1].label).toBe("Opus") // a estática ganha da proposta
  })

  it("extra vazio devolve a MESMA referência (estável p/ render)", () => {
    expect(mergeModelOptions(base, [])).toBe(base)
  })

  it("não muta a base", () => {
    mergeModelOptions(base, [{ value: "novo", label: "n" }])
    expect(base).toHaveLength(2)
  })
})

describe("catalogEntryFor", () => {
  const catalog = [
    cm({ id: "claude-fable-5" }),
    cm({ provider: "openai", id: "gpt-5.7", input: 2, output: 8 }),
  ]

  it("claude-code casa por alias reduzido; codex por id direto", () => {
    expect(catalogEntryFor(catalog, "claude-code", "fable")?.id).toBe("claude-fable-5")
    expect(catalogEntryFor(catalog, "codex", "gpt-5.7")?.input).toBe(2)
    expect(catalogEntryFor(catalog, "codex", "gpt-9")).toBeUndefined()
  })
})
