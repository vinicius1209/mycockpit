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
})
