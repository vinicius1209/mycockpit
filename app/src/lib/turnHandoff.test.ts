// A ORDEM DA CASCATA é contrato, não estilo.
//
// `assemblePromptCascade` decide o que o motor lê primeiro: quem você é → as
// regras deste projeto → o que já aprendemos → o pedido. Essa ordem está citada
// em comentário no `ChatPanel` e em `canalDoTurno.ts`, mas até aqui não havia
// nada que a segurasse: função pura, ordem crítica e zero teste é exatamente o
// tipo de coisa que muda em silêncio num refactor e só aparece como "o agente
// ignorou a doutrina" semanas depois.

import { describe, expect, it } from "vitest"
import { assemblePromptCascade } from "@/lib/turnHandoff"

const PEDIDO = "arrume o botão"

function posicoes(saida: string, ...marcas: string[]) {
  return marcas.map((m) => saida.indexOf(m))
}

describe("assemblePromptCascade", () => {
  it("sem envelope nenhum, o pedido viaja intacto", () => {
    expect(assemblePromptCascade({ promptText: PEDIDO })).toBe(PEDIDO)
  })

  it("a ordem é persona → doutrina → parecer → lições → pedido", () => {
    const saida = assemblePromptCascade({
      promptText: PEDIDO,
      personaBlock: "PERSONA",
      doctrineBlock: "DOUTRINA",
      broughtAdvice: "PARECER",
      lessonsBlock: "LICOES",
    })
    const [p, d, a, l, pedido] = posicoes(
      saida,
      "PERSONA",
      "DOUTRINA",
      "PARECER",
      "LICOES",
      PEDIDO,
    )
    expect(p).toBeGreaterThanOrEqual(0)
    expect(p).toBeLessThan(d)
    expect(d).toBeLessThan(a)
    expect(a).toBeLessThan(l)
    expect(l).toBeLessThan(pedido)
  })

  it("o PEDIDO é sempre o último: é ele que o motor tem que executar", () => {
    for (const envelope of [
      { personaBlock: "X" },
      { doctrineBlock: "X" },
      { broughtAdvice: "X" },
      { lessonsBlock: "X" },
    ]) {
      const saida = assemblePromptCascade({ promptText: PEDIDO, ...envelope })
      expect(saida.endsWith(PEDIDO)).toBe(true)
    }
  })

  it("bloco ausente não deixa buraco nem separador órfão", () => {
    const saida = assemblePromptCascade({
      promptText: PEDIDO,
      personaBlock: "PERSONA",
      lessonsBlock: null,
      broughtAdvice: undefined,
      doctrineBlock: "",
    })
    expect(saida).toBe(`PERSONA\n\n${PEDIDO}`)
  })

  it("identidade e regras colam sem régua; contexto e lições vêm separados", () => {
    // A régua "---" marca o que é CONTEXTO trazido (parecer, lições). Persona e
    // doutrina são a voz do turno, não anexo, e por isso entram sem corte.
    const voz = assemblePromptCascade({
      promptText: PEDIDO,
      personaBlock: "PERSONA",
      doctrineBlock: "DOUTRINA",
    })
    expect(voz).not.toContain("---")

    const contexto = assemblePromptCascade({
      promptText: PEDIDO,
      lessonsBlock: "LICOES",
      broughtAdvice: "PARECER",
    })
    expect(contexto.match(/\n---\n/g)).toHaveLength(2)
  })

  it("a montagem é pura: chamar duas vezes com o mesmo dado dá o mesmo texto", () => {
    const args = {
      promptText: PEDIDO,
      personaBlock: "PERSONA",
      doctrineBlock: "DOUTRINA",
    }
    expect(assemblePromptCascade(args)).toBe(assemblePromptCascade(args))
  })
})
