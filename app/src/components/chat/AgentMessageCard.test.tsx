import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { AgentMessageCard } from "./AgentMessageCard"

describe("<AgentMessageCard>", () => {
  it("renderiza a prosa do agent dentro de uma superfície de cartão delimitada", () => {
    const html = renderToStaticMarkup(
      createElement(AgentMessageCard, {
        text: "Aqui está o resumo solicitado.",
      }),
    )

    expect(html).toContain("agent-message-card")
    expect(html).toContain("Aqui está o resumo solicitado.")
    expect(html).toContain("bg-card")
    expect(html).toContain("border-border/40")
  })
})
