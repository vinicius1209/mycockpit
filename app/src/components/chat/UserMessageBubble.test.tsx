import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { UserMessageBubble } from "./UserMessageBubble"

describe("<UserMessageBubble>", () => {
  it("renderiza o texto do usuário e os botões de ação", () => {
    const html = renderToStaticMarkup(
      createElement(UserMessageBubble, {
        itemId: "msg-123",
        text: "Olá mundo, execute os testes",
      }),
    )

    expect(html).toContain("Olá mundo, execute os testes")
    expect(html).toContain('aria-label="Editar e reenviar"')
    expect(html).toContain('aria-label="Bifurcar conversa a partir daqui"')
    expect(html).toContain('aria-label="Copiar mensagem"')
  })
})
