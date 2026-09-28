// A fileira de destinos dos avisos de cota vazava do cartão quando a conversa
// ficava estreita (arquivo aberto ao lado): o grupo tinha `shrink-0` e ficava
// na largura natural. Ele cabe no cartão e os destinos descem de linha.
import { describe, expect, it } from "vitest"

const FONTES = import.meta.glob(["./CotaPertoBanner.tsx", "./ContinuityBanner.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

describe("grupo de destinos dos avisos de cota", () => {
  it("cabe na largura do cartão e quebra linha, nos dois avisos", () => {
    expect(Object.keys(FONTES)).toHaveLength(2)
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      const grupo = fonte.match(/role="group"[\s\S]{0,200}?className="([^"]+)"/)?.[1] ?? ""
      expect(grupo, arquivo).toContain("flex-wrap")
      expect(grupo, arquivo).toContain("max-w-full")
      expect(grupo, arquivo).not.toContain("shrink-0")
    }
  })
})
