// Popover do "@": as personas listadas são as REAIS do app
// (.mycockpit/agents, via listAgentDefs), não o .claude/agents legado. O que
// importa aqui é a montagem pura dos itens — filtro por query, dedupe já feito
// pelo listAgentDefs (projeto vence global), o item de agent carregar o `id`
// resolvível e os .md das duas pastas de agents NÃO virarem "arquivo".

import { describe, expect, it } from "vitest"
import { buildAtItems, buildLexicalAtItems } from "./useAtMentions"
import { dedupeByScope, type AgentDef } from "@/lib/agentDefs"

function def(scope: AgentDef["scope"], slug: string, name: string): AgentDef {
  return {
    id: `${scope}:${slug}`,
    name,
    personalityMd: "",
    skills: [],
    policy: null,
    backend: "claude-code",
    model: null,
    effort: null,
    category: "Geral",
    rubric: [],
    avatarStyle: "glass",
    avatarSeed: slug,
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    digest: "d",
    scope,
    slug,
    path: `/${scope}/${slug}.md`,
  }
}

describe("buildAtItems (popover do @)", () => {
  it("lista as personas filtrando pela query", () => {
    const agents = [
      def("projeto", "aline", "Aline"),
      def("projeto", "bruno", "Bruno"),
    ]
    const itens = buildAtItems(agents, [], "al")
    expect(itens.map((i) => i.value)).toEqual(["Aline"])
    expect(itens[0].kind).toBe("agent")
  })

  it("o item de agent carrega o id resolvível (scope:slug)", () => {
    const itens = buildAtItems([def("global", "aline", "Aline")], [], "")
    expect(itens[0]).toMatchObject({
      kind: "agent",
      value: "Aline",
      id: "global:aline",
    })
  })

  it("o item de agent anexa o def do avatar; o de arquivo não", () => {
    const files = ["src/main.ts"]
    const itens = buildAtItems([def("projeto", "aline", "Aline")], files, "")
    const agente = itens.find((i) => i.kind === "agent")!
    const arquivo = itens.find((i) => i.kind === "file")!
    // agent leva só os campos que o <AgentAvatar> precisa
    expect(agente.def).toEqual({
      category: "Geral",
      avatarStyle: "glass",
      avatarSeed: "aline",
      slug: "aline",
      name: "Aline",
    })
    // arquivo não carrega def (nem id)
    expect(arquivo.def).toBeUndefined()
    expect(arquivo.id).toBeUndefined()
  })

  it("projeto sombreia global no mesmo slug (dedupe do listAgentDefs)", () => {
    // Emula a fonte real: as duas vêm do disco, dedupeByScope resolve.
    const doDisco = [
      def("global", "aline", "Aline (global)"),
      def("projeto", "aline", "Aline (projeto)"),
    ]
    const agents = dedupeByScope(doDisco)
    const itens = buildAtItems(agents, [], "aline")
    expect(itens).toHaveLength(1)
    expect(itens[0]).toMatchObject({
      value: "Aline (projeto)",
      id: "projeto:aline",
    })
  })

  it("não lista os .md de .mycockpit/agents nem de .claude/agents como arquivo", () => {
    const files = [
      ".mycockpit/agents/aline.md",
      ".claude/agents/externo.md",
      "src/main.ts",
    ]
    const itens = buildAtItems([], files, "")
    expect(itens.map((i) => i.value)).toEqual(["src/main.ts"])
    expect(itens.every((i) => i.kind === "file")).toBe(true)
  })

  it("personas antes de arquivos e limita a 8 itens", () => {
    const agents = Array.from({ length: 6 }, (_, n) =>
      def("projeto", `p${n}`, `Persona ${n}`),
    )
    const files = ["a.ts", "b.ts", "c.ts", "d.ts"]
    const itens = buildAtItems(agents, files, "")
    expect(itens).toHaveLength(8)
    expect(itens.slice(0, 6).every((i) => i.kind === "agent")).toBe(true)
    expect(itens.slice(6).every((i) => i.kind === "file")).toBe(true)
  })
})

describe("buildLexicalAtItems (itens do @ no motor Lexical)", () => {
  it("agrupa especialistas antes dos arquivos, contíguos", () => {
    const itens = buildLexicalAtItems(
      ["Aline", "Bruno"],
      ["src/main.ts", "docs/plano.md"],
    )
    expect(itens).toEqual([
      { value: "Aline", kind: "agent" },
      { value: "Bruno", kind: "agent" },
      { value: "src/main.ts", kind: "file" },
      { value: "docs/plano.md", kind: "file" },
    ])
  })

  it("exclui os .md das pastas de agents (mesma regra do textarea)", () => {
    const itens = buildLexicalAtItems(
      [],
      [".mycockpit/agents/aline.md", ".claude/agents/externo.md", "src/main.ts"],
    )
    expect(itens.map((i) => i.value)).toEqual(["src/main.ts"])
  })

  it("não fatia a lista (o limite fica com o menu na renderização)", () => {
    // No textarea o buildAtItems corta em 8; aqui a lib filtra pela query antes
    // de limitar — cortar na montagem esconderia arquivos da busca.
    const files = Array.from({ length: 20 }, (_, n) => `src/arquivo${n}.ts`)
    const itens = buildLexicalAtItems(["Aline"], files)
    expect(itens).toHaveLength(21)
  })

  it("sem arquivos carregados, lista só as personas", () => {
    const itens = buildLexicalAtItems(["Aline"], [])
    expect(itens).toEqual([{ value: "Aline", kind: "agent" }])
  })
})
