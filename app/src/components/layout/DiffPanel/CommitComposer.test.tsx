import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { CommitComposer } from "./CommitComposer"

describe("CommitComposer", () => {
  it("renderiza campo de título com placeholder e contador de caracteres", () => {
    const html = renderToStaticMarkup(
      createElement(CommitComposer, {
        cwd: "/fake",
        stagedCount: 2,
        totalChanges: 5,
        onCommitted: vi.fn(),
      }),
    )
    expect(html).toContain("Mensagem do commit")
    expect(html).toContain("0/72")
    expect(html).toContain("Sugerir")
    expect(html).toContain("Criar commit (2)")
  })

  it("renderiza label de commit direto quando não há staged", () => {
    const html = renderToStaticMarkup(
      createElement(CommitComposer, {
        cwd: "/fake",
        stagedCount: 0,
        totalChanges: 5,
        onCommitted: vi.fn(),
      }),
    )
    expect(html).toContain("Criar commit")
  })
})
