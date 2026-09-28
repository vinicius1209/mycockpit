import { beforeEach, describe, expect, it } from "vitest"
import type { UsageSnapshot } from "@/lib/usageWindow"
import { useUsage } from "./usage"

const snap = (usado: number, fetchedAt: number): UsageSnapshot => ({
  agent: "claude-code",
  source: "statusline",
  windows: [{ id: "5h", label: "5 h", usedPercent: usado, resetsAt: 1_786_557_000, windowMinutes: 300 }],
  planType: null,
  fetchedAt,
})

beforeEach(() => useUsage.setState({ byAgent: {}, anterior: {}, failures: {} }))

describe("a leitura anterior do medidor", () => {
  it("a leitura nova empurra a atual para anterior, e é com as duas que o ritmo existe", () => {
    useUsage.getState().ingest(snap(60, 1_000))
    expect(useUsage.getState().anterior["claude-code"]).toBeUndefined()
    useUsage.getState().ingest(snap(78, 2_000))
    expect(useUsage.getState().anterior["claude-code"]?.windows[0].usedPercent).toBe(60)
    expect(useUsage.getState().byAgent["claude-code"]?.windows[0].usedPercent).toBe(78)
  })

  it("a mesma leitura chegando de novo não apaga a anterior", () => {
    useUsage.getState().ingest(snap(60, 1_000))
    useUsage.getState().ingest(snap(78, 2_000))
    useUsage.getState().ingest(snap(78, 2_000))
    expect(useUsage.getState().anterior["claude-code"]?.windows[0].usedPercent).toBe(60)
  })
})
