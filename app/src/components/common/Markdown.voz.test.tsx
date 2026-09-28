import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Markdown } from "./Markdown"

describe("a voz da fala no Markdown (G8)", () => {
  it("narração sai um tom abaixo: 13 e cor secundária", () => {
    const html = renderToStaticMarkup(createElement(Markdown, { text: "Vou olhar o parser.", voz: "narracao" }))
    expect(html).toContain("text-[13px]")
    expect(html).toContain("text-muted-foreground")
  })

  it("sem voz, a fala fica como sempre foi", () => {
    const html = renderToStaticMarkup(createElement(Markdown, { text: "A diferença eram 4 compras parceladas." }))
    expect(html).toContain("text-[14px]")
    expect(html).toContain("text-foreground")
  })
})
