import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

const { ExecutionRow } = await import("@/components/chat/ExecutionRow")

function render(
  over: Partial<React.ComponentProps<typeof ExecutionRow>> = {},
) {
  return renderToStaticMarkup(
    <ExecutionRow
      running={false}
      convAgent="claude-code"
      mode="padrao"
      {...over}
    />,
  )
}

describe("a faixa não mente sobre quando a troca passa a valer", () => {
  it("com turno em andamento, diz que a permissão vale no próximo envio", () => {
    expect(render({ running: true })).toContain(
      "Turno em andamento: a permissão vale a partir do próximo envio.",
    )
  })

  it("sem turno em andamento, o aviso não aparece", () => {
    expect(render({ running: false })).not.toContain("Turno em andamento")
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
