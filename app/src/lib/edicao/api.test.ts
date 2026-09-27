// O erro do salvar chega do Rust como objeto com `tipo` (edicao.rs, testado
// lá com o JSON exato). Qualquer outra forma degrada para "falhou".
import { describe, expect, it } from "vitest"
import { parseErroAoSalvar } from "./api"

describe("parseErroAoSalvar", () => {
  it("lê as cinco formas que o Rust serializa", () => {
    expect(parseErroAoSalvar({ tipo: "conflito", versao: "abc" })).toEqual({ tipo: "conflito", versao: "abc" })
    expect(parseErroAoSalvar({ tipo: "sumiu" })).toEqual({ tipo: "sumiu" })
    expect(parseErroAoSalvar({ tipo: "fora-das-pastas" })).toEqual({ tipo: "fora-das-pastas" })
    expect(parseErroAoSalvar({ tipo: "so-leitura", motivo: "Grande demais para editar aqui (3,4 MB)" })).toEqual({
      tipo: "so-leitura",
      motivo: "Grande demais para editar aqui (3,4 MB)",
    })
    expect(parseErroAoSalvar({ tipo: "falhou", detalhe: "Permission denied (os error 13)" })).toEqual({
      tipo: "falhou",
      detalhe: "Permission denied (os error 13)",
    })
  })

  it("forma desconhecida vira falhou com a mensagem crua", () => {
    expect(parseErroAoSalvar("command salvar_arquivo not found")).toEqual({
      tipo: "falhou",
      detalhe: "command salvar_arquivo not found",
    })
    expect(parseErroAoSalvar(new Error("ipc caiu"))).toEqual({ tipo: "falhou", detalhe: "ipc caiu" })
    expect(parseErroAoSalvar({ tipo: "conflito" })).toMatchObject({ tipo: "falhou" })
    expect(parseErroAoSalvar({ tipo: "novo-tipo" })).toMatchObject({ tipo: "falhou" })
  })
})
