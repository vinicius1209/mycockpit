import { describe, expect, it } from "vitest"
import { caminhoInicial, pastaDe } from "./salvarImagem"

describe("Salvar no projeto: onde o diálogo começa", () => {
  it("sem projeto, deixa o sistema decidir", () => {
    expect(caminhoInicial(null, "icone.png", new Map())).toBeUndefined()
  })

  it("começa na raiz do projeto quando ainda não salvou nada nele", () => {
    expect(caminhoInicial("/Users/v/projetos/finance", "icone.png", new Map())).toBe(
      "/Users/v/projetos/finance/icone.png",
    )
  })

  it("lembra a última pasta usada naquele projeto", () => {
    const memoria = new Map([["/Users/v/projetos/finance", "/Users/v/projetos/finance/public"]])
    expect(caminhoInicial("/Users/v/projetos/finance", "icone.png", memoria)).toBe(
      "/Users/v/projetos/finance/public/icone.png",
    )
    expect(caminhoInicial("/Users/v/projetos/outro", "icone.png", memoria)).toBe(
      "/Users/v/projetos/outro/icone.png",
    )
  })

  it("a pasta de um caminho absoluto sai sem tocar no disco", () => {
    expect(pastaDe("/Users/v/projetos/finance/public/icone.png")).toBe("/Users/v/projetos/finance/public")
    expect(pastaDe("/icone.png")).toBe("/")
  })
})
