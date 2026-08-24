// A rede do orçamento. O que se testa aqui é a POSTURA dele, não a aritmética.

import { describe, expect, it } from "vitest"
import {
  orcamentoDaMemoria,
  PISO_CHARS,
  TETO_CHARS,
} from "./orcamentoDaMemoria"

describe("orcamentoDaMemoria", () => {
  it("janela DESCONHECIDA cai no piso, nunca chuta pra cima", () => {
    // Fail-closed do §9, e a mesma postura do ContextRing: o app não inventa
    // porcentagem de janela que não conhece.
    expect(orcamentoDaMemoria(null, "transplante")).toBe(PISO_CHARS)
    expect(orcamentoDaMemoria(0, "porTurno")).toBe(PISO_CHARS)
    expect(orcamentoDaMemoria(-1, "transplante")).toBe(PISO_CHARS)
  })

  it("a RAZÃO faz trabalho em janela pequena (é pra isso que ela existe)", () => {
    // Num teto único, a razão virava constante disfarçada — em toda janela real
    // ela batia no limite. Aqui ela precisa MORDER no modelo pequeno.
    const pequeno = orcamentoDaMemoria(32_000, "transplante")
    expect(pequeno).toBeLessThan(TETO_CHARS.transplante)
    expect(pequeno).toBeGreaterThan(PISO_CHARS)
  })

  it("o TETO manda nas janelas grandes, e é sobre ATENÇÃO", () => {
    // 2M de janela não vira 600k de recap: a literatura de context rot mostra
    // degradação bem antes de a janela encher.
    expect(orcamentoDaMemoria(2_000_000, "transplante")).toBe(TETO_CHARS.transplante)
    expect(orcamentoDaMemoria(1_000_000, "porTurno")).toBe(TETO_CHARS.porTurno)
  })

  it("quem paga POR TURNO leva menos que quem paga uma vez", () => {
    // O número único escondia este eixo: era generoso demais pro por-turno e
    // apertado demais pro transplante.
    for (const j of [200_000, 1_000_000]) {
      expect(orcamentoDaMemoria(j, "porTurno")).toBeLessThan(
        orcamentoDaMemoria(j, "transplante"),
      )
    }
  })

  it("dez turnos do por-turno ainda cabem com folga na janela", () => {
    // A conta que justifica a fração: memória que come a janela que ela deveria
    // viabilizar é memória que se sabota.
    const janela = 200_000
    const porTurno = orcamentoDaMemoria(janela, "porTurno")
    const tokensEm10Turnos = (porTurno * 10) / 3 // 3 chars/token (conservador)
    expect(tokensEm10Turnos).toBeLessThan(janela * 0.25)
  })

  it("nunca devolve menos que o piso, em nenhuma combinação", () => {
    for (const j of [1, 100, 1_000, 32_000, 200_000, 2_000_000, null]) {
      for (const f of ["transplante", "porTurno"] as const) {
        expect(orcamentoDaMemoria(j, f), `${j}/${f}`).toBeGreaterThanOrEqual(PISO_CHARS)
      }
    }
  })
})
