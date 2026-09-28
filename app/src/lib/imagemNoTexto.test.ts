import { describe, expect, it } from "vitest"
import type { Attachment } from "@/lib/attachments"
import { imagensCitadas, referencias, semAImagem, semReferencias } from "./imagemNoTexto"

// Gêmeo dos casos de `imagem_no_texto.rs`: a numeração tem que ser a mesma dos
// dois lados, ou o composer mostra uma imagem e o motor recebe outra.
const PEDIDO = "Compare o card de faturas de hoje [imagem 1] com a referência [imagem 2] e diga o que falta."

const img = (path: string): Attachment => ({ path, name: "print.png", kind: "image", mime: "image/png", bytes: 42 })
const pdf = (path: string): Attachment => ({ path, name: "fatura.pdf", kind: "pdf", mime: "application/pdf", bytes: 42 })

describe("[imagem N] no texto", () => {
  it("acha só as referências válidas", () => {
    expect(referencias("a [imagem 1] b [imagem 3] c [imagem x] d [imagem 2]", 2).map((r) => r.n)).toEqual([1, 2])
  })

  it("a numeração conta só as imagens, na ordem do envio", () => {
    const anexos = [img("/a/azul.png"), pdf("/a/f.pdf"), img("/a/vermelho.png")]
    expect([...imagensCitadas(PEDIDO, anexos)]).toEqual(["/a/azul.png", "/a/vermelho.png"])
  })

  it("imagem citada mora no texto; a não citada continua na fileira", () => {
    const anexos = [img("/a/1.png"), img("/a/2.png")]
    expect(imagensCitadas("só a [imagem 2]", anexos)).toEqual(new Set(["/a/2.png"]))
  })

  it("tirar a imagem 1 apaga a referência dela e renumera as seguintes", () => {
    expect(semAImagem(PEDIDO, 1)).toBe("Compare o card de faturas de hoje com a referência [imagem 1] e diga o que falta.")
  })

  it("tirar a última não mexe nas anteriores", () => {
    expect(semAImagem(PEDIDO, 2)).toBe("Compare o card de faturas de hoje [imagem 1] com a referência e diga o que falta.")
  })

  it("colou três, a do meio não entrou: a referência dela sai e a terceira vira a segunda", () => {
    const texto = "a [imagem 1] b [imagem 2] c [imagem 3]"
    expect(semReferencias(texto, [2])).toBe("a [imagem 1] b c [imagem 2]")
    expect(semReferencias(texto, [1, 3])).toBe("a b [imagem 1] c")
  })
})
