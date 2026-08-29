import { describe, expect, it } from "vitest"
import {
  PARADO_SEGUNDOS,
  idadeCurta,
  resumirProcessos,
  type ProcessoDeMotor,
} from "./processos"

function proc(over: Partial<ProcessoDeMotor> = {}): ProcessoDeMotor {
  return {
    pid: 1,
    ppid: 2,
    motor: "claude",
    rss_mb: 100,
    idade_s: 60,
    orfao: false,
    ...over,
  }
}

describe("resumirProcessos", () => {
  it("sessão recente não conta: ela provavelmente é você", () => {
    expect(resumirProcessos([proc({ idade_s: 300 })])).toEqual({
      parados: 0,
      orfaos: 0,
    })
  })

  it("parada é pela IDADE, órfã é pelo FATO", () => {
    // Pai morto não é suspeita, é fato — conta mesmo recém-nascida.
    const lista = [
      proc({ pid: 1, idade_s: PARADO_SEGUNDOS + 1 }),
      proc({ pid: 2, idade_s: 10, orfao: true }),
    ]
    expect(resumirProcessos(lista)).toEqual({ parados: 1, orfaos: 1 })
  })

  it("órfã E antiga conta UMA vez", () => {
    // Se contasse nas duas, o número da faixa ficaria maior que a lista do
    // painel e a pessoa abriria pra procurar uma sessão que não existe.
    const lista = [proc({ idade_s: 10 * PARADO_SEGUNDOS, orfao: true })]
    const r = resumirProcessos(lista)
    expect(r.parados + r.orfaos).toBe(1)
    expect(r.orfaos).toBe(1)
  })

  it("na fronteira exata do corte já conta", () => {
    expect(resumirProcessos([proc({ idade_s: PARADO_SEGUNDOS })]).parados).toBe(1)
    expect(resumirProcessos([proc({ idade_s: PARADO_SEGUNDOS - 1 })]).parados).toBe(0)
  })
})

describe("idadeCurta", () => {
  it("dias, horas e minutos — sempre uma palavra só", () => {
    expect(idadeCurta(17 * 86_400)).toBe("17 dias")
    expect(idadeCurta(86_400)).toBe("1 dia")
    expect(idadeCurta(4 * 3_600)).toBe("4 h")
    expect(idadeCurta(12 * 60)).toBe("12 min")
  })

  it("segundos viram '1 min', nunca '0 min'", () => {
    // Zero na tela parece bug; o processo existe há algum tempo, por menor que
    // seja.
    expect(idadeCurta(5)).toBe("1 min")
  })
})
