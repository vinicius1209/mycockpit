import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import { settleOrphanedTool, settleTerminalTools } from "./terminalTools"

const INCIDENT_TOOL: ChatItem = {
  kind: "tool",
  id: "330585d6-21f1-4fd5-a5f6-63647be48bce",
  name: "run_command",
  input: {},
  toolId: "agy-step-94",
  ts: 1_788_045_262_103,
  activityAt: 1_788_045_262_103,
}

describe("settleTerminalTools", () => {
  it("interrompe a ferramenta real que ficou pendente quando a ponte morreu", () => {
    const items: ChatItem[] = [
      { kind: "user", id: "u1", text: "abra o mock" },
      INCIDENT_TOOL,
    ]
    const settled = settleTerminalTools(items, "cancelled", 1_788_047_000_000)
    expect(settled[1]).toMatchObject({
      kind: "tool",
      activityAt: 1_788_047_000_000,
      result: { ok: false, lines: 1 },
    })
  })

  it("não toca ferramenta concluída nem órfã de turno anterior", () => {
    const done = {
      ...INCIDENT_TOOL,
      result: { ok: true, text: "ok", lines: 1 },
    } satisfies ChatItem
    const items: ChatItem[] = [
      INCIDENT_TOOL,
      { kind: "user", id: "u2", text: "continue" },
      done,
    ]
    const settled = settleTerminalTools(items, "done", 20)
    expect(settled).toBe(items)
  })
})

describe("settleOrphanedTool", () => {
  it("não deixa o step 94 real reaparecer como ferramenta em execução no restore", () => {
    expect(settleOrphanedTool(INCIDENT_TOOL, 1_788_047_100_000)).toMatchObject({
      kind: "tool",
      toolId: "agy-step-94",
      activityAt: 1_788_047_100_000,
      result: {
        ok: false,
        text: expect.stringContaining("sem receber o desfecho"),
        lines: 1,
      },
    })
  })
})
