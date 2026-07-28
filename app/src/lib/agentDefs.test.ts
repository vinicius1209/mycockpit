// Personas em arquivo (.mycockpit/agents/*.md) — o núcleo puro: frontmatter,
// slug, serialização e a precedência projeto > global.

import { describe, expect, it, vi } from "vitest"
import {
  dedupeByScope,
  defFieldsFrom,
  parseFrontmatter,
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
