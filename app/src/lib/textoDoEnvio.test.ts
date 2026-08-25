import { describe, expect, it } from "vitest"
import { textoDoEnvio } from "@/lib/textoDoEnvio"

describe("textoDoEnvio — só string vence o valor do composer", () => {
  it("O BUG: evento de clique NÃO vira texto", () => {
    // `onClick={onSubmit}` faz o React passar o MouseEvent como 1º argumento.
    // Com `override ?? value` isso virava `.trim()` num evento: TypeError
    // engolido pelo React, e o botão não fazia nada. Enter funcionava porque
    // passa string.
    const evento = { type: "click", clientX: 10 } as unknown
    expect(textoDoEnvio(evento, "meu prompt grande")).toBe("meu prompt grande")
  })

  it("override string de verdade vence o value (é o caminho do Enter)", () => {
    expect(textoDoEnvio("do editor", "do state")).toBe("do editor")
  })

  it("sem override cai no value", () => {
    expect(textoDoEnvio(undefined, " com espaços ")).toBe("com espaços")
    expect(textoDoEnvio(null, "abc")).toBe("abc")
  })

  it("string VAZIA é uma escolha, não ausência", () => {
    // O editor mandar "" significa "não há texto", e isso não pode ressuscitar
    // um `value` velho que o composer ainda não limpou.
    expect(textoDoEnvio("", "sobra antiga")).toBe("")
    expect(textoDoEnvio("   ", "sobra antiga")).toBe("")
  })

  it("qualquer outro tipo cai no value, nunca lança", () => {
    // A garantia que o call site não precisa lembrar de dar.
    for (const lixo of [0, 42, true, [], {}, () => {}]) {
      expect(() => textoDoEnvio(lixo, "seguro")).not.toThrow()
      expect(textoDoEnvio(lixo, "seguro")).toBe("seguro")
    }
  })

  it("apara nos dois caminhos", () => {
    expect(textoDoEnvio("  x  ", "y")).toBe("x")
    expect(textoDoEnvio(undefined, "  y  ")).toBe("y")
  })
})
