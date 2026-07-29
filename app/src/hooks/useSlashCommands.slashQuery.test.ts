// FASE 2 do composer Lexical: o parse PURO do modo "/". O input INTEIRO precisa
// ser "/token" (sem espaço, sem quebra de linha) pra abrir o menu de comandos —
// a MESMA regra nos dois motores (textarea e Lexical). Provado sem React/DOM.

import { describe, expect, it } from "vitest"
import { slashQueryOf } from "./useSlashCommands"

describe("slashQueryOf — detecção do modo comando '/'", () => {
  it("só a barra abre com query vazia (lista tudo)", () => {
    expect(slashQueryOf("/")).toBe("")
  })

  it("/token devolve o token depois da barra", () => {
    expect(slashQueryOf("/test")).toBe("test")
  })

  it("aceita os caracteres de nome de comando (letras, número, : e -)", () => {
    expect(slashQueryOf("/deploy:prod-2")).toBe("deploy:prod-2")
  })

  it("espaço depois do comando encerra o modo (já é argumento, não busca)", () => {
    expect(slashQueryOf("/test ")).toBeNull()
    expect(slashQueryOf("/test foo")).toBeNull()
  })

  it("'/' no meio do texto não conta (só no início do input)", () => {
    expect(slashQueryOf("oi /test")).toBeNull()
    expect(slashQueryOf("caminho/arquivo")).toBeNull()
  })

  it("texto sem barra nenhuma → null", () => {
    expect(slashQueryOf("olá mundo")).toBeNull()
    expect(slashQueryOf("")).toBeNull()
  })

  it("quebra de linha encerra o modo (comando é one-liner no começo)", () => {
    expect(slashQueryOf("/test\n")).toBeNull()
  })
})
