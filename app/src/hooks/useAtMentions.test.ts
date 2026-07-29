// Itens do "@" do composer (editor Lexical): montagem pura — especialistas
// antes de arquivos, os .md das duas pastas de agents NÃO viram "arquivo"
// (já entram como persona ou são contexto de code agent externo) e a lista
// não é fatiada aqui (o limite fica com o menu na renderização).

import { describe, expect, it } from "vitest"
import { buildLexicalAtItems, isMentionableFile } from "./useAtMentions"

describe("isMentionableFile (regra única de arquivo mencionável)", () => {
  it("exclui os .md de .mycockpit/agents e .claude/agents", () => {
    expect(isMentionableFile(".mycockpit/agents/aline.md")).toBe(false)
    expect(isMentionableFile(".claude/agents/externo.md")).toBe(false)
    expect(isMentionableFile("src/main.ts")).toBe(true)
    expect(isMentionableFile("docs/plano.md")).toBe(true)
  })
})

describe("buildLexicalAtItems (itens do @ do composer)", () => {
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

  it("exclui os .md das pastas de agents", () => {
    const itens = buildLexicalAtItems(
      [],
      [".mycockpit/agents/aline.md", ".claude/agents/externo.md", "src/main.ts"],
    )
    expect(itens.map((i) => i.value)).toEqual(["src/main.ts"])
  })

  it("não fatia a lista (o limite fica com o menu na renderização)", () => {
    // A lib filtra pela query antes de limitar — cortar na montagem esconderia
    // arquivos da busca.
    const files = Array.from({ length: 20 }, (_, n) => `src/arquivo${n}.ts`)
    const itens = buildLexicalAtItems(["Aline"], files)
    expect(itens).toHaveLength(21)
  })

  it("sem arquivos carregados, lista só as personas", () => {
    const itens = buildLexicalAtItems(["Aline"], [])
    expect(itens).toEqual([{ value: "Aline", kind: "agent" }])
  })
})
