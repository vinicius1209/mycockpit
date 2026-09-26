import { describe, expect, it } from "vitest"

// Contrato do aviso (24/09/2026): todo toast se fecha, e o ícone de erro não
// pode ser um X, senão a pessoa clica nele achando que fecha. Lido do fonte
// (`?raw`) porque o Sonner só pinta o toast no navegador.
const [fonte] = Object.values(
  import.meta.glob("./sonner.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>,
)

describe("Toaster", () => {
  it("todo aviso tem o botão de fechar", () => {
    expect(fonte).toMatch(/<Sonner[\s\S]*?closeButton/)
  })

  it("o ícone de erro não é um X", () => {
    expect(fonte).not.toMatch(/error: <\w*X\w*Icon/)
  })

  // ADR-261: no centro de baixo o aviso tampava o composer.
  it("mora no canto superior direito, abaixo da faixa da janela, com o fechar à direita", () => {
    expect(fonte).toMatch(/position="top-right"/)
    expect(fonte).toMatch(/offset=\{\{ top: 64/)
    expect(fonte).toMatch(/"--toast-close-button-end": "0"/)
  })
})
