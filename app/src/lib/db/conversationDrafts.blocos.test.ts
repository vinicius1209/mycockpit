import { describe, expect, it } from "vitest"
import { parseBlocos } from "./conversationDrafts"

describe("citações lidas do banco", () => {
  it("só citação bem formada volta; lixo e JSON torto viram vazio", () => {
    const boa = { tipo: "citacao", itemId: "t1", autor: "Codex", ts: 1, trecho: "x" }
    expect(parseBlocos(JSON.stringify([boa, { tipo: "citacao", itemId: 2 }, null, "x"]))).toEqual([boa])
    expect(parseBlocos("{")).toEqual([])
    expect(parseBlocos("{}")).toEqual([])
  })
})

describe("colagem lida do banco", () => {
  it("colagem bem formada volta inteira; sem texto é descartada", () => {
    const boa = { tipo: "colagem", id: "c1", texto: "a\nb" }
    expect(parseBlocos(JSON.stringify([boa, { tipo: "colagem", id: "c2" }]))).toEqual([boa])
  })
})

describe("cartão de arquivo lido do banco (ADR-252)", () => {
  it("cartão bem formado volta e sobrevive a trocar de conversa; sem caminho é descartado", () => {
    const boa = { tipo: "arquivo", id: "arquivo:/tmp/a.ts", caminho: "/tmp/a.ts", pasta: false, bytes: 305 }
    expect(parseBlocos(JSON.stringify([boa, { tipo: "arquivo", id: "x", pasta: false, bytes: 1 }]))).toEqual([boa])
  })
})
