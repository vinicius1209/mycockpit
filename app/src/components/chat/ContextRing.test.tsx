import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ContextRingView } from "./ContextRing"
import { emptyConv, type ConvState } from "@/store/chat"

function render(patch: Partial<ConvState>) {
  return renderToStaticMarkup(
    <ContextRingView
      conv={{
        ...emptyConv("p"),
        agent: "codex",
        model: "gpt-5.6-sol",
        ...patch,
      }}
      initiallyOpen
    />,
  )
}

describe("ContextRing", () => {
  it("explica a última chamada contra a janela efetiva do runtime", () => {
    const html = render({
      contextBasis: "last_call",
      contextTokens: 211_547,
      contextWindow: 258_400,
    })
    expect(html).toContain("82%")
    expect(html).toContain("211.547")
    expect(html).toContain("258.400")
    expect(html).toContain("janela informada pelo agent")
    expect(html).toContain("Última chamada")
  })

  it("contradição oculta o percentual em vez de fabricar 100% e 1M", () => {
    const html = render({
      contextBasis: "last_call",
      contextTokens: 1_540_542,
      contextWindow: 258_400,
    })
    expect(html).toContain("1.540.542")
    expect(html).toContain("percentual foi ocultado")
    expect(html).not.toContain(">100%<")
    expect(html).not.toContain("1.000.000")
  })

  it("falha da fonte diz por que o total do turno não será usado", () => {
    const html = render({ contextBasis: "unavailable" })
    expect(html).toContain("Medição")
    expect(html).toContain("Indisponível")
    expect(html).toContain("total processado no turno não é usado como contexto")
  })

  it("janela de catálogo aparece explicitamente como estimada", () => {
    const html = render({
      agent: "claude-code",
      model: "claude-sonnet",
      contextBasis: "last_call",
      contextTokens: 100_000,
    })
    expect(html).toContain("≈ 200.000")
    expect(html).toContain("janela estimada pelo catálogo")
  })
})
