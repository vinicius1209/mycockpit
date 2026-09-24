import { describe, expect, it } from "vitest"
import { ALTURA_DA_FAIXA, RECUO_DOS_BOTOES } from "./faixaDaJanela"

// Quem cobre o canto de cima da janela reserva a faixa dos botões de fechar,
// minimizar e expandir. O visualizador de imagem cobria a tela com `px-4` e o
// nome do arquivo ficava embaixo deles (24/09/2026).
const fontes = import.meta.glob(["./TitleBar.tsx", "../chat/Lightbox.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

describe("faixa da janela", () => {
  it("a barra do app e o visualizador de imagem usam a MESMA faixa", () => {
    expect(Object.keys(fontes)).toHaveLength(2)
    for (const [arquivo, fonte] of Object.entries(fontes)) {
      expect(fonte, arquivo).toContain("ALTURA_DA_FAIXA")
      expect(fonte, arquivo).toContain("RECUO_DOS_BOTOES")
    }
  })

  it("a altura é a de 56px em que o Rust centra os botões", () => {
    expect(ALTURA_DA_FAIXA).toBe("h-14")
    expect(RECUO_DOS_BOTOES).toBe("pl-20")
  })
})
