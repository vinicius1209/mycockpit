import { describe, expect, it } from "vitest"
import { COPY_DA_PASTA, conferirPastas } from "./pastaDoProjeto"

describe("conferirPastas", () => {
  it("fora do Tauri não inventa problema", async () => {
    // O `isTauri()` é falso no teste: sem backend, a resposta honesta é "não
    // sei", e "não sei" não pode virar "quebrado".
    expect(await conferirPastas(["/qualquer/coisa"])).toEqual({})
  })

  it("lista vazia nem chama o backend", async () => {
    expect(await conferirPastas([])).toEqual({})
  })
})

describe("a copy dos dois problemas", () => {
  it("some e não-é-pasta dizem coisas DIFERENTES", () => {
    // Um manda procurar a pasta; o outro manda olhar o que está bem ali. Uma
    // frase só pros dois faria o usuário caçar o que não sumiu.
    expect(COPY_DA_PASTA.Sumiu).not.toBe(COPY_DA_PASTA.NaoEPasta)
    expect(COPY_DA_PASTA.Sumiu).toContain("não existe")
    expect(COPY_DA_PASTA.NaoEPasta).toContain("não é uma pasta")
  })
})
