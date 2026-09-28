// Onde a barra da seleção aparece. Âncora colhida do print de 27/09: a
// seleção terminava na linha "7. Maestri Remote (App Móvel Companion)", e a
// barra antiga, embaixo, cobria "mantém o estado…" da linha seguinte.
import { describe, expect, it } from "vitest"
import { posicaoDaBarra } from "./barra-de-selecao"

const JANELA = { largura: 1440, altura: 900 }

describe("posição da barra de seleção", () => {
  it("fica acima da última linha selecionada, sem cobrir o texto seguinte", () => {
    const ancora = { right: 327, top: 172, bottom: 192 }
    const { top } = posicaoDaBarra(ancora, JANELA)
    expect(top + 28).toBeLessThanOrEqual(ancora.top)
  })

  it("sem espaço em cima, desce para baixo da seleção", () => {
    const ancora = { right: 327, top: 10, bottom: 30 }
    expect(posicaoDaBarra(ancora, JANELA).top).toBe(36)
  })

  it("não vaza da janela pela direita nem pela esquerda", () => {
    expect(posicaoDaBarra({ right: 1440, top: 400, bottom: 420 }, JANELA).left).toBe(1440 - 6 - 96)
    expect(posicaoDaBarra({ right: 4, top: 400, bottom: 420 }, JANELA).left).toBe(6)
  })
})
