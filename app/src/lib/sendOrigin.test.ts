// A REGRA DE QUEM PODE ESPERAR NA FILA DO COMPOSER (ADR-046).
//
// Pura de propósito: a fila do humano é a superfície onde o incidente
// 2026-08-16 se materializou (um prompt do app apareceu como se ele tivesse
// digitado), e uma regra que mora só dentro de um componente de 1.500 linhas é
// uma regra que ninguém consegue provar.

import { describe, expect, it } from "vitest"
import {
  AUTO_RESUME,
  HUMANO,
  PASTA_LIBERADA,
  avisoDeDescarte,
  ehAutoResume,
  entraNaFilaDoHumano,
} from "./sendOrigin"

describe("a fila do composer é do humano", () => {
  it("mensagem do humano entra na fila", () => {
    expect(entraNaFilaDoHumano(HUMANO)).toBe(true)
  })

  it("retomada por pasta liberada NÃO entra na fila", () => {
    // Foi exatamente isto no incidente: o clique em "Liberar e reenviar" virou
    // um chip "Na fila · enviam juntas ao terminar" que o usuário não digitou,
    // e o × daquele chip apaga blobs de anexo do disco.
    expect(entraNaFilaDoHumano(PASTA_LIBERADA)).toBe(false)
  })

  it("auto-resume NÃO entra na fila", () => {
    expect(entraNaFilaDoHumano(AUTO_RESUME)).toBe(false)
  })
})

describe("só o auto-resume é auto-resume", () => {
  it("o reenvio agendado se declara (não cancela o loop, não planeja)", () => {
    expect(ehAutoResume(AUTO_RESUME)).toBe(true)
  })

  it("liberar pasta é sistema, mas não é auto-resume", () => {
    // Duas origens de sistema com prazos diferentes: o reenvio da pasta cancela
    // um auto-resume agendado (é turno novo) e respeita o toggle de planejar.
    expect(ehAutoResume(PASTA_LIBERADA)).toBe(false)
  })

  it("envio do humano nunca é auto-resume", () => {
    expect(ehAutoResume(HUMANO)).toBe(false)
  })
})

describe("o aviso do descarte diz o que ficou de pé, sem prometer envio", () => {
  it("pasta liberada: afirma a liberação e o prazo dela", () => {
    const aviso = avisoDeDescarte(PASTA_LIBERADA)
    expect(aviso).toBe("Pasta liberada. Vale a partir do próximo envio.")
    // "Reenviando o pedido…" aqui seria teatro: nenhum turno vai nascer agora.
    expect(aviso).not.toMatch(/reenvi/i)
  })

  it("auto-resume: diz por que não saiu", () => {
    expect(avisoDeDescarte(AUTO_RESUME)).toBe(
      "Retomada automática dispensada: já tem um turno rodando aqui.",
    )
  })

  it("nenhum aviso usa travessão (§7 do STYLEGUIDE)", () => {
    for (const origem of [PASTA_LIBERADA, AUTO_RESUME]) {
      expect(avisoDeDescarte(origem)).not.toContain("—")
    }
  })
})
