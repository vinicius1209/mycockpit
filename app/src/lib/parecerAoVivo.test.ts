import { describe, expect, it } from "vitest"
import { estadoDaFerramenta, gerundio } from "./parecerAoVivo"

describe("o parecer ao vivo (ADR-267)", () => {
  it("o verbo vira gerúndio", () => {
    expect(gerundio("Ler")).toBe("lendo")
    expect(gerundio("Buscar no projeto")).toBe("buscando no projeto")
    expect(gerundio("Abrir")).toBe("abrindo")
  })

  it("o estado diz o que ele abriu de verdade", () => {
    expect(estadoDaFerramenta("Read", { file_path: "/repo/src/lib/oferta.ts" })).toBe("lendo oferta.ts")
  })
})
