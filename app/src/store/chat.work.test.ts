import { describe, expect, it } from "vitest"
import { markOrphanedProcesses, type ChatItem } from "./chat"

describe("processos gerenciados no replay", () => {
  it("não reapresenta como vivo um PID de uma instância anterior", () => {
    const items: ChatItem[] = [
      {
        kind: "tool",
        id: "p1",
        name: "ManagedProcess",
        input: { command: "pnpm dev" },
        managedProcess: {
          id: "proc-1",
          runId: "run-1",
          convId: "conv-1",
          label: "Servidor",
          command: "pnpm dev",
          cwd: "/repo",
          pid: 123,
          status: "running",
          exitCode: null,
          output: "ready",
          startedAt: 1,
          updatedAt: 1,
        },
      },
    ]
    const [process] = markOrphanedProcesses(items)
    expect(process.kind).toBe("tool")
    if (process.kind !== "tool") throw new Error("esperava tool")
    expect(process.managedProcess?.status).toBe("orphaned")
    expect(process.result?.ok).toBe(false)
    expect(process.result?.text).toContain("perdeu o controle")
  })

  it("não altera processo já encerrado", () => {
    const item: ChatItem = {
      kind: "tool",
      id: "p1",
      name: "ManagedProcess",
      input: {},
      managedProcess: {
        id: "proc-1",
        runId: "run-1",
        convId: "conv-1",
        label: "Teste",
        command: "true",
        cwd: "/repo",
        pid: 123,
        status: "exited",
        exitCode: 0,
        output: "",
        startedAt: 1,
        updatedAt: 2,
      },
    }
    expect(markOrphanedProcesses([item])[0]).toBe(item)
  })
})
