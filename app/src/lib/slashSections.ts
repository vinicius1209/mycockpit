// Seções do popover "/" (ADR-189). Pura: filtra, ordena e agrupa o inventário
// na MESMA ordem em que a lista é navegada pelo teclado, então o índice do
// item selecionado vale para a lista plana e para o desenho em seções.
//
// A ordem das seções segue quem vence o dedup no backend: Frota (builtins do
// app, casa e plugins da Frota) → projeto → plugins do motor → o motor.

import type { SlashCommand } from "@/lib/sources"

export type SlashSectionId = "frota" | "projeto" | "plugins" | "motor"

export interface SlashSection {
  id: SlashSectionId
  label: string
  items: SlashCommand[]
}

const ORDEM: SlashSectionId[] = ["frota", "projeto", "plugins", "motor"]

/** Teto da lista do "/": com seções e rolagem, oito itens escondiam o
 *  inventário real (57 comandos no Claude Code 2.1.270). */
export const MAX_SLASH_ITEMS = 60

export function sectionOf(c: SlashCommand): SlashSectionId {
  if (c.source === "app" || c.source === "mycockpit" || c.source === "plugin") return "frota"
  if (c.providerPlugin) return "plugins"
  if (c.origin === "project") return "projeto"
  return "motor"
}

/** Um chip por item, dizendo o que ele É (a seção já diz de onde vem). */
export function slashChip(c: SlashCommand): string {
  if (c.source === "app") return "app"
  if (c.pluginName) return c.pluginName
  if (c.providerPlugin) return c.providerPlugin
  if (c.kind === "builtin") return "cli"
  if (c.kind === "skill") return "skill"
  return "comando"
}

function rank(c: SlashCommand, q: string): number {
  if (!q) return 0
  const name = c.name.toLowerCase()
  if (name.startsWith(q)) return 0
  if (name.includes(q)) return 1
  if (c.providerPlugin?.toLowerCase().includes(q)) return 2
  if (c.description?.toLowerCase().includes(q)) return 3
  return -1
}

/** Filtra por nome, plugin e descrição; nome casado vem antes de descrição
 *  casada dentro de cada seção. Devolve as seções e a lista plana na ordem
 *  de navegação. */
export function slashSections(
  commands: SlashCommand[],
  query: string,
  motorLabel: string,
): { sections: SlashSection[]; flat: SlashCommand[] } {
  const q = query.toLowerCase()
  const ranked = commands
    .map((c) => ({ c, r: rank(c, q) }))
    .filter((x) => x.r >= 0)
  const labels: Record<SlashSectionId, string> = {
    frota: "Frota",
    projeto: "Projeto",
    plugins: "Plugins",
    motor: motorLabel,
  }
  const sections: SlashSection[] = []
  let restante = MAX_SLASH_ITEMS
  for (const id of ORDEM) {
    if (restante <= 0) break
    const items = ranked
      .filter((x) => sectionOf(x.c) === id)
      .sort((a, b) => {
        if (a.r !== b.r) return a.r - b.r
        if (id === "plugins") {
          const p = (a.c.providerPlugin ?? "").localeCompare(b.c.providerPlugin ?? "")
          if (p) return p
        }
        return a.c.name.localeCompare(b.c.name)
      })
      .slice(0, restante)
      .map((x) => x.c)
    if (items.length === 0) continue
    restante -= items.length
    sections.push({ id, label: labels[id], items })
  }
  return { sections, flat: sections.flatMap((s) => s.items) }
}
