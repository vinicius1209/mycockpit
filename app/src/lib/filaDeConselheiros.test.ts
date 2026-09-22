import { describe, expect, it } from "vitest"
import {
  aindaNaFila,
  quemVemDepois,
  rotuloDoDestinatario,
  semEsse,
} from "./filaDeConselheiros"

const fila = [
  { id: "p:aline", name: "Aline" },
  { id: "p:bob", name: "Bob" },
]

describe("a fila de conselheiros aparece na tela", () => {
  it("quem ainda não começou é dito na própria bolha", () => {
    expect(rotuloDoDestinatario({ id: "p:aline", name: "Aline" }, fila)).toBe(
      "para Aline · na fila",
    )
  })

  it("quem está lendo agora não aparece como fila (tem a linha de chegada dele)", () => {
    expect(rotuloDoDestinatario({ id: "p:iris", name: "Íris" }, fila)).toBe("para Íris")
    expect(aindaNaFila(fila, "p:iris")).toBe(false)
  })

  it("a linha de chegada diz quem vem depois, e cala quando não vem ninguém", () => {
    expect(quemVemDepois(fila)).toBe("Aline é a próxima")
    expect(quemVemDepois([])).toBeNull()
    expect(quemVemDepois(undefined)).toBeNull()
  })

  it("quem começa sai da fila sem mexer na ordem dos outros", () => {
    expect(semEsse(fila, "p:aline")).toEqual([{ id: "p:bob", name: "Bob" }])
    expect(semEsse(fila, "p:ninguem")).toEqual(fila)
    expect(semEsse(undefined, "p:aline")).toEqual([])
  })

  it("sem fila, uma consulta só continua sem enfeite", () => {
    expect(rotuloDoDestinatario({ id: "p:iris", name: "Íris" }, undefined)).toBe("para Íris")
  })
})
