// ADR-047 no BANCO — `recordTurnCost` é quem decide o que vira linha, e a
// regra é consumo, não preço. Antes o filtro morava nos três call sites
// (`cost_usd != null`) e o turno inteiro sumia quando o modelo não estava na
// tabela de preço: 5 turnos do `agy` e ~7,3M de tokens sem uma linha
// (incidente 2026-08-16 §6).
//
// Mesmo mini-engine em memória do db.usage.test.ts: SQL não mapeado LANÇA.

import { beforeEach, describe, expect, it, vi } from "vitest"

interface Row {
  run_id: string
  agent: string
  model: string | null
  cost_usd: number | null
  cost_source: string | null
  input_tokens: number
  output_tokens: number
  cache_tokens: number
  usage_basis: string | null
}

const h = vi.hoisted(() => ({ costs: [] as Row[] }))

vi.mock("@tauri-apps/plugin-sql", () => {
  const fakeDb = {
    execute: async (sql: string, params: unknown[] = []) => {
      const s = sql.trim()
      if (s.startsWith("CREATE TABLE") || s.startsWith("CREATE INDEX")) {
        return { rowsAffected: 0 }
      }
      if (s.startsWith("INSERT OR REPLACE INTO turn_costs")) {
        const [
          run_id,
          ,
          ,
          agent,
          model,
          cost_usd,
          cost_source,
          input_tokens,
          output_tokens,
          cache_tokens,
          ,
          usage_basis,
        ] = params as [
          string,
          string,
          string,
          string,
          string | null,
          number | null,
          string | null,
          number,
          number,
          number,
          number,
          string | null,
        ]
        const row: Row = {
          run_id,
          agent,
          model,
          cost_usd,
          cost_source,
          input_tokens,
          output_tokens,
          cache_tokens,
          usage_basis,
        }
        const i = h.costs.findIndex((c) => c.run_id === run_id)
        if (i >= 0) h.costs[i] = row
        else h.costs.push(row)
        return { rowsAffected: 1 }
      }
      throw new Error(`execute não mapeado: ${s.slice(0, 60)}`)
    },
    select: async (sql: string) => {
      throw new Error(`select não mapeado: ${sql.slice(0, 60)}`)
    },
  }
  return { default: { load: async () => fakeDb } }
})

// isTauri() exige window.__TAURI_INTERNALS__ (ambiente node não tem window).
;(globalThis as Record<string, unknown>).window = { __TAURI_INTERNALS__: {} }

import { recordTurnCost } from "@/lib/db"

function linha(p: Partial<Parameters<typeof recordTurnCost>[0]> = {}) {
  return {
    runId: "run-1",
    projectId: "p1",
    convId: "ec1642c1-5328-409e-afc8-58e79a3cdca1",
    agent: "agy",
    model: "gemini-3.7-flash-high",
    costUsd: null as number | null,
    costSource: "unknown" as string | null,
    input: 0,
    output: 0,
    cache: 0,
    ...p,
  }
}

beforeEach(() => {
  h.costs.length = 0
})

describe("recordTurnCost — consumo entra mesmo sem preço (ADR-047)", () => {
  it("turno do agy sem preço vira linha com custo NULO e os tokens reais", async () => {
    // fixture real: item #69 da conversa do incidente (banco do usuário).
    await recordTurnCost(
      linha({ input: 2_399_909, output: 11_098, cache: 2_101_766 }),
    )
    expect(h.costs).toHaveLength(1)
    expect(h.costs[0]).toMatchObject({
      agent: "agy",
      model: "gemini-3.7-flash-high",
      cost_usd: null,
      cost_source: "unknown",
      input_tokens: 2_399_909,
      output_tokens: 11_098,
      cache_tokens: 2_101_766,
      usage_basis: "delta",
    })
  })

  it("só cache também é consumo", async () => {
    await recordTurnCost(linha({ cache: 37 }))
    expect(h.costs).toHaveLength(1)
  })

  it("result sem preço E sem token nenhum NÃO vira linha", async () => {
    await recordTurnCost(linha())
    expect(h.costs).toHaveLength(0)
  })

  it("custo ZERO medido continua entrando (zero ≠ desconhecido)", async () => {
    await recordTurnCost(
      linha({ costUsd: 0, costSource: "reported", agent: "claude-code" }),
    )
    expect(h.costs[0].cost_usd).toBe(0)
  })

  it("REPLACE por run_id: o parcial sem preço cede lugar ao final com preço", async () => {
    await recordTurnCost(linha({ input: 100, output: 10 }))
    await recordTurnCost(
      linha({ costUsd: 0.42, costSource: "estimated", input: 200, output: 20 }),
    )
    expect(h.costs).toHaveLength(1)
    expect(h.costs[0].cost_usd).toBeCloseTo(0.42)
    expect(h.costs[0].input_tokens).toBe(200)
  })
})
