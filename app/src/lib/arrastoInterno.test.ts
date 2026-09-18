import { beforeEach, describe, expect, it } from "vitest"
import {
  cancelarArrasto,
  cargaArrastada,
  comecarArrasto,
  concluirArrasto,
  pairarSobre,
} from "./arrastoInterno"

const linha = (id: string) => ({ tipo: "reordenar" as const, id })
const composer = { tipo: "composer" as const }

beforeEach(() => cancelarArrasto())

describe("arrastar dentro da janela (spike S2)", () => {
  it("o alvo do dragover conclui o gesto mesmo quando o drop não chega", () => {
    comecarArrasto({ tipo: "projeto", id: "p1" })
    pairarSobre(linha("p2"))
    pairarSobre(linha("p3"))
    // `dragend` sem `drop`: é o caso do app instalado.
    expect(concluirArrasto("reordenar")).toEqual({
      carga: { tipo: "projeto", id: "p1" },
      alvo: linha("p3"),
    })
  })

  it("o alvo do drop vence o último pairado", () => {
    comecarArrasto({ tipo: "conversa", projectId: "proj", id: "c1" })
    pairarSobre(linha("c2"))
    expect(concluirArrasto("reordenar", linha("c9"))).toEqual({
      carga: { tipo: "conversa", projectId: "proj", id: "c1" },
      alvo: linha("c9"),
    })
  })

  it("concluir duas vezes não reordena duas vezes", () => {
    comecarArrasto({ tipo: "projeto", id: "p1" })
    pairarSobre(linha("p2"))
    expect(concluirArrasto("reordenar", linha("p2"))).not.toBeNull()
    expect(concluirArrasto("reordenar")).toBeNull()
  })

  it("soltar em cima de si mesmo, sem alvo, ou sem arrasto, é no-op", () => {
    comecarArrasto({ tipo: "projeto", id: "p1" })
    expect(concluirArrasto("reordenar", linha("p1"))).toBeNull()
    comecarArrasto({ tipo: "projeto", id: "p1" })
    expect(concluirArrasto("reordenar")).toBeNull()
    expect(concluirArrasto("reordenar", linha("p2"))).toBeNull()
  })

  it("pairar sem arrasto em curso não inventa gesto", () => {
    pairarSobre(linha("p2"))
    expect(cargaArrastada()).toBeNull()
    expect(concluirArrasto("reordenar")).toBeNull()
  })

  it("quem está sendo arrastado fica legível enquanto o gesto dura", () => {
    expect(cargaArrastada()).toBeNull()
    comecarArrasto({ tipo: "projeto", id: "p1" })
    expect(cargaArrastada()).toEqual({ tipo: "projeto", id: "p1" })
    cancelarArrasto()
    expect(cargaArrastada()).toBeNull()
  })
})

describe("dois consumidores no mesmo gesto (barra lateral e composer)", () => {
  it("quem não é dono do alvo não consome o gesto do outro", () => {
    comecarArrasto({ tipo: "arquivo", id: "arquivo:src/a.ts", caminho: "src/a.ts", pasta: false })
    pairarSobre(composer)
    // O `dragend` da linha de origem chega antes do `drop` do composer.
    expect(concluirArrasto("reordenar")).toBeNull()
    expect(concluirArrasto("composer")).toEqual({
      carga: { tipo: "arquivo", id: "arquivo:src/a.ts", caminho: "src/a.ts", pasta: false },
      alvo: composer,
    })
  })

  it("projeto solto no composer não vira reordenação de nada", () => {
    comecarArrasto({ tipo: "projeto", id: "p1" })
    pairarSobre(composer)
    expect(concluirArrasto("reordenar")).toBeNull()
    // O composer decide o que fazer com cada carga; o gesto chega inteiro nele.
    expect(concluirArrasto("composer")?.carga).toEqual({ tipo: "projeto", id: "p1" })
  })

  it("texto selecionado chega ao composer pelo mesmo caminho", () => {
    comecarArrasto({ tipo: "texto", id: "texto:1", texto: "  trecho do diff  " })
    pairarSobre(composer)
    expect(concluirArrasto("composer", composer)?.carga).toEqual({
      tipo: "texto",
      id: "texto:1",
      texto: "  trecho do diff  ",
    })
  })
})
