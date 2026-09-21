import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("@/store/presets", () => ({
  usePresets: Object.assign(
    (seletor: (s: unknown) => unknown) =>
      seletor({
        list: [
          { id: "projeto:aline", name: "Aline" },
          { id: "projeto:iris", name: "Íris" },
        ],
      }),
    { getState: () => ({ list: [] }) },
  ),
}))

import { MentionText } from "./UserMessageBubble"

describe("o @nome no fio abre o especialista", () => {
  it("persona conhecida vira botão com o nome no título", () => {
    const html = renderToStaticMarkup(
      <MentionText text="@Íris da uma olhada e @Aline confere depois" />,
    )
    expect(html).toContain('title="Ver Íris"')
    expect(html).toContain('title="Ver Aline"')
    expect((html.match(/<button/g) ?? []).length).toBe(2)
  })

  it("persona que não existe mais continua legível, só não clicável", () => {
    const html = renderToStaticMarkup(<MentionText text="@Fulano me ajuda" />)
    expect(html).toContain("@Fulano")
    expect(html).not.toContain("<button")
  })

  it("texto sem menção não vira nada além de texto", () => {
    const html = renderToStaticMarkup(<MentionText text="nenhuma menção aqui" />)
    expect(html).not.toContain("<button")
    expect(html).toContain("nenhuma menção aqui")
  })
})
