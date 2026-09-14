// O custo histórico da aba Features (removida) continua no Painel
// (remocao-features-prd D2, requisito R5). `stage_runs` não recebe mais linha
// nenhuma, mas o dinheiro que ela registra foi gasto de verdade: se ela sair do
// UNION do ledger, os totais de 30 dias e o acumulado por projeto caem para
// quem usou o SDD, sem aviso. Este teste é a trava contra essa "limpeza".

import { describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ selects: [] as string[] }))

const norm = (sql: string) => sql.replace(/\s+/g, " ").trim()

vi.mock("@tauri-apps/plugin-sql", () => {
  const fakeDb = {
    execute: async (rawSql: string) => {
      const sql = norm(rawSql)
      if (/^(CREATE (TABLE|INDEX|UNIQUE INDEX)|ALTER TABLE)/.test(sql)) {
        return { rowsAffected: 0 }
      }
      throw new Error(`SQL não mapeado no fake (execute): ${sql}`)
    },
    select: async (rawSql: string) => {
      const sql = norm(rawSql)
      h.selects.push(sql)
      if (sql.includes("FROM turn_costs") && sql.includes("FROM stage_runs")) {
        return [
          { agent: "claude-code", project_id: "p1", cost_usd: 1.25, tokens: 900, created_at: 20 },
          { agent: "codex", project_id: "p1", cost_usd: 0.75, tokens: 0, created_at: 10 },
        ]
      }
      throw new Error(`SQL não mapeado no fake (select): ${sql}`)
    },
  }
  return { default: { load: async () => fakeDb } }
})

// isTauri() exige window.__TAURI_INTERNALS__ (ambiente node não tem window).
;(globalThis as Record<string, unknown>).window = { __TAURI_INTERNALS__: {} }

import { loadLedger } from "@/lib/db"

describe("loadLedger: histórico de stage_runs", () => {
  it("segue somando as etapas antigas do SDD junto dos turnos", async () => {
    const rows = await loadLedger(0)
    const [sql] = h.selects
    expect(sql).toContain("UNION ALL")
    expect(sql).toContain("FROM stage_runs WHERE created_at >= $1")
    expect(rows.reduce((t, r) => t + (r.costUsd ?? 0), 0)).toBe(2)
  })

  it("nada no app volta a GRAVAR em stage_runs", () => {
    const fontes = import.meta.glob(["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}"], {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>
    // o glob tem que ter varrido o app de verdade, senão o teste passa vazio
    expect(Object.keys(fontes)).toContain("/src/lib/db.ts")
    const gravam = Object.entries(fontes)
      .filter(([, src]) => /INSERT\s+INTO\s+stage_runs/i.test(src))
      .map(([path]) => path)
    expect(gravam).toEqual([])
  })
})
