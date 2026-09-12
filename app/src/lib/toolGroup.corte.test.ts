import { describe, expect, it } from "vitest"
import { describeToolGroup, summarizeToolGroup } from "@/lib/toolGroup"

// Nomes REAIS das ações do turno cortado em 09/09/2026 (SQLite do app).
const concluida = { name: "Bash", input: { command: "psql -c 'select 1'" }, result: { ok: true } }
const cortada = { name: "process_poll", input: {}, result: { ok: false, interrupted: true as const } }
const falhou = { name: "Bash", input: { command: "false" }, result: { ok: false } }

describe("grupo com ação cortada por você (ADR-180)", () => {
  it("parou não é falha: estado próprio, rótulo 'parou'", () => {
    const view = summarizeToolGroup([concluida, cortada])
    expect(view.state).toBe("stopped")
    expect(view.label).toMatch(/^1 de 2 parou · /)
    expect(view.label).not.toMatch(/falh/)
  })

  it("o digest do cabeçalho não conta a cortada como falha", () => {
    const digest = describeToolGroup([concluida, cortada])
    expect(digest.failed).toBe(0)
    expect(digest.state).toBe("stopped")
    expect(digest.label).toMatch(/parou/)
  })

  it("ação única cortada nomeia a si mesma", () => {
    expect(summarizeToolGroup([cortada]).label).toMatch(/ parou$/)
  })

  it("falha de verdade continua vencendo o corte", () => {
    const digest = describeToolGroup([falhou, cortada])
    expect(digest.state).toBe("error")
    expect(digest.failed).toBe(1)
  })

  it("grupo sem corte segue igual", () => {
    expect(summarizeToolGroup([concluida]).state).toBe("ok")
  })
})

describe("grupo com trabalho em background interrompido sem desfecho (ADR-182)", () => {
  const bashSpawn = {
    name: "Bash",
    input: { command: "./scripts/build.sh test" },
    toolId: "toolu-bash",
    result: { ok: true },
  }
  const deferredInterrompido = {
    name: "DeferredWork",
    input: { name: "Build test app in background", kind: "bash" },
    toolId: "deferred:b3pbaal2v",
    deferred: { id: "b3pbaal2v", toolUseId: "toolu-bash" },
    result: { ok: false, interrupted: true as const },
  }

  it("trabalho diferido interrompido gera estado stopped, nunca 1 de N falhou", () => {
    const digest = describeToolGroup([bashSpawn, deferredInterrompido])
    expect(digest.failed).toBe(0)
    expect(digest.state).toBe("stopped")
    expect(digest.label).toMatch(/parou/)
    expect(digest.label).not.toMatch(/falh/)
  })
})

