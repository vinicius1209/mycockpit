import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentEvent } from "@/lib/agent"
import type { ItemReducible } from "@/store/chat"
import capture from "@/test/agy-runner-1.2.2.json"

describe("stream real do Agy 1.2.2 através do runner Rust", () => {
  beforeEach(() => vi.resetModules())

  it("fecha ferramentas, preserva o recibo e não transforma saída truncada em prosa", async () => {
    const { reduceItems } = await import("@/store/chat")
    let state: ItemReducible = {
      items: [], streamingTextId: null, model: null, sessionId: null,
      startedAt: null, contextTokens: undefined,
    }
    const events = capture as AgentEvent[]
    events.forEach((event, i) => {
      state = { ...state, ...reduceItems(state, event, undefined, 1_789_338_600_000 + i) }
    })
    const tools = state.items.filter((item) => item.kind === "tool")
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.every((item) => item.result?.ok === true)).toBe(true)
    const texts = state.items.filter((item) => item.kind === "text").map((item) => item.text)
    expect(texts.join("")).toContain("FROTA_E2E_VOLUME_DONE")
    expect(texts.join("")).toContain("b3ccbb785193599e4fcef14b9c218b92fe70b18981f525eff0c3f7cf9600147c")
    expect(texts.join("")).not.toContain("SYSTEM_MESSAGE")
    expect(texts.join("").length).toBeLessThan(1000)
    expect(state.streamingTextId).toBeNull()
    expect(state.items.filter((item) => item.kind === "result")).toHaveLength(1)
  })
})
