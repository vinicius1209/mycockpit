// ADR-033 — persistência do baseline de usage acumulado e reconstrução do
// histórico inflado, com o Database do plugin-sql MOCKADO por um mini-engine
// em memória (mesmo padrão de db.cards.test.ts): cada statement que o db.ts
// emite tem um handler, SQL não mapeado LANÇA (drift do schema aparece aqui,
// não em produção).

import { beforeEach, describe, expect, it, vi } from "vitest"

interface CostRow {
  run_id: string
  project_id: string
  conv_id: string
  agent: string
  cost_usd: number | null
  input_tokens: number
  output_tokens: number
  cache_tokens: number
  created_at: number
  usage_basis: string | null
}

interface BaselineRow {
  thread_id: string
  conv_id: string | null
  input: number
  cached_input: number
  output: number
}

const h = vi.hoisted(() => ({
  costs: [] as CostRow[],
  raw: [] as {
    run_id: string
    cost_usd: number | null
    input_tokens: number
    output_tokens: number
    cache_tokens: number
  }[],
  baselines: [] as BaselineRow[],
  convs: [] as { id: string; session_id: string | null }[],
}))

vi.mock("@tauri-apps/plugin-sql", () => {
  const fakeDb = {
    execute: async (sql: string, params: unknown[] = []) => {
      const s = sql.trim()
      if (s.startsWith("CREATE TABLE") || s.startsWith("CREATE INDEX")) {
        return { rowsAffected: 0 }
      }
      if (s.startsWith("INSERT INTO usage_baselines")) {
        const [thread_id, conv_id, input, cached_input, output] = params as [
          string,
          string | null,
          number,
          number,
          number,
        ]
        const found = h.baselines.find((b) => b.thread_id === thread_id)
        if (found) {
          // o modo "seed" (DO NOTHING) preserva o baseline que já existe
          if (!s.includes("DO NOTHING")) {
            Object.assign(found, { conv_id, input, cached_input, output })
          }
        } else {
          h.baselines.push({ thread_id, conv_id, input, cached_input, output })
        }
        return { rowsAffected: 1 }
      }
      if (s.startsWith("INSERT OR IGNORE INTO turn_costs_usage_raw")) {
        const [run_id, cost_usd, input_tokens, output_tokens, cache_tokens] =
          params as [string, number | null, number, number, number]
        if (!h.raw.some((r) => r.run_id === run_id)) {
          h.raw.push({ run_id, cost_usd, input_tokens, output_tokens, cache_tokens })
        }
        return { rowsAffected: 1 }
      }
      if (s.startsWith("UPDATE turn_costs")) {
        const [cost, input, output, cache, basis, runId] = params as [
          number | null,
          number,
          number,
          number,
          string,
          string,
        ]
        const row = h.costs.find((c) => c.run_id === runId)
        if (row) {
          row.cost_usd = cost
          row.input_tokens = input
          row.output_tokens = output
          row.cache_tokens = cache
          row.usage_basis = basis
        }
        return { rowsAffected: 1 }
      }
      throw new Error(`execute não mapeado: ${s.slice(0, 60)}`)
    },
    select: async (sql: string, params: unknown[] = []) => {
      const s = sql.trim().replace(/\s+/g, " ")
      if (s.startsWith("SELECT input, cached_input, output FROM usage_baselines")) {
        const [threadId] = params as [string]
        return h.baselines
          .filter((b) => b.thread_id === threadId)
          .map((b) => ({
            input: b.input,
            cached_input: b.cached_input,
            output: b.output,
          }))
      }
      if (s.startsWith("SELECT t.usage_basis")) {
        const [convId, ...agents] = params as string[]
        const rows = h.costs
          .filter((c) => c.conv_id === convId && agents.includes(c.agent))
          .sort((a, b) => b.created_at - a.created_at)
        const last = rows[0]
        if (!last) return []
        const backup = h.raw.find((r) => r.run_id === last.run_id)
        return [
          {
            usage_basis: last.usage_basis,
            i: backup?.input_tokens ?? last.input_tokens,
            c: backup?.cache_tokens ?? last.cache_tokens,
            o: backup?.output_tokens ?? last.output_tokens,
          },
        ]
      }
      if (s.startsWith("SELECT COUNT(*) AS n, SUM(cost_usd) AS total FROM turn_costs")) {
        const agents = params as string[]
        const rows = h.costs.filter(
          (c) => c.usage_basis == null && agents.includes(c.agent),
        )
        return [
          {
            n: rows.length,
            total: rows.reduce((a, c) => a + (c.cost_usd ?? 0), 0),
          },
        ]
      }
      if (s.startsWith("SELECT run_id, conv_id, cost_usd")) {
        const agents = params as string[]
        return h.costs
          .filter((c) => c.usage_basis == null && agents.includes(c.agent))
          .sort(
            (a, b) =>
              a.conv_id.localeCompare(b.conv_id) || a.created_at - b.created_at,
          )
          .map((c) => ({ ...c }))
      }
      if (s.startsWith("SELECT session_id FROM conversations")) {
        const [id] = params as [string]
        return h.convs
          .filter((c) => c.id === id)
          .map((c) => ({ session_id: c.session_id }))
      }
      throw new Error(`select não mapeado: ${s.slice(0, 60)}`)
    },
  }
  return { default: { load: async () => fakeDb } }
})

// isTauri() exige window.__TAURI_INTERNALS__ (ambiente node não tem window).
;(globalThis as Record<string, unknown>).window = { __TAURI_INTERNALS__: {} }

import {
  countCumulativeLedgerRows,
  loadUsageBaseline,
  recomputeCumulativeLedger,
  saveUsageBaseline,
} from "@/lib/db"

function cost(p: Partial<CostRow> & { run_id: string; created_at: number }): CostRow {
  return {
    project_id: "p1",
    conv_id: "conv-1",
    agent: "codex",
    cost_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_tokens: 0,
    usage_basis: null,
    ...p,
  }
}

beforeEach(() => {
  h.costs.length = 0
  h.raw.length = 0
  h.baselines.length = 0
  h.convs.length = 0
})

describe("baseline de usage por thread", () => {
  it("grava e devolve o acumulado da thread", async () => {
    await saveUsageBaseline("t-1", "conv-1", {
      input: 35005,
      cached_input: 27136,
      output: 12,
    })
    expect(await loadUsageBaseline("t-1", "conv-1", ["codex"])).toEqual({
      input: 35005,
      cached_input: 27136,
      output: 12,
    })
  })

  it("thread sem baseline SEMEIA da última linha antiga da conversa", async () => {
    // sem isso, o 1º turno depois da atualização cobraria a thread inteira de
    // novo (era US$ 160 num turno só no banco real).
    h.costs.push(
      cost({ run_id: "r1", created_at: 1, input_tokens: 100, cache_tokens: 90, output_tokens: 5 }),
      cost({
        run_id: "r2",
        created_at: 2,
        input_tokens: 195249694,
        cache_tokens: 185871872,
        output_tokens: 673076,
      }),
    )
    expect(await loadUsageBaseline("t-1", "conv-1", ["codex"])).toEqual({
      input: 195249694,
      cached_input: 185871872,
      output: 673076,
    })
    // e a semeadura fica gravada (não se repete a cada turno)
    expect(h.baselines).toHaveLength(1)
  })

  it("conversa cuja última linha já é do mundo novo não semeia nada", async () => {
    h.costs.push(
      cost({
        run_id: "r1",
        created_at: 1,
        input_tokens: 17511,
        usage_basis: "delta",
      }),
    )
    expect(await loadUsageBaseline("t-1", "conv-1", ["codex"])).toBeNull()
    expect(h.baselines).toHaveLength(0)
  })

  it("motor sem acumulado não semeia baseline de conversa nenhuma", async () => {
    h.costs.push(cost({ run_id: "r1", created_at: 1, agent: "claude-code", input_tokens: 900 }))
    expect(await loadUsageBaseline("s-1", "conv-1", ["codex"])).toBeNull()
  })
})

describe("reconstrução do histórico inflado", () => {
  it("reescreve as linhas com o gasto do turno, guarda o original e carimba", async () => {
    // fixture REAL (banco do usuário, conversa que somava US$ 4.166): três
    // acumulados seguidos da mesma conversa.
    h.convs.push({ id: "conv-1", session_id: "t-viva" })
    h.costs.push(
      cost({ run_id: "a", created_at: 10, cost_usd: 7.39, input_tokens: 8966203, cache_tokens: 8666368, output_tokens: 51776 }),
      cost({ run_id: "b", created_at: 20, cost_usd: 8.76, input_tokens: 9757471, cache_tokens: 9277696, output_tokens: 57354 }),
      cost({ run_id: "c", created_at: 30, cost_usd: 16.27, input_tokens: 16962418, cache_tokens: 15958784, output_tokens: 109100 }),
    )
    const antes = await countCumulativeLedgerRows(["codex"])
    expect(antes.rows).toBe(3)
    expect(antes.total).toBeCloseTo(32.42, 2)

    const out = await recomputeCumulativeLedger(["codex"])
    expect(out.rows).toBe(3)
    expect(out.before).toBeCloseTo(32.42, 2)
    expect(out.after).toBeCloseTo(16.27, 2)

    const b = h.costs.find((c) => c.run_id === "b")!
    expect(b.cost_usd).toBeCloseTo(1.37, 2)
    expect(b.input_tokens).toBe(9757471 - 8966203)
    expect(b.usage_basis).toBe("recomputed")
    // original preservado (nada é apagado)
    expect(h.raw.find((r) => r.run_id === "b")?.cost_usd).toBe(8.76)
    // thread viva re-baseada com o acumulado CRU da última linha
    expect(h.baselines[0]).toMatchObject({
      thread_id: "t-viva",
      input: 16962418,
      cached_input: 15958784,
    })
  })

  it("não atropela o baseline de uma thread que já rodou turno corrigido", async () => {
    h.convs.push({ id: "conv-1", session_id: "t-viva" })
    h.baselines.push({
      thread_id: "t-viva",
      conv_id: "conv-1",
      input: 200_000_000,
      cached_input: 190_000_000,
      output: 700_000,
    })
    h.costs.push(
      cost({ run_id: "a", created_at: 10, cost_usd: 7.39, input_tokens: 8966203 }),
      cost({ run_id: "b", created_at: 20, cost_usd: 8.76, input_tokens: 9757471 }),
    )
    await recomputeCumulativeLedger(["codex"])
    expect(h.baselines[0].input).toBe(200_000_000)
  })

  it("rodar de novo não mexe em nada (idempotente)", async () => {
    h.costs.push(
      cost({ run_id: "a", created_at: 10, cost_usd: 2.1, input_tokens: 2108925 }),
      cost({ run_id: "b", created_at: 20, cost_usd: 2.3, input_tokens: 2240281 }),
    )
    await recomputeCumulativeLedger(["codex"])
    const depois = h.costs.map((c) => ({ ...c }))
    const segunda = await recomputeCumulativeLedger(["codex"])
    expect(segunda).toEqual({ rows: 0, before: 0, after: 0 })
    expect(h.costs).toEqual(depois)
    expect(await countCumulativeLedgerRows(["codex"])).toEqual({
      rows: 0,
      total: 0,
    })
  })

  it("linha de motor que reporta por turno não é tocada", async () => {
    h.costs.push(
      cost({ run_id: "cc1", created_at: 10, agent: "claude-code", cost_usd: 5, input_tokens: 1000 }),
      cost({ run_id: "cc2", created_at: 20, agent: "claude-code", cost_usd: 6, input_tokens: 1200 }),
    )
    const out = await recomputeCumulativeLedger(["codex"])
    expect(out.rows).toBe(0)
    expect(h.costs.map((c) => c.cost_usd)).toEqual([5, 6])
    expect(h.costs.every((c) => c.usage_basis == null)).toBe(true)
  })
})
