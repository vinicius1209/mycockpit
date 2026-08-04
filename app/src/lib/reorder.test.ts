// S1.2 — a ordem da sidebar é do USUÁRIO. Estes helpers são a única fonte da
// mutação de ordem (drag e teclado); as stores só aplicam + persistem.
import { describe, expect, it } from "vitest"
import { moveByDelta, reorderByIds } from "./reorder"

const lista = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]

describe("reorderByIds (drag & drop)", () => {
  it("arrasta pra frente: o item entra na posição do alvo", () => {
    expect(reorderByIds(lista, "a", "c").map((i) => i.id)).toEqual([
      "b",
      "c",
      "a",
      "d",
    ])
  })

  it("arrasta pra trás: o item entra na posição do alvo", () => {
    expect(reorderByIds(lista, "d", "b").map((i) => i.id)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ])
  })

  it("soltar sobre si mesmo é no-op (mesma referência, sem re-render)", () => {
    expect(reorderByIds(lista, "b", "b")).toBe(lista)
  })

  it("id desconhecido (drag vazado de outra lista) é no-op", () => {
    expect(reorderByIds(lista, "zumbi", "b")).toBe(lista)
    expect(reorderByIds(lista, "b", "zumbi")).toBe(lista)
  })

  it("não muta a lista original", () => {
    reorderByIds(lista, "a", "d")
    expect(lista.map((i) => i.id)).toEqual(["a", "b", "c", "d"])
  })
})

describe("moveByDelta (context menu, teclado)", () => {
  it("mover para baixo troca com o vizinho seguinte", () => {
    expect(moveByDelta(lista, "b", 1).map((i) => i.id)).toEqual([
      "a",
      "c",
      "b",
      "d",
    ])
  })

  it("mover para cima troca com o vizinho anterior", () => {
    expect(moveByDelta(lista, "c", -1).map((i) => i.id)).toEqual([
      "a",
      "c",
      "b",
      "d",
    ])
  })

  it("primeiro pra cima é no-op (mesma referência)", () => {
    expect(moveByDelta(lista, "a", -1)).toBe(lista)
  })

  it("último pra baixo é no-op (mesma referência)", () => {
    expect(moveByDelta(lista, "d", 1)).toBe(lista)
  })

  it("id desconhecido é no-op", () => {
    expect(moveByDelta(lista, "zumbi", 1)).toBe(lista)
  })
})
