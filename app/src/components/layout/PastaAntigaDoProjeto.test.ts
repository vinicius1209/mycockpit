import { describe, expect, it } from "vitest"
import { avisoDaMigracao } from "./PastaAntigaDoProjeto"

// Formas do que `migrar_pasta_do_projeto` devolve (migrar_pasta.rs).
describe("aviso depois de mover a pasta do projeto", () => {
  it("pasta inteira movida", () => {
    expect(avisoDaMigracao({ movidos: ["*"], conflitos: [] })).toBe("Pasta do projeto movida para .frota.")
  })

  it("conflito diz o que ficou para trás e por quê, sem travessão", () => {
    const aviso = avisoDaMigracao({ movidos: ["instructions.md"], conflitos: ["config.toml"] })
    expect(aviso).toContain("config.toml")
    expect(aviso).toContain("ficou na antiga")
    expect(aviso).not.toContain("—")
  })
})
