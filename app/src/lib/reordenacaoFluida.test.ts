import { describe, expect, it } from "vitest"
import { deslocamentos, duracaoDoToken } from "./reordenacaoFluida"

const mapa = (pares: [string, number][]) => new Map(pares)

describe("deslocamento das linhas na reordenação", () => {
  it("quem desceu é puxado para cima, e quem subiu é empurrado para baixo", () => {
    // [a,b,c] vira [b,c,a]: a desce 64px, b e c sobem 32px cada.
    const antes = mapa([["a", 0], ["b", 32], ["c", 64]])
    const depois = mapa([["b", 0], ["c", 32], ["a", 64]])
    expect(deslocamentos(antes, depois)).toEqual(
      mapa([["b", 32], ["c", 32], ["a", -64]]),
    )
  })

  it("linha que não saiu do lugar não entra: não há o que animar", () => {
    const antes = mapa([["a", 0], ["b", 32]])
    const depois = mapa([["a", 0], ["b", 32]])
    expect(deslocamentos(antes, depois).size).toBe(0)
  })

  it("linha sem posição anterior não anima (ADR-179: chega pronta)", () => {
    // Conversa nova, ou troca de projeto: ids que não existiam antes.
    const antes = mapa([["a", 0]])
    const depois = mapa([["nova", 0], ["a", 32]])
    expect(deslocamentos(antes, depois)).toEqual(mapa([["a", -32]]))
  })

  it("linha que sumiu não aparece na saída", () => {
    const antes = mapa([["a", 0], ["b", 32]])
    const depois = mapa([["a", 0]])
    expect(deslocamentos(antes, depois).size).toBe(0)
  })
})

describe("duração vem do token, não de número solto (§6)", () => {
  it("lê ms e s", () => {
    expect(duracaoDoToken("200ms")).toBe(200)
    expect(duracaoDoToken(" 320ms ")).toBe(320)
    expect(duracaoDoToken("0.32s")).toBe(320)
  })

  it("token ausente ou ilegível cai no padrão, nunca em zero", () => {
    // Zero seria "sem animação" disfarçado de animação: o §6 já foi mordido por
    // `var(--dur)` sem definição, que vira transição instantânea sem erro.
    expect(duracaoDoToken(undefined)).toBe(200)
    expect(duracaoDoToken("")).toBe(200)
    expect(duracaoDoToken("rápido")).toBe(200)
    expect(duracaoDoToken("0ms")).toBe(200)
    expect(duracaoDoToken("-5ms")).toBe(200)
  })
})
