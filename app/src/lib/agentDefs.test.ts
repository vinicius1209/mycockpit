// Personas em arquivo (.frota/agents/*.md) — o núcleo puro: frontmatter,
// slug, serialização e a precedência projeto > global.

import { describe, expect, it, vi } from "vitest"
import {
  dedupeByScope,
  defFieldsFrom,
  parseFrontmatter,
  parseRubric,
  parseSkillsList,
  serializeAgentDef,
  slugify,
  type AgentDef,
} from "./agentDefs"

vi.mock("@/lib/db", () => ({ isTauri: () => false }))

const ARQUIVO = `---
name: Revisor cético
backend: codex
model: gpt-5.2-codex
effort: high
skills: code-review, testes
policy: "Não escreve código: só aponta."
version: 3
---

Você duvida de tudo que não tem evidência.

## Como agir
- Peça o diff.
`

describe("parseFrontmatter", () => {
  it("separa campos do corpo e desfaz as aspas", () => {
    const { fields, body } = parseFrontmatter(ARQUIVO)
    expect(fields.name).toBe("Revisor cético")
    expect(fields.policy).toBe("Não escreve código: só aponta.")
    expect(body.startsWith("Você duvida")).toBe(true)
    expect(body).toContain("## Como agir")
  })

  it("arquivo SEM frontmatter é todo corpo (não quebra, não perde texto)", () => {
    const { fields, body } = parseFrontmatter("Só a personalidade aqui.")
    expect(fields).toEqual({})
    expect(body).toBe("Só a personalidade aqui.")
  })

  it("linha mal formada é ignorada, o resto do frontmatter vale", () => {
    const { fields } = parseFrontmatter("---\nname: X\nlixo sem dois pontos\nbackend: codex\n---\n")
    expect(fields.name).toBe("X")
    expect(fields.backend).toBe("codex")
  })
})

describe("defFieldsFrom", () => {
  const file = {
    slug: "revisor-cetico",
    scope: "projeto" as const,
    path: "/p/.mycockpit/agents/revisor-cetico.md",
    content: ARQUIVO,
    updated_at: 1700,
  }

  it("mapeia o arquivo pro formato de preset", () => {
    const d = defFieldsFrom(file)
    expect(d.name).toBe("Revisor cético")
    expect(d.backend).toBe("codex")
    expect(d.model).toBe("gpt-5.2-codex")
    expect(d.effort).toBe("high")
    expect(d.skills).toEqual(["code-review", "testes"])
    expect(d.version).toBe(3)
    expect(d.updatedAt).toBe(1700)
  })

  it("sem id no arquivo, a identidade é escopo:slug (legível e rastreável)", () => {
    expect(defFieldsFrom(file).id).toBe("projeto:revisor-cetico")
  })

  it("com id no arquivo, o id VENCE (é o UUID que as conversas carimbaram)", () => {
    const migrada = { ...file, content: `---\nid: 9f3-uuid\nname: X\n---\ncorpo` }
    expect(defFieldsFrom(migrada).id).toBe("9f3-uuid")
  })

  it("arquivo mínimo vira preset utilizável (defaults honestos)", () => {
    const d = defFieldsFrom({ ...file, content: "só o texto" })
    expect(d.name).toBe("revisor-cetico") // cai no slug
    expect(d.backend).toBe("claude-code")
    expect(d.version).toBe(1)
    expect(d.skills).toEqual([])
    expect(d.policy).toBeNull()
  })

  it("version inválida não vira NaN", () => {
    const d = defFieldsFrom({ ...file, content: "---\nversion: abc\n---\nx" })
    expect(d.version).toBe(1)
  })
})

describe("serializeAgentDef ↔ round-trip", () => {
  const input = {
    name: "Revisor cético",
    personalityMd: "Você duvida de tudo.",
    skills: ["code-review", "testes"],
    policy: "Não escreve código: só aponta.",
    backend: "codex",
    model: "gpt-5.2-codex",
    effort: "high",
    category: "Geral",
    rubric: [],
    avatarStyle: "glass",
    avatarSeed: "",
  }

  it("o que escrevemos volta igual ao ler", () => {
    const md = serializeAgentDef({ ...input, version: 2 })
    const d = defFieldsFrom({
      slug: "revisor-cetico",
      scope: "global",
      path: "/x.md",
      content: md,
      updated_at: 1,
    })
    expect(d.name).toBe(input.name)
    expect(d.skills).toEqual(input.skills)
    expect(d.policy).toBe(input.policy)
    expect(d.model).toBe(input.model)
    expect(d.effort).toBe(input.effort)
    expect(d.version).toBe(2)
    expect(d.personalityMd).toBe(input.personalityMd)
  })

  it("campos vazios não viram linhas mentirosas no arquivo", () => {
    const md = serializeAgentDef({
      ...input,
      model: null,
      effort: null,
      policy: null,
      skills: [],
      version: 1,
    })
    expect(md).not.toContain("model:")
    expect(md).not.toContain("effort:")
    expect(md).not.toContain("policy:")
    expect(md).not.toContain("skills:")
  })

  it("valor simples fica SEM aspas (o arquivo é pra ler e editar à mão)", () => {
    expect(serializeAgentDef({ ...input, name: "Revisor", version: 1 })).toContain(
      "name: Revisor\n",
    )
  })

  it("id só aparece quando existe (persona migrada do SQLite)", () => {
    expect(serializeAgentDef({ ...input, version: 1 })).not.toContain("id:")
    expect(
      serializeAgentDef({ ...input, version: 1, id: "uuid-antigo" }),
    ).toContain("id: uuid-antigo")
  })
})

// ── E2 · identidade & marketplace (category / rubric / avatar) ──────────────

describe("defFieldsFrom — campos novos do E2 (retrocompat)", () => {
  const file = {
    slug: "aline",
    scope: "projeto" as const,
    path: "/p/.mycockpit/agents/aline.md",
    content: ARQUIVO, // arquivo ANTIGO, sem os campos do E2
    updated_at: 1,
  }

  it("persona SEM os campos novos carrega com os defaults", () => {
    const d = defFieldsFrom(file)
    expect(d.category).toBe("Geral")
    expect(d.rubric).toEqual([])
    expect(d.avatarStyle).toBe("thumbs")
    // seed default = slug (identidade estável sem inventar linha no arquivo)
    expect(d.avatarSeed).toBe("aline")
  })

  it("lê category, rubric (array JSON) e avatar quando presentes", () => {
    const content = `---
name: Aline
backend: claude-code
category: Engenharia
rubric: ["Fronteiras, e responsabilidade","Corridas: reinício?"]
avatar_style: bottts
avatar_seed: aline-2
version: 1
---
corpo`
    const d = defFieldsFrom({ ...file, content })
    expect(d.category).toBe("Engenharia")
    // rubrica com vírgula/pontuação sobrevive intacta (array JSON)
    expect(d.rubric).toEqual([
      "Fronteiras, e responsabilidade",
      "Corridas: reinício?",
    ])
    expect(d.avatarStyle).toBe("bottts")
    expect(d.avatarSeed).toBe("aline-2")
  })

  it("rubrica escrita à mão como lista 'a, b' também é aceita (fallback)", () => {
    const content = `---
name: Aline
backend: claude-code
rubric: fronteiras, acoplamento
version: 1
---
corpo`
    expect(defFieldsFrom({ ...file, content }).rubric).toEqual([
      "fronteiras",
      "acoplamento",
    ])
  })
})

describe("serializeAgentDef ↔ round-trip dos campos do E2", () => {
  const base = {
    name: "Aline",
    personalityMd: "Você é a Aline.",
    skills: [],
    policy: null,
    backend: "claude-code",
    model: null,
    effort: null,
    version: 1,
  }

  it("o que escrevemos dos 3 campos volta igual ao ler (com vírgula na rubrica)", () => {
    const md = serializeAgentDef({
      ...base,
      slug: "aline",
      category: "Engenharia",
      rubric: ["Fronteiras, e acoplamento", "Idempotência: reinício?"],
      avatarStyle: "bottts",
      avatarSeed: "semente-custom",
    })
    const d = defFieldsFrom({
      slug: "aline",
      scope: "projeto",
      path: "/x.md",
      content: md,
      updated_at: 1,
    })
    expect(d.category).toBe("Engenharia")
    expect(d.rubric).toEqual([
      "Fronteiras, e acoplamento",
      "Idempotência: reinício?",
    ])
    expect(d.avatarStyle).toBe("bottts")
    expect(d.avatarSeed).toBe("semente-custom")
  })

  it("defaults do E2 NÃO viram linhas no arquivo (legível à mão)", () => {
    const md = serializeAgentDef({
      ...base,
      slug: "aline",
      category: "Geral",
      rubric: [],
      avatarStyle: "thumbs", // = default do sistema; nada a escrever
      avatarSeed: "aline", // = slug
    })
    expect(md).not.toContain("category:")
    expect(md).not.toContain("rubric:")
    expect(md).not.toContain("avatar_style:")
    expect(md).not.toContain("avatar_seed:")
  })

  it("avatar_seed só é escrita quando difere do slug", () => {
    const igual = serializeAgentDef({
      ...base,
      slug: "aline",
      category: "Geral",
      rubric: [],
      avatarStyle: "glass",
      avatarSeed: "aline",
    })
    expect(igual).not.toContain("avatar_seed:")
    const diferente = serializeAgentDef({
      ...base,
      slug: "aline",
      category: "Geral",
      rubric: [],
      avatarStyle: "glass",
      avatarSeed: "outra-seed",
    })
    expect(diferente).toContain("avatar_seed: outra-seed")
  })

  it("rubrica é serializada como array JSON de UMA linha", () => {
    const md = serializeAgentDef({
      ...base,
      slug: "aline",
      category: "Geral",
      rubric: ["Um item", "Outro, com vírgula"],
      avatarStyle: "glass",
      avatarSeed: "aline",
    })
    expect(md).toContain('rubric: ["Um item","Outro, com vírgula"]')
  })
})

describe("parseRubric", () => {
  it("array JSON preserva vírgulas e pontuação dos itens", () => {
    expect(parseRubric('["Fronteiras, e acoplamento","Corridas: reinício?"]')).toEqual([
      "Fronteiras, e acoplamento",
      "Corridas: reinício?",
    ])
  })

  it("lista 'a, b' (mão) cai no fallback de parseSkillsList", () => {
    expect(parseRubric("fronteiras, acoplamento")).toEqual([
      "fronteiras",
      "acoplamento",
    ])
  })

  it("JSON quebrado não estoura — degrada pro fallback", () => {
    expect(parseRubric('["sem fechar')).toEqual(['"sem fechar'])
  })
})

describe("slugify", () => {
  it("tira acento, espaço e maiúscula", () => {
    expect(slugify("Revisor Cético")).toBe("revisor-cetico")
    expect(slugify("  Arquiteto/Backend  ")).toBe("arquiteto-backend")
  })

  it("nome sem nada aproveitável ainda dá um arquivo válido", () => {
    expect(slugify("🙂")).toBe("persona")
    expect(slugify("")).toBe("persona")
  })
})

describe("parseSkillsList", () => {
  it("aceita lista simples e a forma YAML com colchetes", () => {
    expect(parseSkillsList("a, b")).toEqual(["a", "b"])
    expect(parseSkillsList("[a, b]")).toEqual(["a", "b"])
    expect(parseSkillsList("/a, b,")).toEqual(["a", "b"])
  })
})

describe("dedupeByScope", () => {
  const mk = (slug: string, scope: "projeto" | "global", name = slug) =>
    ({ slug, scope, name, id: `${scope}:${slug}` }) as AgentDef

  it("projeto vence global no mesmo slug", () => {
    const out = dedupeByScope([mk("rev", "global"), mk("rev", "projeto")])
    expect(out).toHaveLength(1)
    expect(out[0].scope).toBe("projeto")
  })

  it("a ordem de chegada não muda o vencedor", () => {
    const out = dedupeByScope([mk("rev", "projeto"), mk("rev", "global")])
    expect(out[0].scope).toBe("projeto")
  })

  it("slugs diferentes convivem, ordenados por nome", () => {
    const out = dedupeByScope([
      mk("z", "global", "Zelador"),
      mk("a", "projeto", "Arquiteto"),
    ])
    expect(out.map((d) => d.name)).toEqual(["Arquiteto", "Zelador"])
  })
})
