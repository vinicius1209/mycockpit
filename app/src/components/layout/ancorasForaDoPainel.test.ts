// O painel direito anima `transform` (`reveal-right`), e isso o faz bloco
// contentor de todo `position: fixed` de dentro. O menu e o cartão da árvore
// ancoram num elemento `fixed`: montados no painel, abriam fora da tela (build
// #454). Eles vão para o `body` por portal, e esta trava segura isso.
import { describe, expect, it } from "vitest"

const FONTES = import.meta.glob(["./MenuDeArquivo.tsx", "./CartaoDaArvore.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

describe("âncoras fixas da árvore", () => {
  it("o menu e o cartão saem do painel por portal para o body", () => {
    expect(Object.keys(FONTES)).toHaveLength(2)
    for (const [arquivo, fonte] of Object.entries(FONTES)) {
      expect(fonte, arquivo).toContain("createPortal(")
      expect(fonte, arquivo).toContain("document.body")
    }
  })
})
