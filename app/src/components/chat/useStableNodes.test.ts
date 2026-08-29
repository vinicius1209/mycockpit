import { describe, expect, it } from "vitest"
import {
  CHAT_WINDOW,
  JANELA_INICIAL,
  hiddenNodeCount,
} from "./useStableNodes"

describe("hiddenNodeCount", () => {
  it("fio curto não esconde nada", () => {
    expect(hiddenNodeCount(10, false)).toBe(0)
  })

  it("fio longo esconde o começo e mantém a CAUDA", () => {
    // A cauda é o que importa: você aterrissa no fim.
    expect(hiddenNodeCount(547, false)).toBe(547 - CHAT_WINDOW)
  })

  it("`showAll` revela o fio inteiro, e a janela nem entra na conta", () => {
    expect(hiddenNodeCount(547, true)).toBe(0)
    expect(hiddenNodeCount(547, true, JANELA_INICIAL)).toBe(0)
  })

  it("a janela é parâmetro: a primeira pintura esconde MAIS", () => {
    // Montagem em duas etapas. Sem o parâmetro, a única forma de encurtar a
    // primeira pintura seria baixar o teto — e aí o fio perderia alcance pra
    // sempre, não só no primeiro frame.
    const primeira = hiddenNodeCount(547, false, JANELA_INICIAL)
    const depois = hiddenNodeCount(547, false, CHAT_WINDOW)
    expect(primeira).toBeGreaterThan(depois)
    expect(547 - primeira).toBe(JANELA_INICIAL)
    expect(547 - depois).toBe(CHAT_WINDOW)
  })

  it("quem não pede janela enxerga o teto de sempre", () => {
    // O TurnScrubber lê a MESMA dobra e não participa da montagem progressiva:
    // se o default mudasse, a régua passaria a cobrir uma janela diferente da
    // do transcript e os pips deixariam de bater com os turnos pintados.
    expect(hiddenNodeCount(547, false)).toBe(hiddenNodeCount(547, false, CHAT_WINDOW))
  })

  it("a janela inicial cabe numa tela e é menor que o teto", () => {
    expect(JANELA_INICIAL).toBeLessThan(CHAT_WINDOW)
    expect(JANELA_INICIAL).toBeGreaterThan(0)
  })
})
