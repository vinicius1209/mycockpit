import { describe, expect, it } from "vitest"
import { turnControl } from "./runLifecycle"

describe("ciclo terminal do turno linear", () => {
  it.each([
    { event: { type: "cancelled" } as const, nome: "interrompido" },
    {
      event: { type: "error", message: "falha real do processo" } as const,
      nome: "erro",
    },
  ])("mantém finalizing depois de $nome até o done", ({ event }) => {
    expect(turnControl(event)).toMatchObject({
      running: false,
      finalizing: true,
      runId: null,
    })
  })

  it("só libera a conversa no done que fecha o stream", () => {
    expect(turnControl({ type: "done", code: 130 })).toMatchObject({
      running: false,
      finalizing: false,
      runId: null,
    })
  })
})
