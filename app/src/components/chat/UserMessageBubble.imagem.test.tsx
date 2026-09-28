import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Attachment } from "@/lib/attachments"
import { UserMessageBubble } from "./UserMessageBubble"

const img = (path: string, name: string): Attachment => ({ path, name, kind: "image", mime: "image/png", bytes: 42 })

describe("a mensagem enviada com imagem no texto (G3)", () => {
  it("a referência vira a ficha com número e nome, no lugar dela", () => {
    const html = renderToStaticMarkup(
      createElement(UserMessageBubble, {
        itemId: "u1",
        text: "Compare [imagem 1] com [imagem 2]",
        imagens: [img("attachments/c1/a.png", "dashboard-atual.png"), img("attachments/c1/b.png", "referencia-nubank.png")],
      }),
    )
    expect(html).toContain("1 · dashboard-atual.png")
    expect(html).toContain("2 · referencia-nubank.png")
    expect(html).not.toContain("[imagem 1]")
  })

  it("sem imagens, o texto sai como sempre", () => {
    const html = renderToStaticMarkup(createElement(UserMessageBubble, { itemId: "u2", text: "veja [imagem 1]" }))
    expect(html).toContain("veja [imagem 1]")
  })
})
