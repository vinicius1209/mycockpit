// ADR-226: recibos REAIS desta conversa (1200a161, 22/09/2026), gravados com o
// custo acumulado da sessão pelo claude 2.1.280.
import { describe, expect, it } from "vitest"
import { corrigirRecibos } from "./custoAcumulado"

const RECIBOS = [
  { kind: "user", id: "u1" },
  { kind: "result", id: "8afa9bd5", costUsd: 0.7924408000000001 },
  { kind: "result", id: "d8ce58e9", costUsd: 2.5281972000000006 },
  { kind: "text", id: "t1" },
  { kind: "result", id: "e9f22785", costUsd: 2.9471584000000015 },
]

describe("corrigir os recibos do fio", () => {
  it("troca o acumulado pelo custo do turno, na ordem, e só onde o cru bate", () => {
    const { items, trocados } = corrigirRecibos(RECIBOS, [
      { cru: 2.5281972000000006, corrigido: 2.5281972000000006 - 0.7924408000000001 },
      { cru: 2.9471584000000015, corrigido: 2.9471584000000015 - 2.5281972000000006 },
    ])
    expect(trocados).toBe(2)
    expect(items.map((i) => ("costUsd" in i ? Number(i.costUsd!.toFixed(4)) : null))).toEqual([
      null,
      0.7924,
      1.7358,
      null,
      0.419,
    ])
    // O primeiro turno da sessão não muda, e o original não é mutado.
    expect(RECIBOS[2]).toMatchObject({ costUsd: 2.5281972000000006 })
  })

  it("troca que não acha recibo não inventa nada", () => {
    const { items, trocados } = corrigirRecibos(RECIBOS, [{ cru: 99, corrigido: 1 }])
    expect(trocados).toBe(0)
    expect(items).toEqual(RECIBOS)
  })
})
