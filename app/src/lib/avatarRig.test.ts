import { describe, expect, it } from "vitest"
import {
  caminhoDaBoca,
  olharPara,
  planoDaCara,
  OLHAR_NEUTRO,
  RAIO_DE_ATENCAO,
} from "@/lib/avatarRig"

describe("planoDaCara", () => {
  it("é determinístico: a mesma persona sai com a mesma cara sempre", () => {
    const a = planoDaCara("iris")
    const b = planoDaCara("iris")
    expect(a).toEqual(b)
  })

  it("personas diferentes não saem todas iguais", () => {
    const seeds = ["iris", "aline", "marco", "nero", "testa", "vault"]
    const planos = seeds.map((s) => JSON.stringify(planoDaCara(s)))
    expect(new Set(planos).size).toBeGreaterThan(1)
  })

  it("seed vazia ainda produz uma cara (a persona nunca fica sem rosto)", () => {
    const p = planoDaCara("")
    expect(p.afastamentoDoOlho).toBeGreaterThan(0)
    expect(p.alturaDoOlho).toBeGreaterThan(0)
    expect(["sorriso", "linha", "aberta"]).toContain(p.boca)
  })

  it("mantém a variedade dentro da escada fechada (família, não carnaval)", () => {
    for (const s of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const p = planoDaCara(s)
      expect(p.afastamentoDoOlho).toBeGreaterThanOrEqual(7)
      expect(p.afastamentoDoOlho).toBeLessThanOrEqual(9)
      expect([4.4, 5.2]).toContain(p.alturaDoOlho)
    }
  })
})

describe("olharPara", () => {
  const centro = { x: 100, y: 100 }

  it("sem ponteiro devolve o neutro (nada se move sem causa)", () => {
    expect(olharPara(centro, null)).toBe(OLHAR_NEUTRO)
  })

  it("fora do raio de atenção devolve o neutro", () => {
    const longe = { x: 100 + RAIO_DE_ATENCAO + 1, y: 100 }
    expect(olharPara(centro, longe)).toBe(OLHAR_NEUTRO)
  })

  it("ponteiro à direita move pupila e cabeça para a direita", () => {
    const d = olharPara(centro, { x: 140, y: 100 })
    expect(d.pupila.x).toBeGreaterThan(0)
    expect(d.cabeca.x).toBeGreaterThan(0)
    expect(d.pupila.y).toBeCloseTo(0, 6)
  })

  it("ponteiro acima move para cima (y negativo no sistema da tela)", () => {
    const d = olharPara(centro, { x: 100, y: 60 })
    expect(d.pupila.y).toBeLessThan(0)
    expect(d.cabeca.y).toBeLessThan(0)
  })

  it("perto olha mais que longe: a intensidade cai com a distância", () => {
    const perto = olharPara(centro, { x: 120, y: 100 })
    const longe = olharPara(centro, { x: 100 + RAIO_DE_ATENCAO - 10, y: 100 })
    expect(perto.pupila.x).toBeGreaterThan(longe.pupila.x)
  })

  it("na borda do raio o desvio já é ~zero (entra sem salto)", () => {
    const naBorda = olharPara(centro, { x: 100 + RAIO_DE_ATENCAO, y: 100 })
    expect(Math.abs(naBorda.pupila.x)).toBeLessThan(0.01)
  })

  it("a cabeça se move MENOS que a pupila (parallax, não cabeçada)", () => {
    const d = olharPara(centro, { x: 130, y: 100 })
    expect(Math.abs(d.cabeca.x)).toBeLessThan(Math.abs(d.pupila.x))
  })

  it("ponteiro exatamente no centro devolve o neutro em vez de inventar direção", () => {
    expect(olharPara(centro, { x: 100, y: 100 })).toBe(OLHAR_NEUTRO)
  })

  it("a pupila nunca escapa do soquete, em nenhuma direção", () => {
    for (let a = 0; a < 360; a += 15) {
      const rad = (a * Math.PI) / 180
      const d = olharPara(centro, {
        x: 100 + Math.cos(rad) * 5,
        y: 100 + Math.sin(rad) * 5,
      })
      expect(Math.hypot(d.pupila.x, d.pupila.y)).toBeLessThanOrEqual(1.91)
    }
  })

  it("raio zero ou negativo devolve o neutro em vez de dividir por zero", () => {
    expect(olharPara(centro, { x: 110, y: 100 }, 0)).toBe(OLHAR_NEUTRO)
    expect(olharPara(centro, { x: 110, y: 100 }, -5)).toBe(OLHAR_NEUTRO)
  })
})

describe("caminhoDaBoca", () => {
  it("toda boca do plano tem caminho (nenhuma cara sai sem boca)", () => {
    for (const b of ["sorriso", "linha", "aberta"] as const) {
      expect(caminhoDaBoca(b)).toMatch(/^M/)
    }
  })
})
