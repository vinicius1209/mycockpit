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
