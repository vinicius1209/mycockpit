import type { SlashCommand } from "@/lib/sources"

export type ExtensionEntryKind =
  | "shared-skill"
  | "plugin-skill"
  | "native-skill"
  | "native-command"

export interface AgentCommandInventory {
  agent: string
  commands: SlashCommand[]
}

export interface ExtensionEntry {
  key: string
  name: string
  description: string | null
  source: string
  origin: string
  kind: ExtensionEntryKind
  agents: string[]
}

function entryKind(command: SlashCommand): ExtensionEntryKind {
  if (command.source === "mycockpit") return "shared-skill"
  if (command.source === "plugin") return "plugin-skill"
  return command.kind === "skill" ? "native-skill" : "native-command"
}

/** União do inventário efetivo por adapter. A chave inclui origem e fonte para
 * não fundir dois artefatos homônimos que têm ciclo de vida diferente. */
export function mergeExtensionEntries(
  inventories: AgentCommandInventory[],
): ExtensionEntry[] {
  const entries = new Map<string, ExtensionEntry>()
  for (const inventory of inventories) {
    for (const command of inventory.commands) {
      const key = [command.source, command.origin, command.kind, command.name].join(":")
      const existing = entries.get(key)
      if (existing) {
        if (!existing.agents.includes(inventory.agent)) {
          existing.agents.push(inventory.agent)
        }
        continue
      }
      entries.set(key, {
        key,
        name: command.name,
        description: command.description,
        source: command.source,
        origin: command.origin,
        kind: entryKind(command),
        agents: [inventory.agent],
      })
    }
  }
  return [...entries.values()]
    .map((entry) => ({ ...entry, agents: [...entry.agents].sort() }))
    .sort((a, b) => {
      const shared = Number(b.kind === "shared-skill") - Number(a.kind === "shared-skill")
      return shared || a.name.localeCompare(b.name)
    })
}

export function extensionKindLabel(kind: ExtensionEntryKind): string {
  if (kind === "shared-skill") return "skill da Frota"
  if (kind === "plugin-skill") return "skill de plugin"
  if (kind === "native-skill") return "skill nativa"
  return "comando nativo"
}
