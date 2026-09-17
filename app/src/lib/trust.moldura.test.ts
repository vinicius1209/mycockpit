import { describe, expect, it } from "vitest"
import { conteudoDaMoldura, frameHistory } from "./trust"

describe("conteúdo da moldura", () => {
  it("desfaz exatamente o frameHistory e deixa o resto como está", () => {
    expect(conteudoDaMoldura(frameHistory("linha 1\nlinha 2"))).toBe("linha 1\nlinha 2")
    expect(conteudoDaMoldura("texto solto")).toBe("texto solto")
  })
})
