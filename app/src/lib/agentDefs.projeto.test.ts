// Os Especialistas DO PROJETO (`.frota/agents/*.md`) são lidos pelo mesmo
// parser que a UI usa. Arquivo escrito à mão com frontmatter torto não quebra o
// app: ele degrada para o default e a persona chega sem voz, sem rubrica e sem
// cor. Este teste lê os arquivos REAIS, não uma cópia, então editá-los errado
// falha aqui e não na tela.
import { describe, expect, it } from "vitest"
import { categoryColor } from "@/lib/avatar"
import { defFieldsFrom } from "@/lib/agentDefs"

const ARQUIVOS = import.meta.glob("../../../.frota/agents/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

const PERSONAS = Object.entries(ARQUIVOS).map(([caminho, content]) => {
  const slug = caminho.split("/").pop()!.replace(/\.md$/, "")
  return defFieldsFrom({ slug, scope: "projeto", path: caminho, content, updated_at: 0 })
})

describe("Especialistas do projeto", () => {
  it("os quatro estão em disco e o parser lê nome, voz e rubrica de cada um", () => {
    expect(PERSONAS.map((p) => p.slug).sort()).toEqual([
      "cronometro",
      "fronteira",
      "prova",
      "regua",
    ])
    for (const p of PERSONAS) {
      expect(p.name, `${p.slug} sem nome`).not.toBe(p.slug)
      expect(p.personalityMd.length, `${p.slug} sem voz`).toBeGreaterThan(200)
      expect(p.rubric.length, `${p.slug} sem rubrica`).toBeGreaterThanOrEqual(4)
      expect(p.policy, `${p.slug} sem política`).toBeTruthy()
      expect(p.backend).toBe("claude-code")
      expect(p.version).toBe(1)
    }
  })

  it("cada domínio tem cor própria: categoria fora do mapa viraria brass", () => {
    const cores = PERSONAS.map((p) => categoryColor(p.category))
    expect(new Set(cores).size).toBe(PERSONAS.length)
    expect(cores).not.toContain(categoryColor("Geral"))
  })

  it("a voz é em pt-BR e sem travessão (regra de copy da casa)", () => {
    for (const p of PERSONAS) {
      expect(p.personalityMd, p.slug).not.toContain("—")
      expect(p.policy!, p.slug).not.toContain("—")
    }
  })
})
