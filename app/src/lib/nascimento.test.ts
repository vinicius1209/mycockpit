import { describe, expect, it } from "vitest"
import {
  atrasosDaCascata,
  JANELA_DA_RAJADA_MS,
  JANELA_NASCIMENTO_MS,
  nasceuAgora,
  PASSO_DA_CASCATA_MS,
  PRIMEIRO_ATRASO_MS,
  TETO_DA_CASCATA,
  registrarTroca,
  tsDaCauda,
} from "@/lib/nascimento"

// Carimbo REAL: o item `cancelled` da conversa "[feat] cliente coleta"
// (09/09/2026), colhido do SQLite do app.
const CORTE_REAL = 1_788_962_247_781

describe("nasceuAgora", () => {
  it("item carimbado há pouco está nascendo na frente da pessoa", () => {
    expect(nasceuAgora(CORTE_REAL, CORTE_REAL + 40)).toBe(true)
    expect(nasceuAgora(CORTE_REAL, CORTE_REAL)).toBe(true)
  })

  it("reabrir a conversa depois da janela não reencena a chegada", () => {
    expect(nasceuAgora(CORTE_REAL, CORTE_REAL + JANELA_NASCIMENTO_MS + 1)).toBe(false)
    // o caso de verdade: a pessoa volta no dia seguinte
    expect(nasceuAgora(CORTE_REAL, CORTE_REAL + 86_400_000)).toBe(false)
  })

  it("o limite da janela é aberto: no instante exato já é histórico", () => {
    expect(nasceuAgora(CORTE_REAL, CORTE_REAL + JANELA_NASCIMENTO_MS)).toBe(false)
  })

  it("item antigo sem carimbo nunca anima, legado não finge chegada", () => {
    expect(nasceuAgora(undefined, CORTE_REAL)).toBe(false)
    expect(nasceuAgora(null, CORTE_REAL)).toBe(false)
    expect(nasceuAgora(Number.NaN, CORTE_REAL)).toBe(false)
  })

  it("carimbo no futuro (relógio que andou para trás) não anima", () => {
    expect(nasceuAgora(CORTE_REAL + 5_000, CORTE_REAL)).toBe(false)
  })
})

describe("registrarTroca", () => {
  it("a primeira leitura não é troca: montar não é evento", () => {
    const reg = { inicial: "rodando", trocou: false }
    expect(registrarTroca(reg, "rodando")).toBe(reg)
    expect(registrarTroca(reg, "rodando").trocou).toBe(false)
  })

  it("mudar depois de montado vira troca, e voltar ao inicial continua sendo", () => {
    const montado = { inicial: "rodando", trocou: false }
    const trocado = registrarTroca(montado, "quando")
    expect(trocado.trocou).toBe(true)
    expect(registrarTroca(trocado, "rodando").trocou).toBe(true)
  })
})

describe("tsDaCauda", () => {
  const fio = Array.from({ length: 1885 }, (_, i) => ({
    id: `item-${i}`,
    ts: CORTE_REAL - (1885 - i) * 1000,
  }))

  it("olha só a cauda: custo fixo por token, não o fio inteiro", () => {
    const mapa = tsDaCauda(fio)
    expect(mapa.size).toBe(24)
    expect(mapa.has("item-1884")).toBe(true)
    expect(mapa.has("item-0")).toBe(false)
  })

  it("fio curto cabe inteiro", () => {
    expect(tsDaCauda(fio.slice(0, 3)).size).toBe(3)
  })
})

describe("atrasosDaCascata", () => {
  // Carimbos REAIS de ações de uma conversa do app (conversation_items,
  // 0ae552bf…, posições 5 a 9): pares de Read pedidos juntos, a 28 e 6 ms.
  const LEITURAS_REAIS = [1787453038979, 1787453039007, 1787453039681, 1787453040132, 1787453040138]
  // E a mesma conversa, posições 35 a 45: um plano de 11 tarefas criado no
  // mesmo milissegundo.
  const PLANO_REAL = Array.from({ length: 11 }, () => 1787454182670)

  it("a primeira da rajada entra já; a segunda espera o primeiro atraso", () => {
    expect(atrasosDaCascata(LEITURAS_REAIS)).toEqual([0, PRIMEIRO_ATRASO_MS, 0, 0, PRIMEIRO_ATRASO_MS])
  })

  it("dentro da rajada, cada linha espera um passo a mais", () => {
    const atrasos = atrasosDaCascata(PLANO_REAL)
    expect(atrasos.slice(0, 4)).toEqual([
      0,
      PRIMEIRO_ATRASO_MS,
      PRIMEIRO_ATRASO_MS + PASSO_DA_CASCATA_MS,
      PRIMEIRO_ATRASO_MS + 2 * PASSO_DA_CASCATA_MS,
    ])
  })

  it("rajada longa tem teto: nenhuma linha fica invisível por meio segundo", () => {
    const atrasos = atrasosDaCascata(PLANO_REAL)
    expect(Math.max(...atrasos)).toBe(PRIMEIRO_ATRASO_MS + PASSO_DA_CASCATA_MS * (TETO_DA_CASCATA - 1))
    expect(Math.max(...atrasos)).toBeLessThan(500)
  })

  it("linhas separadas por mais que a janela não formam rajada", () => {
    expect(atrasosDaCascata([1000, 1000 + JANELA_DA_RAJADA_MS])).toEqual([0, 0])
  })

  it("sem carimbo (item legado), a linha entra sem atraso e quebra a rajada", () => {
    expect(atrasosDaCascata([1000, undefined, 1001])).toEqual([0, 0, 0])
  })
})
