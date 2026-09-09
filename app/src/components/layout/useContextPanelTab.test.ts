// Precedência da aba do painel direito.
//
// Regressão de 09/09/2026: quem estava no explorador de arquivos perdia a aba a
// cada envio. O painel pulava pra "alteracoes" ao entrar em run e zerava o
// próprio controle no fim do turno, então o pulo "uma vez" reacontecia no envio
// seguinte, e no seguinte. "Uma vez" que se repete todo turno é sequestro.

import { beforeEach, describe, expect, it } from "vitest"
import {
  _resetAbaEscolhidaForTests,
  abaFoiEscolhida,
  abaSugerida,
  registrarEscolhaDeAba,
} from "./useContextPanelTab"

beforeEach(() => _resetAbaEscolhidaForTests())

describe("precedência da aba do painel direito", () => {
  it("sem escolha sua, a sugestão do app vale", () => {
    // Quem nunca tocou na barra não tem preferência a preservar: ao entrar em
    // run, ir pra Alterações é ajuda, não atropelo.
    expect(abaSugerida("conversa", "alteracoes", false)).toBe("alteracoes")
  })

  it("depois que você escolhe, a sugestão não move nada", () => {
    expect(abaSugerida("arquivos", "alteracoes", true)).toBe("arquivos")
  })

  it("escolher a MESMA aba que o app sugeriria também trava", () => {
    // Senão o app voltaria a mandar só porque desta vez concordou com você.
    expect(abaSugerida("alteracoes", "alteracoes", true)).toBe("alteracoes")
    expect(abaSugerida("alteracoes", "conversa", true)).toBe("alteracoes")
  })

  it("o gesto é o que trava, e ele não se desfaz sozinho", () => {
    expect(abaFoiEscolhida()).toBe(false)
    registrarEscolhaDeAba()
    expect(abaFoiEscolhida()).toBe(true)
    // Nenhum fim de turno reabre a porta: era exatamente isso que o
    // `jumpedOnRun` fazia ao zerar em todo `!running`.
    registrarEscolhaDeAba()
    expect(abaFoiEscolhida()).toBe(true)
  })
})
