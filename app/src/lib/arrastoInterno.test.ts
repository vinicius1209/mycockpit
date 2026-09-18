import { beforeEach, describe, expect, it } from "vitest"
import {
  alvoDoAtributo,
  cancelarArrasto,
  cargaArrastada,
  comecarArrasto,
  concluirArrasto,
  pairarSobre,
} from "./arrastoInterno"

const linha = (id: string) => ({ tipo: "reordenar" as const, id })
const composer = { tipo: "composer" as const }

beforeEach(() => cancelarArrasto())

describe("memória do gesto de arrastar", () => {
  it("o último alvo pairado conclui o gesto quando soltou fora de qualquer alvo", () => {
    comecarArrasto({ tipo: "projeto", id: "p1" })
    pairarSobre(linha("p2"))
    pairarSobre(linha("p3"))
    expect(concluirArrasto()).toEqual({ carga: { tipo: "projeto", id: "p1" }, alvo: linha("p3") })
  })

  it("o alvo sob o ponteiro ao soltar vence o último pairado", () => {
    comecarArrasto({ tipo: "conversa", projectId: "proj", id: "c1" })
    pairarSobre(linha("c2"))
    expect(concluirArrasto(linha("c9"))).toEqual({
      carga: { tipo: "conversa", projectId: "proj", id: "c1" },
      alvo: linha("c9"),
    })
  })

  it("concluir duas vezes não reordena duas vezes", () => {
    comecarArrasto({ tipo: "projeto", id: "p1" })
    expect(concluirArrasto(linha("p2"))).not.toBeNull()
    expect(concluirArrasto(linha("p2"))).toBeNull()
  })

  it("soltar em cima de si mesmo, no vazio, ou sem arrasto, é no-op", () => {
    comecarArrasto({ tipo: "projeto", id: "p1" })
    expect(concluirArrasto(linha("p1"))).toBeNull()
    comecarArrasto({ tipo: "projeto", id: "p1" })
    expect(concluirArrasto()).toBeNull()
    expect(concluirArrasto(linha("p2"))).toBeNull()
  })

  it("gesto que acabou no vazio não deixa carga para o próximo", () => {
    comecarArrasto({ tipo: "projeto", id: "p1" })
    concluirArrasto()
    expect(cargaArrastada()).toBeNull()
  })

  it("pairar sem arrasto em curso não inventa gesto", () => {
    pairarSobre(linha("p2"))
    expect(cargaArrastada()).toBeNull()
    expect(concluirArrasto()).toBeNull()
  })

  it("arquivo e texto chegam ao composer pelo mesmo caminho", () => {
    comecarArrasto({ tipo: "arquivo", id: "arquivo:src/a.ts", caminho: "src/a.ts", pasta: false })
    pairarSobre(composer)
    expect(concluirArrasto()?.alvo).toEqual(composer)

    comecarArrasto({ tipo: "texto", id: "texto:1", texto: "trecho do diff" })
    expect(concluirArrasto(composer)?.carga).toEqual({
      tipo: "texto",
      id: "texto:1",
      texto: "trecho do diff",
    })
  })
})

describe("alvo declarado no DOM", () => {
  it("lê o composer e a linha, com id que contém dois-pontos", () => {
    expect(alvoDoAtributo("composer")).toEqual(composer)
    expect(alvoDoAtributo("reordenar:p1")).toEqual(linha("p1"))
    expect(alvoDoAtributo("reordenar:proj:1")).toEqual(linha("proj:1"))
  })

  it("atributo ausente ou desconhecido não vira alvo", () => {
    expect(alvoDoAtributo(null)).toBeNull()
    expect(alvoDoAtributo("")).toBeNull()
    expect(alvoDoAtributo("reordenar:")).toBeNull()
    expect(alvoDoAtributo("qualquer-coisa")).toBeNull()
  })
})
