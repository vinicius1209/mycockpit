// ADR-047 — consumo sem preço é DADO, não ausência.
//
// Até aqui os três writers de `turn_costs` só gravavam com `cost_usd != null`,
// e "não sei o preço" apagava o turno inteiro do ledger. O incidente
// 2026-08-16 §6 é a prova: 5 turnos reais do `agy`, ~7,3M de tokens, ZERO
// linha gravada, e nenhum sinal na tela de que faltava alguma coisa.

import { describe, expect, it } from "vitest"
import { planUsageRecompute, worthLedgerRow } from "@/lib/usage"

describe("worthLedgerRow — o que merece uma linha no ledger", () => {
  it("turno com preço entra (o caso de sempre)", () => {
    expect(
      worthLedgerRow({ costUsd: 0.42, input: 100, output: 10, cache: 0 }),
    ).toBe(true)
  })

  it("turno SEM preço mas com tokens entra: consumo é fato medido", () => {
    // fixture real: item #69 da conversa ec1642c1 (o turno que morreu no
    // --print-timeout do agy), como ele chega do adapter sem tabela de preço.
    expect(
      worthLedgerRow({
        costUsd: null,
        input: 2_399_909,
        output: 11_098,
        cache: 2_101_766,
      }),
    ).toBe(true)
  })

  it("só cache também conta (é token cobrado, mesmo sem input novo)", () => {
    expect(
      worthLedgerRow({ costUsd: null, input: 0, output: 0, cache: 37 }),
    ).toBe(true)
  })

  it("custo ZERO continua entrando: zero medido é diferente de sem preço", () => {
    expect(worthLedgerRow({ costUsd: 0, input: 0, output: 0, cache: 0 })).toBe(
      true,
    )
  })

  it("result sem preço e sem token nenhum NÃO vira linha", () => {
    // o piso: uma linha que não descreve consumo algum só engordaria a
    // contagem de turnos das médias do Painel.
    expect(
      worthLedgerRow({ costUsd: null, input: 0, output: 0, cache: 0 }),
    ).toBe(false)
    expect(
      worthLedgerRow({
        costUsd: undefined,
        input: undefined,
        output: undefined,
        cache: undefined,
      }),
    ).toBe(false)
  })
})

describe("planUsageRecompute com linha sem preço no meio (ADR-047)", () => {
  it("linha de custo NULO não é lida como 'a thread reiniciou'", () => {
    // Antes, `(null ?? 0) < prev.costUsd` marcava reinício e devolvia os
    // tokens da linha INTEIROS ao turno — o acumulado voltava a ser cobrado.
    const [a, b, c] = planUsageRecompute([
      {
        runId: "r1",
        convId: "c1",
        costUsd: 1,
        input: 1000,
        output: 10,
        cache: 500,
        createdAt: 1,
      },
      {
        runId: "r2",
        convId: "c1",
        costUsd: null,
        input: 3000,
        output: 30,
        cache: 1500,
        createdAt: 2,
      },
      {
        runId: "r3",
        convId: "c1",
        costUsd: 4,
        input: 6000,
        output: 60,
        cache: 3000,
        createdAt: 3,
      },
    ])
    expect(a.input).toBe(1000) // a primeira vale inteira, como sempre
    expect(b.input).toBe(2000) // delta pra linha anterior, não os 3000 crus
    expect(b.costUsd).toBeNull() // e sem preço continua sem preço
    expect(c.input).toBe(3000)
    // a linha anterior não tinha preço, então o DELTA de custo é desconhecido:
    // "US$ 4" ali cobraria o acumulado inteiro de novo (erra pra cima).
    expect(c.costUsd).toBeNull()
  })

  it("queda REAL de tokens ainda é lida como thread nova", () => {
    const [, b] = planUsageRecompute([
      {
        runId: "r1",
        convId: "c1",
        costUsd: null,
        input: 5000,
        output: 50,
        cache: 2000,
        createdAt: 1,
      },
      {
        runId: "r2",
        convId: "c1",
        costUsd: null,
        input: 900,
        output: 9,
        cache: 100,
        createdAt: 2,
      },
    ])
    expect(b.input).toBe(900)
  })
})
