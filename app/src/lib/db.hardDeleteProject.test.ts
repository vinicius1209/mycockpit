// "Excluir de vez" um projeto arquivado (S1.3). O caso vivia em
// `db.sddMarks.test.ts` e ficou sem casa quando a aba Features saiu
// (remocao-features-prd, guarda G3): o que o hard delete apaga, e o que ele
// NUNCA apaga, continua sendo contrato.
//
// Fake SQLite mínimo (padrão de db.cards.test): statement não mapeado LANÇA,
// então tocar numa tabela de métrica (turn_costs, stage_runs, deliveries,
// lessons) ou na tabela inerte `sdd_plan_marks` quebra o teste.

import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ deleted: [] as { table: string; params: unknown[] }[] }))

const norm = (sql: string) => sql.replace(/\s+/g, " ").trim()

vi.mock("@tauri-apps/plugin-sql", () => {
  const fakeDb = {
    execute: async (rawSql: string, params: unknown[] = []) => {
      const sql = norm(rawSql)
      if (/^(CREATE (TABLE|INDEX|UNIQUE INDEX)|ALTER TABLE)/.test(sql)) {
        if (sql.includes("sdd_plan_marks")) {
          throw new Error("hard delete não pode recriar a tabela inerte do SDD")
        }
        return { rowsAffected: 0 }
      }
      if (sql.startsWith("DELETE FROM schedule_runs WHERE schedule_id IN")) {
        h.deleted.push({ table: "schedule_runs", params })
        return { rowsAffected: 1 }
      }
      for (const t of ["schedules", "cards", "conversations", "projects"]) {
        if (sql.startsWith(`DELETE FROM ${t} `)) {
          h.deleted.push({ table: t, params })
          return { rowsAffected: 1 }
        }
      }
      throw new Error(`SQL não mapeado no fake (execute): ${sql}`)
    },
    select: async (rawSql: string) => {
      throw new Error(`SQL não mapeado no fake (select): ${norm(rawSql)}`)
    },
  }
  return { default: { load: async () => fakeDb } }
})

// isTauri() exige window.__TAURI_INTERNALS__ (ambiente node não tem window).
;(globalThis as Record<string, unknown>).window = { __TAURI_INTERNALS__: {} }

import { hardDeleteProject } from "@/lib/db"

beforeEach(() => {
  h.deleted.length = 0
})

describe("hardDeleteProject", () => {
  it("apaga agendamentos, cards, conversas e o projeto, nesta ordem", async () => {
    await hardDeleteProject("p-1")
    expect(h.deleted.map((d) => d.table)).toEqual([
      "schedule_runs",
      "schedules",
      "cards",
      "conversations",
      "projects",
    ])
  })

  it("todo DELETE é do projeto pedido, nunca de outro", async () => {
    await hardDeleteProject("p-1")
    for (const d of h.deleted) expect(d.params).toEqual(["p-1"])
  })
})
