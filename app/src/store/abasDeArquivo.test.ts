import { beforeEach, describe, expect, it } from "vitest"
import { useAbasDeArquivo } from "./abasDeArquivo"

const ARQ = "docs/architecture.md"

beforeEach(() => {
  useAbasDeArquivo.setState({ porConversa: {}, fechadas: {}, sumidos: {}, ladoCabe: true, larguraDoLado: 0.45, revelar: null })
})

/** Conta quantas vezes o store avisou. Cada aviso é também uma gravação do
 *  `persist` no disco. */
function contarAvisos(): () => number {
  let n = 0
  const desligar = useAbasDeArquivo.subscribe(() => {
    n++
  })
  return () => {
    desligar()
    return n
  }
}

describe("o store das abas não avisa (nem grava) sem mudança", () => {
  it("medir o cartão a cada redimensionar, com a mesma resposta, não mexe no store", () => {
    const fim = contarAvisos()
    for (let i = 0; i < 50; i++) useAbasDeArquivo.getState().setLadoCabe(true)
    expect(fim()).toBe(0)
  })

  it("repetir o mesmo gesto é um aviso só", () => {
    const s = useAbasDeArquivo.getState()
    const fim = contarAvisos()
    s.abrir("c1", ARQ)
    s.abrir("c1", ARQ)
    s.marcarVista("c1", { vista: ARQ, navegador: "fechado" })
    s.marcarVista("c1", { vista: ARQ, navegador: "fechado" })
    s.marcarSumido("c1", ARQ, false)
    s.setLarguraDoLado(0.45)
    s.setLarguraDoLado(0.1)
    s.setLarguraDoLado(0.25)
    s.porAoLado("c1", null)
    s.fechar("c1", ["nao-aberto.md"])
    s.reabrir("c1")
    // abrir + marcar a vista + a largura presa no mínimo (0.1 → 0.25)
    expect(fim()).toBe(3)
  })
})
