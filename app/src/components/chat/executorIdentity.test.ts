// Identidade do EXECUTOR no gutter (helper compartilhado entre o cabeçalho do
// grupo e o indicador "trabalhando…"): persona-piloto se o preset resolve na
// lista; senão o logo do code agent + o rótulo do produto.
import { isValidElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { resolveExecutorIdentity } from "./executorIdentity"
import type { AgentDef } from "@/lib/agentDefs"

function persona(id: string, name: string): AgentDef {
  return {
    id,
    name,
    personalityMd: "",
    skills: [],
    policy: null,
    backend: "claude-code",
    model: null,
    effort: null,
    category: "Geral",
    rubric: [],
    avatarStyle: "thumbs",
    avatarSeed: id,
    digest: "d",
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    scope: "projeto",
    slug: id,
    path: `/tmp/${id}.md`,
  }
}

function markup(node: ReactNode): string {
  return isValidElement(node) ? renderToStaticMarkup(node) : ""
}

describe("resolveExecutorIdentity — quem assina o turno do executor", () => {
  it("com preset resolvido na lista: nome e avatar (img) da persona-piloto", () => {
    const { name, gutter } = resolveExecutorIdentity(
      [persona("aline", "Aline")],
      "claude-code",
      "aline",
    )
    expect(name).toBe("Aline")
    // AgentAvatar renderiza um <img> com o data-uri do avatar
    expect(markup(gutter)).toContain("<img")
  })

  it("sem preset: cai no logo do code agent + rótulo do produto", () => {
    const { name, gutter } = resolveExecutorIdentity([], "claude-code", null)
    expect(name).toBe("Claude Code")
    // o logo é um <svg> (não o <img> do avatar de persona)
    const html = markup(gutter)
    expect(html).toContain("<svg")
    expect(html).not.toContain("<img")
  })

  it("preset carimbado mas persona AUSENTE da lista: fallback pro logo do agent", () => {
    const { name, gutter } = resolveExecutorIdentity([], "codex", "sumida")
    expect(name).toBe("Codex")
    expect(markup(gutter)).toContain("<svg")
  })
})
