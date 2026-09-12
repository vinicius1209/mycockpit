import { describe, expect, it } from "vitest"
import {
  JANELA_NASCIMENTO_MS,
  nasceuAgora,
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
