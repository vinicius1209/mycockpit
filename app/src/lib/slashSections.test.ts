import { describe, expect, it } from "vitest"
import type { SlashCommand } from "@/lib/sources"
import { MAX_SLASH_ITEMS, sectionOf, slashChip, slashSections } from "./slashSections"

function cmd(p: Partial<SlashCommand> & { name: string }): SlashCommand {
  return {
    description: null,
    kind: "command",
    origin: "global",
    source: "claude",
    body: null,
    ...p,
  }
}

// Recorte do inventário real do mycockpit com Claude Code 2.1.270 (init de
// 14/09/2026 + .claude/skills do projeto + builtin da Frota).
const INVENTARIO: SlashCommand[] = [
  cmd({ name: "compactar", source: "app", description: "Compacta o contexto da conversa; libera janela" }),
  cmd({ name: "build", kind: "skill", origin: "project", description: "Canal de builds da Frota." }),
  cmd({ name: "vercel:deploy", providerPlugin: "vercel", description: "Deploy the current project to Vercel" }),
  cmd({ name: "paper-desktop:code-to-design", kind: "skill", providerPlugin: "paper-desktop", description: "Generate a Paper design from the project's codebase" }),
  cmd({ name: "debug", kind: "skill" }),
  cmd({ name: "context", kind: "builtin", description: "Mostra quanto da janela de contexto cada parte ocupa" }),
]

describe("seções do popover /", () => {
  it("agrupa na ordem de precedência e a lista plana segue a navegação", () => {
    const { sections, flat } = slashSections(INVENTARIO, "", "Claude Code")
    expect(sections.map((s) => s.label)).toEqual(["Frota", "Projeto", "Plugins", "Claude Code"])
    expect(flat.map((c) => c.name)).toEqual([
      "compactar",
      "build",
      "paper-desktop:code-to-design",
      "vercel:deploy",
      "context",
      "debug",
    ])
  })

  it("busca também pela descrição, com nome casado primeiro", () => {
    const { flat } = slashSections(
      [...INVENTARIO, cmd({ name: "design", kind: "skill", description: "UI design" })],
      "design",
      "Claude Code",
    )
    expect(flat.map((c) => c.name)).toEqual(["paper-desktop:code-to-design", "design"])
    expect(slashSections(INVENTARIO, "janela", "Claude Code").flat.map((c) => c.name)).toEqual([
      "compactar",
      "context",
    ])
  })

  it("busca pelo nome do plugin traz os itens dele", () => {
    const { flat } = slashSections(INVENTARIO, "paper", "Claude Code")
    expect(flat.map((c) => c.name)).toEqual(["paper-desktop:code-to-design"])
  })

  it("seção vazia não aparece e o teto vale para a soma", () => {
    const muitos = Array.from({ length: MAX_SLASH_ITEMS + 10 }, (_, i) =>
      cmd({ name: `s${String(i).padStart(3, "0")}`, kind: "skill" }),
    )
    const { sections, flat } = slashSections(muitos, "", "Codex")
    expect(sections.map((s) => s.id)).toEqual(["motor"])
    expect(flat).toHaveLength(MAX_SLASH_ITEMS)
  })

  it("um chip por item dizendo o que ele é", () => {
    expect(INVENTARIO.map(slashChip)).toEqual(["app", "skill", "vercel", "paper-desktop", "skill", "cli"])
    expect(slashChip(cmd({ name: "x", source: "plugin", pluginName: "Quality" }))).toBe("Quality")
    expect(slashChip(cmd({ name: "triage", source: "codex" }))).toBe("comando")
  })

  it("casa e plugin aprovado da Frota ficam na seção Frota mesmo sendo globais", () => {
    expect(sectionOf(cmd({ name: "deploy", source: "mycockpit", origin: "project" }))).toBe("frota")
    expect(sectionOf(cmd({ name: "acme.q:review", source: "plugin" }))).toBe("frota")
  })
})
