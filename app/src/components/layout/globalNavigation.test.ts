import { describe, expect, it } from "vitest"
import { GLOBAL_NAVIGATION } from "./globalNavigation"

describe("navegação global em Geral, ADR-187", () => {
  it("reúne as quatro visões globais na ordem aprovada", () => {
    expect(GLOBAL_NAVIGATION.map((entry) => entry.label)).toEqual([
      "Painel",
      "Frota",
      "Agendamentos",
      "Planos de voo",
    ])
    expect(GLOBAL_NAVIGATION.map((entry) => entry.id)).toEqual([
      "painel",
      "fleet",
      "scheduled",
      "flightPlans",
    ])
  })
  it("cada destino descreve seu resultado", () => {
    for (const entry of GLOBAL_NAVIGATION)
      expect(entry.desc.trim().length).toBeGreaterThan(0)
  })
})
