import { describe, expect, it } from "vitest"
import { validConversationMapPins } from "./conversationMaps"

describe("pins do mapa da conversa", () => {
  it("aceita somente texto normalizado, limitado e uma revisão válida", () => {
    expect(
      validConversationMapPins({
        schemaVersion: 1,
        revision: 3,
        currentFocus: { id: "foco", text: "Validar a integração", pinnedAt: 10 },
        constraints: [
          { id: "c1", text: "Preservar o trabalho paralelo", pinnedAt: 11 },
        ],
      }),
    ).toBe(true)
  })

  it("rejeita payload corrompido antes de persistir", () => {
    expect(
      validConversationMapPins({
        schemaVersion: 1,
        revision: 1,
        constraints: Array.from({ length: 11 }, (_, index) => ({
          id: String(index),
          text: "restrição",
          pinnedAt: index,
        })),
      }),
    ).toBe(false)
    expect(
      validConversationMapPins({
        schemaVersion: 1,
        revision: 1,
        constraints: [{ id: "c", text: " texto com borda", pinnedAt: 1 }],
      }),
    ).toBe(false)
  })
})
