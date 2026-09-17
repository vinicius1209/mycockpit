import { describe, expect, it } from "vitest"
import { SAIDA_VAZIA } from "@/lib/bastidores"
import { aplicarPedacos } from "./useSaidaDeArquivo"

const INICIO = { saida: SAIDA_VAZIA, fim: null, erro: null }

describe("pedaços do tail (bastidores::PedacoDeSaida)", () => {
  it("soma na ordem, recomeça quando o arquivo encolhe e guarda o fim", () => {
    // Conteúdo real do shell de 16/09: "passo 1..3" e "[killed]" ao morrer.
    const e = aplicarPedacos(INICIO, [
      { linhas: ["passo 1", "passo 2"], descartouInicio: false, reiniciou: false, fim: null },
      { linhas: ["passo 3", "", "[killed]"], descartouInicio: false, reiniciou: false, fim: null },
      { linhas: ["recomeço"], descartouInicio: false, reiniciou: true, fim: null },
      { linhas: [], descartouInicio: false, reiniciou: false, fim: "O arquivo de saída foi apagado." },
    ])
    expect(e.saida.linhas).toEqual(["recomeço"])
    expect(e.fim).toBe("O arquivo de saída foi apagado.")
  })

  it("abertura pelo fim de arquivo grande avisa que omitiu o começo", () => {
    const e = aplicarPedacos(INICIO, [
      { linhas: ["linha 9"], descartouInicio: true, reiniciou: false, fim: null },
    ])
    expect(e.saida.descartadas).toBeGreaterThan(0)
  })
})
