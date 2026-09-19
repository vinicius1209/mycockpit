import { describe, expect, it } from "vitest"

import { avaliar, buracos, numerosPorLinha, proximoLivre, repetidos } from "./adrUnico.mjs"

// As duas colisões REAIS que criaram esta guarda (ADR-016: fixture inventada só
// prova que a guarda pega a fixture inventada). Títulos e formato conferidos
// contra docs/decisions.md.
const COLISAO_202 = `### ADR-201 · Assinatura estável
corpo
### ADR-202 · Imagem na aba Alterações mostra a versão do disco e abre no Lightbox
corpo
### ADR-202 · Configurações: um chrome só, e a seção entrega apenas o conteúdo
corpo
### ADR-203 · Outra
corpo
`

const COLISAO_214 = `### ADR-213 · A busca do fio ganha índice léxico
corpo
### ADR-214 · A conversa ganha nome de gente no fim do primeiro turno
corpo
### ADR-214 · Arrastar dentro da janela é por ponteiro, não por HTML5
corpo
`

describe("número de ADR repetido", () => {
  it("pega a colisão do 202 e diz em quais linhas ela está", () => {
    const { problemas } = avaliar(COLISAO_202)
    expect(problemas).toHaveLength(1)
    expect(problemas[0]).toContain("ADR-202 aparece 2x")
    expect(problemas[0]).toContain("linhas 3, 5")
  })

  it("pega a colisão do 214", () => {
    expect(repetidos(numerosPorLinha(COLISAO_214))).toEqual([
      { numero: 214, linhas: [3, 5] },
    ])
  })

  it("manda renumerar a MENOS citada, que é a regra que os dois casos usaram", () => {
    expect(avaliar(COLISAO_202).problemas[0]).toContain("MENOS citada")
  })

  it("lista sã passa", () => {
    const sa = `## ADR-001 — Escopo\ncorpo\n### ADR-002 · Dor\ncorpo\n`
    expect(avaliar(sa).problemas).toEqual([])
  })
})

describe("buraco na sequência", () => {
  it("acusa o número pulado", () => {
    const comBuraco = `### ADR-010 · a\ncorpo\n### ADR-012 · b\ncorpo\n`
    expect(buracos(numerosPorLinha(comBuraco))).toEqual([11])
    expect(avaliar(comBuraco).problemas[0]).toContain("faltam na sequência: 11")
  })

  it("sequência sem furo não acusa nada", () => {
    expect(buracos(numerosPorLinha(`### ADR-1 · a\n### ADR-2 · b\n### ADR-3 · c\n`))).toEqual([])
  })
})

describe("o próximo número livre", () => {
  it("é o maior mais um, que é o que a mensagem de erro oferece", () => {
    expect(proximoLivre(numerosPorLinha(COLISAO_202))).toBe(204)
  })

  it("arquivo sem ADR nenhuma começa em 1", () => {
    expect(proximoLivre(numerosPorLinha("# Log\n\nsem decisões ainda\n"))).toBe(1)
  })
})

describe("o que NÃO é cabeçalho de ADR", () => {
  it("menção no corpo não conta como declaração", () => {
    // Senão toda ADR que cita outra viraria colisão.
    const texto = `### ADR-050 · a\nrevisa a ADR-049 e o ADR-048\ncorpo\n### ADR-051 · b\n`
    expect([...numerosPorLinha(texto).keys()].sort((x, y) => x - y)).toEqual([50, 51])
  })
})
