import { describe, expect, it } from "vitest"
import { splitMentions } from "./mentions"

const NAMES = ["Aline", "Ana Paula", "Bruno"]

describe("splitMentions · chip de menção", () => {
  it("veste @persona-conhecida como menção e deixa o resto texto", () => {
    const segs = splitMentions("@Aline do que você é capaz?", NAMES)
    expect(segs).toEqual([
      { type: "mention", text: "@Aline", name: "Aline" },
      { type: "text", text: " do que você é capaz?" },
    ])
  })

  it("@desconhecido fica texto normal", () => {
    const segs = splitMentions("@Fulano me ajuda", NAMES)
    expect(segs).toEqual([{ type: "text", text: "@Fulano me ajuda" }])
  })

  it("texto sem menção não vira chip", () => {
    const segs = splitMentions("nenhuma menção aqui", NAMES)
    expect(segs).toEqual([{ type: "text", text: "nenhuma menção aqui" }])
  })

  it("casa a menção no meio do texto", () => {
    const segs = splitMentions("oi @Bruno, tudo bem?", NAMES)
    expect(segs).toEqual([
      { type: "text", text: "oi " },
      { type: "mention", text: "@Bruno", name: "Bruno" },
      { type: "text", text: ", tudo bem?" },
    ])
  })

  it("é case-insensitive mas preserva o casing digitado", () => {
    const segs = splitMentions("@aline oi", NAMES)
    expect(segs).toEqual([
      { type: "mention", text: "@aline", name: "aline" },
      { type: "text", text: " oi" },
    ])
  })

  it("não casa nome parcial dentro de um token maior (@Alines)", () => {
    const segs = splitMentions("fala @Alines aí", NAMES)
    expect(segs).toEqual([{ type: "text", text: "fala @Alines aí" }])
  })

  it("ignora @ colado a uma palavra (email@aline.com)", () => {
    const segs = splitMentions("meu email@aline.com", NAMES)
    expect(segs).toEqual([{ type: "text", text: "meu email@aline.com" }])
  })

  it("longest-match: @Ana Paula não casa como a persona Ana", () => {
    const segs = splitMentions("@Ana Paula chega", ["Ana", "Ana Paula"])
    expect(segs).toEqual([
      { type: "mention", text: "@Ana Paula", name: "Ana Paula" },
      { type: "text", text: " chega" },
    ])
  })

  it("sem personas conhecidas devolve o texto inteiro", () => {
    expect(splitMentions("@Aline oi", [])).toEqual([
      { type: "text", text: "@Aline oi" },
    ])
  })

  it("texto vazio devolve lista vazia", () => {
    expect(splitMentions("", NAMES)).toEqual([])
  })
})
