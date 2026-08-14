// ADR-033 — o `runAgent` é o ÚNICO ponto do app onde o baseline de usage
// acumulado entra (no invoke) e o acumulado devolvido sai (pro banco). Todas
// as superfícies que rodam agent passam por aqui, então este é o teste que
// impede uma delas de voltar a somar acumulados.
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentEvent } from "@/lib/agent"

const h = vi.hoisted(() => ({
  invokes: [] as Record<string, unknown>[],
  stream: [] as AgentEvent[],
  baselines: new Map<
    string,
    { input: number; cached_input: number; output: number }
  >(),
  loads: [] as { threadId: string; convId: string; agents: string[] }[],
}))

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((e: AgentEvent) => void) | null = null
  },
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd !== "run_agent") throw new Error(`invoke não mapeado: ${cmd}`)
    h.invokes.push(args)
    const channel = args.onEvent as { onmessage: (e: AgentEvent) => void }
    for (const e of h.stream) channel.onmessage(e)
    return null
  }),
}))

vi.mock("@/lib/db", () => ({
  loadUsageBaseline: vi.fn(
    async (threadId: string, convId: string, agents: string[]) => {
      h.loads.push({ threadId, convId, agents })
      return h.baselines.get(threadId) ?? null
    },
  ),
  saveUsageBaseline: vi.fn(
    async (
      threadId: string,
      _convId: string | null,
      usage: { input: number; cached_input: number; output: number },
    ) => {
      h.baselines.set(threadId, usage)
    },
  ),
}))

import { runAgent } from "@/lib/agent"

function result(cumulative: object | null): AgentEvent {
  return {
    type: "result",
    ok: true,
    text: null,
    cost_usd: 0.01,
    cost_source: "estimated",
    input_tokens: 17511,
    output_tokens: 6,
    cache_read: 17152,
    cache_creation: 0,
    ...(cumulative ? { cumulative_usage: cumulative } : {}),
  } as AgentEvent
}

async function run(
  resume: string | null,
  onEvent: (e: AgentEvent) => void = () => {},
  agent = "codex",
) {
  await runAgent(
    "run-1",
    "conv-1",
    agent,
    null,
    null,
    "oi",
    "/repo",
    resume,
    "padrao",
    [],
    onEvent,
  )
}

beforeEach(() => {
  h.invokes.length = 0
  h.stream.length = 0
  h.loads.length = 0
  h.baselines.clear()
})

describe("baseline de usage acumulado (ADR-033)", () => {
  it("thread nova não manda baseline e persiste o acumulado devolvido", async () => {
    h.stream = [
      { type: "session", session_id: "t-1", model: "gpt-5.6-sol", tools: 0 },
      result({ input: 17494, cached_input: 9984, output: 6 }),
    ]
    await run(null)
    expect(h.invokes[0].usageBaseline).toBeNull()
    expect(h.loads).toHaveLength(0)
    expect(h.baselines.get("t-1")).toEqual({
      input: 17494,
      cached_input: 9984,
      output: 6,
    })
  })

  it("turno seguinte manda o acumulado da thread como baseline", async () => {
    h.baselines.set("t-1", { input: 17494, cached_input: 9984, output: 6 })
    h.stream = [
      { type: "session", session_id: "t-1", model: "gpt-5.6-sol", tools: 0 },
      result({ input: 35005, cached_input: 27136, output: 12 }),
    ]
    await run("t-1")
    expect(h.invokes[0].usageBaseline).toEqual({
      input: 17494,
      cached_input: 9984,
      output: 6,
    })
    // A consulta é por capability, nunca por nome fixo de motor — e a prova é
    // que a lista CRESCEU sozinha quando o agy 1.1.13 passou a reportar
    // acumulado da conversa (medido 14/08/2026), sem tocar neste caminho.
    expect(h.loads[0].agents).toEqual(["codex", "agy"])
    expect(h.baselines.get("t-1")?.input).toBe(35005)
  })

  it("resume que falhou: o acumulado é guardado na thread REAL da sessão", async () => {
    h.baselines.set("t-antiga", { input: 500_000, cached_input: 400_000, output: 9000 })
    h.stream = [
      { type: "session", session_id: "t-nova", model: "gpt-5.6-sol", tools: 0 },
      result({ input: 17494, cached_input: 9984, output: 6 }),
    ]
    await run("t-antiga")
    expect(h.baselines.get("t-nova")?.input).toBe(17494)
    expect(h.baselines.get("t-antiga")?.input).toBe(500_000)
  })

  it("motor que reporta por turno não pede nem deixa baseline", async () => {
    h.stream = [
      { type: "session", session_id: "s-claude", model: "opus", tools: 3 },
      result(null),
    ]
    await run("s-claude", () => {}, "claude-code")
    expect(h.loads).toHaveLength(0)
    expect(h.invokes[0].usageBaseline).toBeNull()
    expect(h.baselines.size).toBe(0)
  })

  it("os eventos chegam intactos a quem chamou (o wrapper não engole nada)", async () => {
    const vistos: AgentEvent[] = []
    h.stream = [
      { type: "session", session_id: "t-1", model: "gpt-5.6-sol", tools: 0 },
      { type: "text", text: "oi" },
      result({ input: 100, cached_input: 10, output: 2 }),
    ]
    await run(null, (e: AgentEvent) => vistos.push(e))
    expect(vistos.map((e) => e.type)).toEqual(["session", "text", "result"])
  })
})
