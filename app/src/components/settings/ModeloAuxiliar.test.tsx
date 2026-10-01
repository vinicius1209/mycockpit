import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ModeloAuxiliar } from "./ModeloAuxiliar"

describe("ModeloAuxiliar", () => {
  it("com modelo desligado os quatro switches ficam desabilitados e desligados", () => {
    const html = renderToStaticMarkup(<ModeloAuxiliar helperModel={null} />)
    expect(html).toContain("Nome da conversa")
    expect(html).toContain("Recibo da notificação")
    expect(html).toContain("Sugestões do composer")
    expect(html).toContain("Lições")
    // switches com disabled
    const disabledCount = (html.match(/disabled/g) ?? []).length
    expect(disabledCount).toBeGreaterThanOrEqual(4)
    // todos desligados quando o modelo geral está desligado
    const uncheckedCount = (html.match(/aria-checked="false"/g) ?? []).length
    expect(uncheckedCount).toBe(4)
  })

  it("com modelo ativo os switches respeitam a configuração granular", () => {
    const html = renderToStaticMarkup(
      <ModeloAuxiliar
        helperModel="haiku"
        helperFeatures={{
          conversationTitle: true,
          turnReceipt: false,
          composerSuggestions: true,
          learningLessons: false,
        }}
      />,
    )
    // dois switches ligados (aria-checked="true") e dois desligados
    const checkedCount = (html.match(/aria-checked="true"/g) ?? []).length
    const uncheckedCount = (html.match(/aria-checked="false"/g) ?? []).length
    expect(checkedCount).toBe(2)
    expect(uncheckedCount).toBe(2)
  })
})
