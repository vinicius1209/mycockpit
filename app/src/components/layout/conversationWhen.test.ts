// Slot direito da linha de conversa (STYLEGUIDE §6, ADR-043): a ordem é
// decisão de produto, então ela se testa sem DOM.
import { describe, expect, it } from "vitest"
import { fmtQuando, slotEstado } from "@/components/layout/conversationWhen"

const T0 = 1_785_512_000_000 // 30/07/2026, 09:33 local

describe("ordem fechada do slot: pede > rodando > falhou > tempo", () => {
  it("pede vence rodando, porque é o único que parou esperando você", () => {
    expect(slotEstado({ pede: true, rodando: true, falhou: false })).toBe("pede")
  })

  it("pede vence falhou", () => {
    expect(slotEstado({ pede: true, rodando: false, falhou: true })).toBe("pede")
  })

  it("rodando vence falhou: a falha carimbada é do turno anterior", () => {
    expect(slotEstado({ pede: false, rodando: true, falhou: true })).toBe(
      "rodando",
    )
  })

  it("falhou aparece quando nada mais disputa", () => {
    expect(slotEstado({ pede: false, rodando: false, falhou: true })).toBe(
      "falhou",
    )
  })

  it("sem nenhum sinal, o slot responde quando", () => {
    expect(slotEstado({ pede: false, rodando: false, falhou: false })).toBe(
      "quando",
    )
  })

  it("turno concluído com sucesso NÃO tem estado próprio: vira tempo", () => {
    // A perda deliberada do ADR-043: o selo verde de "terminou bem" era estado
    // ambiente permanente na lista (§9 item 4). Quem responde "isto andou
    // recentemente?" passa a ser o texto.
    expect(slotEstado({ pede: false, rodando: false, falhou: false })).toBe(
      "quando",
    )
  })
})

describe("tempo relativo com precisão que degrada", () => {
  it("menos de um minuto é agora, nunca segundos", () => {
    expect(fmtQuando(T0 - 1_000, T0)).toBe("agora")
    expect(fmtQuando(T0 - 59_000, T0)).toBe("agora")
  })

  it("minutos até a hora", () => {
    expect(fmtQuando(T0 - 60_000, T0)).toBe("1m")
    expect(fmtQuando(T0 - 9 * 60_000, T0)).toBe("9m")
    expect(fmtQuando(T0 - 59 * 60_000, T0)).toBe("59m")
  })

  it("horas até o dia", () => {
    expect(fmtQuando(T0 - 3_600_000, T0)).toBe("1h")
    expect(fmtQuando(T0 - 23 * 3_600_000, T0)).toBe("23h")
  })

  it("dias até a semana", () => {
    expect(fmtQuando(T0 - 24 * 3_600_000, T0)).toBe("1d")
    expect(fmtQuando(T0 - 3 * 24 * 3_600_000, T0)).toBe("3d")
    expect(fmtQuando(T0 - 6 * 24 * 3_600_000, T0)).toBe("6d")
  })

  it("a partir de 7 dias vira data: 34d seria ruído fingindo precisão", () => {
    const sete = T0 - 7 * 24 * 3_600_000
    expect(fmtQuando(sete, T0)).toMatch(/^\d{2}\/\d{2}$/)
    const d = new Date(sete)
    expect(fmtQuando(sete, T0)).toBe(
      `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
    )
  })

  it("carimbo no futuro (drift de relógio) vira agora, nunca negativo", () => {
    expect(fmtQuando(T0 + 500_000, T0)).toBe("agora")
  })

  it("sem carimbo confiável devolve vazio: o slot cala em vez de inventar", () => {
    expect(fmtQuando(null, T0)).toBe("")
    expect(fmtQuando(undefined, T0)).toBe("")
    expect(fmtQuando(0, T0)).toBe("")
    expect(fmtQuando(Number.NaN, T0)).toBe("")
  })
})
