import { beforeEach, describe, expect, it } from "vitest"
import {
  cancelarArrasto,
  cargaArrastada,
  comecarArrasto,
  concluirArrasto,
  pairarSobre,
} from "./arrastoInterno"

beforeEach(() => cancelarArrasto())

describe("arrastar dentro da janela (spike S2)", () => {
  it("o alvo do dragover conclui o gesto mesmo quando o drop não chega", () => {
    comecarArrasto({ tipo: "projeto", id: "p1" })
    pairarSobre("p2")
    pairarSobre("p3")
    // `dragend` sem `drop`: é o caso do app instalado.
    expect(concluirArrasto()).toEqual({ carga: { tipo: "projeto", id: "p1" }, alvo: "p3" })
  })

  it("o alvo do drop vence o último pairado", () => {
    comecarArrasto({ tipo: "conversa", projectId: "proj", id: "c1" })
    pairarSobre("c2")
    expect(concluirArrasto("c9")).toEqual({
      carga: { tipo: "conversa", projectId: "proj", id: "c1" },
      alvo: "c9",
    })
  })

  it("concluir duas vezes não reordena duas vezes", () => {
    comecarArrasto({ tipo: "projeto", id: "p1" })
    pairarSobre("p2")
    expect(concluirArrasto("p2")).not.toBeNull()
    expect(concluirArrasto()).toBeNull()
  })

  it("soltar em cima de si mesmo, sem alvo, ou sem arrasto, é no-op", () => {
    comecarArrasto({ tipo: "projeto", id: "p1" })
    expect(concluirArrasto("p1")).toBeNull()
    comecarArrasto({ tipo: "projeto", id: "p1" })
    expect(concluirArrasto()).toBeNull()
    expect(concluirArrasto("p2")).toBeNull()
  })

  it("pairar sem arrasto em curso não inventa gesto", () => {
    pairarSobre("p2")
    expect(cargaArrastada()).toBeNull()
    expect(concluirArrasto()).toBeNull()
  })

  it("quem está sendo arrastado fica legível enquanto o gesto dura", () => {
    expect(cargaArrastada()).toBeNull()
    comecarArrasto({ tipo: "projeto", id: "p1" })
    expect(cargaArrastada()).toEqual({ tipo: "projeto", id: "p1" })
    cancelarArrasto()
    expect(cargaArrastada()).toBeNull()
  })
})
