// A nota diz em que pé está. O defeito que isto trava: a caixa de escrever
// promete "o agente vai ler", mas a entrega só acontece no PRÓXIMO envio — e
// antes disto, pendente e entregue eram pixel-a-pixel idênticas.
//
// `TurnNoteBlock` é seguro em SSR: só toca a store dentro do onClick, nunca no
// render (o container conectado teria o falso positivo do zustand v5 —
// useSyncExternalStore lê getInitialState em renderToStaticMarkup).

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TurnNoteBlock } from "./TurnNote"

const render = (props: { sent?: boolean }) =>
  renderToStaticMarkup(
    createElement(TurnNoteBlock, {
      convId: "c1",
      id: "n1",
      text: "faltou o caso vazio",
      ...props,
    }),
  )

describe("TurnNoteBlock", () => {
  it("pendente avisa que a entrega é no próximo envio", () => {
    const html = render({})
    expect(html).toContain("vai no próximo envio")
    expect(html).not.toContain("entregue")
  })

  it("entregue diz que chegou ao agente", () => {
    const html = render({ sent: true })
    expect(html).toContain("entregue ao agente")
    expect(html).not.toContain("próximo envio")
  })

  it("o texto da nota aparece nos dois estados", () => {
    expect(render({})).toContain("faltou o caso vazio")
    expect(render({ sent: true })).toContain("faltou o caso vazio")
  })

  it("os dois estados têm matiz DIFERENTE (o §6 proíbe animar isto)", () => {
    // Nota pendente não termina sozinha: espera VOCÊ mandar a próxima
    // mensagem. Movimento é pro que está vivo e acaba por conta própria, então
    // a diferença tem que estar na cor — mesma régua da falha, que já pulsou
    // uma vez e virou matiz próprio.
    expect(render({})).not.toBe(render({ sent: true }))
    expect(render({})).toContain("bg-secondary/25")
    expect(render({ sent: true })).toContain("bg-secondary/15")
  })
})
