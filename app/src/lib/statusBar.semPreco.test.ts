// ADR-047 — a faixa inferior com turnos sem preço.
//
// Antes: sessão inteira em modelo fora da tabela de preço → total 0 → a zona
// não desenhava NADA. Ausência lida como "não gastou", que é o oposto do que
// aconteceu (o incidente 2026-08-16 queimou ~7,3M de tokens assim).

import { describe, expect, it } from "vitest"
import { statusCostItem } from "@/lib/statusBar"

describe("statusCostItem — consumo sem preço na faixa", () => {
  it("sessão inteira sem preço diz 'sem preço' em vez de sumir", () => {
    const item = statusCostItem(
      { total: 0, estimated: true, turns: 5, unpriced: 5 },
      null,
    )
    expect(item?.text).toBe("sem preço")
    expect(item?.label).toBe("esta conversa")
    expect(item?.title).toContain("não sabe")
  })

  it("sem consumo nenhum a zona continua vazia (nada de placeholder)", () => {
    expect(
      statusCostItem({ total: 0, estimated: false, turns: 5, unpriced: 0 }, null),
    ).toBeNull()
    // e a régua dos 2 turnos continua valendo mesmo sem preço
    expect(
      statusCostItem({ total: 0, estimated: true, turns: 1, unpriced: 1 }, null),
    ).toBeNull()
  })

  it("soma parcial (tem preço e tem turno sem) avisa no tooltip", () => {
    const item = statusCostItem(
      { total: 12.5, estimated: true, turns: 4, unpriced: 2 },
      null,
    )
    expect(item?.text).toBe("~US$ 12,50")
    expect(item?.title).toContain("2 turnos com preço desconhecido")
  })

  it("sem turno sem preço, o tooltip é o de sempre", () => {
    const item = statusCostItem({ total: 3, estimated: false, turns: 2 }, null)
    expect(item?.text).toBe("US$ 3,00")
    expect(item?.title).not.toContain("desconhecido")
  })
})
