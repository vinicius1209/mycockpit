import { describe, expect, it } from "vitest"
import {
  markOrphanedProcesses,
  useChat,
  type ChatItem,
  type ConvState,
} from "./chat"

function conv(): ConvState {
  return {
    projectId: "p1", agent: "codex", reqModel: null, effort: null,
    worktreePath: null, items: [], sessionId: null, model: null,
    streamingTextId: null, running: true, finalizing: false, runId: "r1",
    startedAt: 1, suggestions: [], suggesting: false,
  }
}

describe("processos gerenciados no replay", () => {
  it("anexa deltas por sequência e ignora repetição", () => {
    useChat.setState({ byId: { c1: conv() } })
    const process = {
      id: "p1", runId: "r1", convId: "c1", label: "Teste", command: "echo oi",
      cwd: "/repo", pid: 123, status: "running" as const, exitCode: null,
      output: "", startedAt: 1, updatedAt: 1,
    }
    useChat.getState().handleWorkEvent({ kind: "process_started", data: { process } })
    useChat.getState().handleWorkEvent({
      kind: "process_output",
      data: { convId: "c1", processId: "p1", stream: "stdout", seq: 1, line: "oi", updatedAt: 2 },
    })
    useChat.getState().handleWorkEvent({
      kind: "process_output",
      data: { convId: "c1", processId: "p1", stream: "stdout", seq: 1, line: "duplicada", updatedAt: 3 },
    })
    const item = useChat.getState().byId.c1.items[0]
    expect(item.kind === "tool" && item.managedProcess?.output).toBe("oi")
    expect(item.kind === "tool" && item.managedProcess?.outputSeq).toBe(1)
  })

  it("limita a cauda reconstruída mesmo ao receber muitos deltas grandes", () => {
    useChat.setState({ byId: { c1: conv() } })
    const process = {
      id: "p1", runId: "r1", convId: "c1", label: "Teste", command: "gera saída",
      cwd: "/repo", pid: 123, status: "running" as const, exitCode: null,
      output: "", startedAt: 1, updatedAt: 1,
    }
    useChat.getState().handleWorkEvent({ kind: "process_started", data: { process } })
    for (let seq = 1; seq <= 8; seq++) {
      useChat.getState().handleWorkEvent({
        kind: "process_output",
        data: {
          convId: "c1",
          processId: "p1",
          stream: "stdout",
          seq,
          line: `${seq}:${"x".repeat(64 * 1024 - 2)}`,
          updatedAt: seq + 1,
        },
      })
    }
    const item = useChat.getState().byId.c1.items[0]
    if (item.kind !== "tool") throw new Error("esperava tool")
    expect(item.managedProcess?.output.length).toBeLessThanOrEqual(256 * 1024)
    expect(item.managedProcess?.output).toContain("8:")
  })

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
