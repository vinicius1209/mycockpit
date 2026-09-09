// O SINAL DO PREPARO (ADR-169).
//
// Este arquivo existe por causa de uma medição, não de uma preferência: em
// 07/09/2026 o preflight de um envio custava de 3 a 5 segundos neste projeto, e
// o único feedback era o primário ficar cinza. O §6 do STYLEGUIDE manda spinner
// a partir de 1s, e espera longa com tela imóvel lê como TRAVAMENTO.
//
// A regra que estes testes seguram: enquanto o turno é montado, o botão de
// enviar diz que está montando — para quem vê a tela e para quem não vê.

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ComposerActions } from "./ComposerParts"

function render(props: Partial<Parameters<typeof ComposerActions>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(ComposerActions, {
      onFusion: () => {},
      onAttach: () => {},
      onSubmit: () => {},
      canSend: true,
      ...props,
    }),
  )
}

describe("ComposerActions · preparo do envio", () => {
  it("em repouso o primário é a SETA, sem sinal de trabalho", () => {
    const html = render()
    expect(html).not.toContain("preparo-spin")
    expect(html).toContain('aria-label="Enviar"')
    expect(html).not.toContain("aria-busy")
  })

  it("preparando, o primário troca a seta pelo círculo", () => {
    const html = render({ preparing: true })
    expect(html).toContain("preparo-spin")
    expect(html).toContain('aria-busy="true"')
  })

  it("o rótulo acessível conta a verdade: não anuncia 'Enviar' enquanto prepara", () => {
    const html = render({ preparing: true })
    expect(html).toContain('aria-label="Preparando o envio"')
    expect(html).not.toContain('aria-label="Enviar"')
  })

  it("o botão continua no MESMO degrau de controle: a fileira não dança", () => {
    const repouso = render()
    const preparo = render({ preparing: true })
    for (const html of [repouso, preparo]) {
      expect(html).toContain("size-8")
    }
  })

  it("com o turno RODANDO manda o Parar, não o preparo (um dono por vez)", () => {
    // `preparing` e `running` não coexistem no ciclo real (o preparo termina no
    // aceite), mas se coexistirem quem vence é o estado mais avançado — senão a
    // pessoa perde o botão de interromper.
    const html = render({ preparing: true, running: true })
    expect(html).toContain('aria-label="Parar"')
    expect(html).not.toContain("preparo-spin")
  })

  it("o preparo desabilita o envio sem esconder o controle", () => {
    const html = render({ preparing: true, canSend: false })
    expect(html).toContain("disabled")
    expect(html).toContain("preparo-spin")
  })
})
