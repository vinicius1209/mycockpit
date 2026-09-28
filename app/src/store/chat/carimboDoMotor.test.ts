// O carimbo do motor no item de tool (ADR-280): a ação nasce com o motor do
// turno, e "quem alterou" não depende do motor ATUAL da conversa. O evento é o
// da captura de fases (codex 0.157.1), com um Edit do mesmo formato.
import { describe, expect, it } from "vitest"
import { reduceItems, type ItemReducible } from "@/store/chat"
import type { AgentEvent } from "@/lib/agent"

const T0 = 1_790_561_229_000
const base = (): ItemReducible => ({ items: [], streamingTextId: null, model: null, sessionId: null, startedAt: null, contextTokens: undefined })
const EDIT = { type: "tool", id: "exec-a07a17e8", name: "Edit", input: { file_path: "docs/PLAN.md" } } as AgentEvent

describe("carimbo do motor", () => {
  it("a ação nasce com o motor do turno que a fez", () => {
    const c = { ...base(), ...reduceItems(base(), EDIT, { agent: "codex", reqModel: null }, T0) }
    expect(c.items[0]).toMatchObject({ kind: "tool", name: "Edit", agent: "codex" })
  })

  it("sem contexto de run, o item não inventa motor", () => {
    const c = { ...base(), ...reduceItems(base(), EDIT, undefined, T0) }
    expect(c.items[0]).not.toHaveProperty("agent")
  })
})
