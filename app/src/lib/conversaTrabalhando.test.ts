import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import {
  conversaTrabalhando,
  especialistaTrabalhando,
  motivoTrabalhando,
} from "./conversaTrabalhando"

function diferido(status: "running" | "completed" | "interrupted"): ChatItem {
  return {
    kind: "tool",
    id: "tool-1",
    name: "DeferredWork",
    input: {},
    ts: 1,
    deferred: {
      id: "task-1",
      toolUseId: "toolu-1",
      kind: "terminal",
      name: "Carga de produtos",
      status,
      summary: null,
      outputFile: null,
      tokens: null,
      startedAt: 1,
      updatedAt: 1,
    },
  }
}

function processo(status: "running" | "stopping" | "exited" | "failed"): ChatItem {
  return {
    kind: "tool",
    id: "tool-2",
    name: "ManagedProcess",
    input: {},
    ts: 1,
    managedProcess: {
      id: "proc-1",
      runId: "run-1",
      convId: "c1",
      label: "Dev server",
      command: "vite",
      cwd: "/repo",
      pid: 1234,
      status,
      exitCode: null,
      output: "",
      startedAt: 1,
      updatedAt: 1,
    },
  }
}

// 26/09/2026: a Íris dando parecer, e a barra lateral sem sinal nenhum.
describe("quem trabalha na conversa (ADR-267)", () => {
  it("turno do executor ou parecer de especialista contam; nada, não", () => {
    expect(conversaTrabalhando({ running: true })).toBe(true)
    expect(conversaTrabalhando({ running: false, finalizing: true })).toBe(true)
    expect(conversaTrabalhando({ running: false, advising: { id: "iris", name: "Íris" } })).toBe(true)
    expect(conversaTrabalhando({ running: false, advising: null })).toBe(false)
  })

  it("trabalhos diferidos ou processos em background vivos contam", () => {
    expect(conversaTrabalhando({ running: false, items: [diferido("running")] })).toBe(true)
    expect(conversaTrabalhando({ running: false, items: [diferido("completed")] })).toBe(false)
    expect(conversaTrabalhando({ running: false, items: [processo("running")] })).toBe(true)
    expect(conversaTrabalhando({ running: false, items: [processo("stopping")] })).toBe(true)
    expect(conversaTrabalhando({ running: false, items: [processo("exited")] })).toBe(false)
  })

  it("o hover diz o nome do especialista só quando é o parecer que trabalha", () => {
    expect(especialistaTrabalhando({ running: false, advising: { id: "iris", name: "Íris" } })).toBe("Íris")
    expect(especialistaTrabalhando({ running: true, advising: null })).toBeNull()
  })

  it("motivoTrabalhando descreve especialista e trabalhos em segundo plano", () => {
    expect(motivoTrabalhando({ running: true })).toBeNull()
    expect(motivoTrabalhando({ running: false, advising: { id: "iris", name: "Íris" } })).toBe("Íris está dando um parecer")
    expect(motivoTrabalhando({ running: false, items: [diferido("running")] })).toBe("Trabalho em segundo plano rodando")
    expect(
      motivoTrabalhando({
        running: false,
        items: [diferido("running"), processo("running")],
      }),
    ).toBe("2 trabalhos em segundo plano rodando")
    expect(motivoTrabalhando({ running: false, items: [diferido("completed")] })).toBeNull()
  })
})

