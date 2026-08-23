import { describe, expect, it } from "vitest"
import { _baterJanela, janelaEpoca, subscribeJanela } from "./janelaViva"

describe("época da janela", () => {
  it("é ESTÁVEL entre batidas", () => {
    // `useSyncExternalStore` compara o snapshot por identidade: um valor novo a
    // cada leitura faria o React re-renderizar em loop.
    expect(janelaEpoca()).toBe(janelaEpoca())
  })

  it("muda quando a janela volta, e avisa quem assina", () => {
    let avisos = 0
    const parar = subscribeJanela(() => avisos++)
    const antes = janelaEpoca()
    _baterJanela()
    expect(janelaEpoca()).not.toBe(antes)
    expect(avisos).toBe(1)
    parar()
  })

  it("depois de cancelar, não avisa mais", () => {
    // Assinatura que sobrevive à tela é vazamento — mesmo contrato do
    // `minuteTick`.
    let avisos = 0
    subscribeJanela(() => avisos++)()
    _baterJanela()
    expect(avisos).toBe(0)
  })
})
