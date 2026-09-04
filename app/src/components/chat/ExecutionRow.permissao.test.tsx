import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

const { ExecutionRow } = await import("@/components/chat/ExecutionRow")

function render(
  over: Partial<React.ComponentProps<typeof ExecutionRow>> = {},
) {
  return renderToStaticMarkup(
    <ExecutionRow
      convAgent="claude-code"
      mode="padrao"
      {...over}
    />,
  )
}

describe("a faixa recua quando não há incompatibilidade", () => {
  it("não repete instrução operacional sobre o próximo envio", () => {
    expect(render()).not.toContain("próximo envio")
  })
})

describe("quem OBEDECE ao modo é a CLI da conversa, não o projeto", () => {
  it("Antigravity em Pede: a faixa avisa que o motor ignora o modo", () => {
    const html = render({ convAgent: "agy", mode: "padrao" })
    expect(html).toContain("Antigravity IGNORA este modo")
  })

  it("Claude Code em Pede: contrato cumprido, nenhuma nota", () => {
    expect(render({ convAgent: "claude-code", mode: "padrao" })).not.toContain("IGNORA")
  })

  it("conversa sem agent definido não inventa nota", () => {
    expect(render({ convAgent: null, mode: "padrao" })).not.toContain("IGNORA")
  })
})
