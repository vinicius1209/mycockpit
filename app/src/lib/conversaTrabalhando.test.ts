import { describe, expect, it } from "vitest"
import { conversaTrabalhando, especialistaTrabalhando } from "./conversaTrabalhando"

// 26/09/2026: a Íris dando parecer, e a barra lateral sem sinal nenhum.
describe("quem trabalha na conversa (ADR-267)", () => {
  it("turno do executor ou parecer de especialista contam; nada, não", () => {
    expect(conversaTrabalhando({ running: true })).toBe(true)
    expect(conversaTrabalhando({ running: false, advising: { id: "iris", name: "Íris" } })).toBe(true)
    expect(conversaTrabalhando({ running: false, advising: null })).toBe(false)
  })

  it("o hover diz o nome do especialista só quando é o parecer que trabalha", () => {
    expect(especialistaTrabalhando({ running: false, advising: { id: "iris", name: "Íris" } })).toBe("Íris")
    expect(especialistaTrabalhando({ running: true, advising: null })).toBeNull()
  })
})
