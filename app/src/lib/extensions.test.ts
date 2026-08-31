import { describe, expect, it } from "vitest"
import { mergeExtensionEntries } from "@/lib/extensions"
import type { SlashCommand } from "@/lib/sources"

function command(patch: Partial<SlashCommand> = {}): SlashCommand {
  return {
    name: "review",
    description: "Revise o diff",
    kind: "command",
    origin: "project",
    source: "mycockpit",
    body: "passos",
    ...patch,
  }
}

describe("inventário unificado de extensões", () => {
  it("uma skill da Frota aparece uma vez com todos os adapters que a recebem", () => {
    const shared = command()
    expect(
      mergeExtensionEntries([
        { agent: "engine-b", commands: [shared] },
        { agent: "engine-a", commands: [shared] },
      ]),
    ).toEqual([
      {
        key: "mycockpit:project:command:review",
        name: "review",
        description: "Revise o diff",
        source: "mycockpit",
        origin: "project",
        kind: "shared-skill",
        agents: ["engine-a", "engine-b"],
      },
    ])
  })

  it("não chama convenção nativa de agnóstica", () => {
    const entries = mergeExtensionEntries([
      {
        agent: "engine",
        commands: [
          command({ source: "claude", kind: "skill" }),
          command({ name: "triage", source: "codex", origin: "global" }),
        ],
      },
    ])
    expect(entries.map((entry) => entry.kind)).toEqual([
      "native-skill",
      "native-command",
    ])
  })

  it("skill de plugin continua agnóstica e preserva o namespace", () => {
    const entries = mergeExtensionEntries([
      {
        agent: "engine",
        commands: [
          command({
            name: "acme.quality:review",
            source: "plugin",
            kind: "skill",
            origin: "global",
          }),
        ],
      },
    ])
    expect(entries[0]).toMatchObject({
      name: "acme.quality:review",
      kind: "plugin-skill",
      source: "plugin",
    })
  })
})
