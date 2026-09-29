import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { DeslizadorDeEtapas, etapaMaisPerto } from "./deslizador-de-etapas"

const ETAPAS = ["baixo", "médio", "alto", "extra", "máximo"].map((label, i) => ({ value: String(i), label }))

describe("deslizador por etapas", () => {
  it("o ponto do trilho escolhe a etapa mais perto, sem sair das pontas", () => {
    expect(etapaMaisPerto(0, 5)).toBe(0)
    expect(etapaMaisPerto(0.49, 5)).toBe(2)
    expect(etapaMaisPerto(1, 5)).toBe(4)
    expect(etapaMaisPerto(-3, 5)).toBe(0)
    expect(etapaMaisPerto(9, 5)).toBe(4)
    expect(etapaMaisPerto(0.7, 1)).toBe(0)
  })

  it("diz a etapa escolhida para quem usa leitor de tela", () => {
    const html = renderToStaticMarkup(createElement(DeslizadorDeEtapas, { etapas: ETAPAS, value: "2", onChange: () => {}, rotulo: "Esforço" }))
    expect(html).toContain('role="slider"')
    expect(html).toContain('aria-valuetext="alto"')
    expect(html).toContain('aria-valuenow="2"')
  })

  it("sem etapa escolhida (o motor escolhe), não desenha o botão", () => {
    const html = renderToStaticMarkup(createElement(DeslizadorDeEtapas, { etapas: ETAPAS, value: null, onChange: () => {}, rotulo: "Esforço" }))
    expect(html).toContain('aria-valuetext="o motor escolhe"')
    expect(html).not.toContain("size-4 -translate-x-1/2 rounded-full border")
  })
})
