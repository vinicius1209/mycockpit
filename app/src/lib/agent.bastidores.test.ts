// ADR-200: a saída ao vivo de uma tool não entra no fio; vai para o painel.
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentEvent } from "@/lib/agent"

const h = vi.hoisted(() => ({ stream: [] as AgentEvent[] }))

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((e: AgentEvent) => void) | null = null
  },
  invoke: vi.fn(async (_cmd: string, args: Record<string, unknown>) => {
    const channel = args.onEvent as { onmessage: (e: AgentEvent) => void }
    for (const e of h.stream) channel.onmessage(e)
    return null
  }),
}))
vi.mock("@/lib/db", () => ({
  loadUsageBaseline: vi.fn(async () => null),
  saveUsageBaseline: vi.fn(),
}))

import { runAgent } from "@/lib/agent"
import { chaveDaSaida, useBastidores } from "@/store/bastidores"

beforeEach(() => {
  useBastidores.setState({ vistas: [], foco: 0, saidas: {} })
})

describe("tool_output no runAgent", () => {
  it("vai para os Bastidores e não chega ao reducer do fio", async () => {
    vi.useFakeTimers()
    h.stream = [
      { type: "tool", id: "item-cmd-1", name: "Bash", input: { command: "loop" }, parent_tool_id: null },
      { type: "tool_output", id: "item-cmd-1", text: "cx 2\n" },
      { type: "tool_output", id: "item-cmd-1", text: "fim\n" },
    ]
    const vistos: string[] = []
    await runAgent("r", "conv-1", "codex", null, null, "oi", "/repo", null, "padrao", [], (e) =>
      vistos.push(e.type),
    )
    vi.advanceTimersByTime(100)
    vi.useRealTimers()
    expect(vistos).toEqual(["tool"])
    expect(
      useBastidores.getState().saidas[chaveDaSaida("conv-1", "item-cmd-1")].linhas,
    ).toEqual(["cx 2", "fim"])
  })
})
