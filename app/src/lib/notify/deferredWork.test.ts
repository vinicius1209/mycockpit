import { beforeEach, describe, expect, it, vi } from "vitest"
import { maybeNotifyDeferredEvent, resetDeferredNotifiedKeysForTest } from "./deferredWork"
import type { AgentEvent } from "@/lib/agent"

const mockNotifyDeferredEnd = vi.fn()

vi.mock("@/lib/notify", () => ({
  notifyDeferredEnd: (args: unknown) => mockNotifyDeferredEnd(args),
}))

describe("maybeNotifyDeferredEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDeferredNotifiedKeysForTest()
  })

  it("não notifica quando o evento não é terminal (ex: running)", () => {
    const ev: AgentEvent = {
      type: "deferred_work",
      id: "task-1",
      tool_use_id: null,
      kind: "bash",
      name: "build test",
      status: "running",
      summary: null,
      output_file: "/tmp/test.log",
      progress: null,
    }
    maybeNotifyDeferredEvent("conv-1", ev)
    expect(mockNotifyDeferredEnd).not.toHaveBeenCalled()
  })

  it("notifica conclusão quando o evento é completed", () => {
    const ev: AgentEvent = {
      type: "deferred_work",
      id: "task-1",
      tool_use_id: null,
      kind: "bash",
      name: "build test",
      status: "completed",
      summary: "Compilação concluída",
      output_file: "/tmp/test.log",
      progress: null,
    }
    maybeNotifyDeferredEvent("conv-1", ev)
    expect(mockNotifyDeferredEnd).toHaveBeenCalledTimes(1)
    expect(mockNotifyDeferredEnd).toHaveBeenCalledWith({
      convId: "conv-1",
      name: "build test",
      status: "completed",
      summary: "Compilação concluída",
    })
  })

  it("deduplica evento repetido para a mesma tentativa e desfecho", () => {
    const ev: AgentEvent = {
      type: "deferred_work",
      id: "task-1",
      tool_use_id: null,
      kind: "bash",
      name: "build test",
      status: "completed",
      summary: "Compilação concluída",
      output_file: "/tmp/test.log",
      progress: null,
    }
    maybeNotifyDeferredEvent("conv-1", ev)
    maybeNotifyDeferredEvent("conv-1", ev)
    expect(mockNotifyDeferredEnd).toHaveBeenCalledTimes(1)
  })

  it("notifica interrupção quando o status é stopped", () => {
    const ev: AgentEvent = {
      type: "deferred_work",
      id: "task-2",
      tool_use_id: null,
      kind: "bash",
      name: "build test",
      status: "stopped",
      summary: "Processo parou",
      output_file: "/tmp/test.log",
      progress: null,
    }
    maybeNotifyDeferredEvent("conv-1", ev)
    expect(mockNotifyDeferredEnd).toHaveBeenCalledTimes(1)
    expect(mockNotifyDeferredEnd).toHaveBeenCalledWith({
      convId: "conv-1",
      name: "build test",
      status: "interrupted",
      summary: "Processo parou",
    })
  })

  it("ignora outros tipos de eventos", () => {
    const ev: AgentEvent = {
      type: "tool_result",
      id: "t1",
      ok: true,
      text: "ok",
      lines: 1,
    }
    maybeNotifyDeferredEvent("conv-1", ev)
    expect(mockNotifyDeferredEnd).not.toHaveBeenCalled()
  })
})
