import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { NoteAttachments } from "./NoteAttachments"
import type { Attachment } from "@/lib/attachments"

describe("NoteAttachments", () => {
  const imagem: Attachment = {
    path: "attachments/notes/n1/foto1.png",
    name: "foto1.png",
    kind: "image",
    mime: "image/png",
    bytes: 1234,
  }

  const pdf: Attachment = {
    path: "attachments/notes/n1/documento.pdf",
    name: "documento.pdf",
    kind: "pdf",
    mime: "application/pdf",
    bytes: 9999,
  }

  it("renderiza miniatura de imagem como botão interativo de ampliação", () => {
    const html = renderToStaticMarkup(
      createElement(NoteAttachments, { attachments: [imagem] }),
    )
    expect(html).toContain("Ampliar imagem foto1.png")
    expect(html).toContain("cursor-zoom-in")
    expect(html).toContain('title="foto1.png (clique para ampliar)"')
  })

  it("renderiza botão de remoção quando onRemove é fornecido", () => {
    const html = renderToStaticMarkup(
      createElement(NoteAttachments, {
        attachments: [imagem],
        onRemove: () => {},
      }),
    )
    expect(html).toContain('aria-label="Remover foto1.png"')
  })

  it("renderiza anexo não-imagem sem botão de zoom", () => {
    const html = renderToStaticMarkup(
      createElement(NoteAttachments, { attachments: [pdf] }),
    )
    expect(html).toContain('title="documento.pdf"')
    expect(html).not.toContain("cursor-zoom-in")
    expect(html).not.toContain("Ampliar imagem documento.pdf")
  })
})
