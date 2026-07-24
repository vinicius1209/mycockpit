// Índice de missões (histórico no banco): upsert preserva created_at e
// atualiza status/custo; list ordena por updated_at DESC e filtra por projeto.
// Fake SQLite mínimo (mesmo padrão do db.cards.test): a escrita muta um array,
// a leitura filtra/ordena.
import { beforeEach, describe, expect, it, vi } from "vitest"

interface Row {
  id: string
  slug: string
  dir: string
  conv_id: string
  project_id: string
  task: string
  preset_name: string | null
  status: string
  cost_total: number
  phase_current: number
  phase_count: number
  created_at: number
  updated_at: number
}

const h = vi.hoisted(() => ({ rows: [] as Row[] }))

vi.mock("@tauri-apps/plugin-sql", () => {
  const fakeDb = {
    execute: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("CREATE TABLE") || sql.startsWith("CREATE INDEX")) {
        return { rowsAffected: 0 }
      }
      if (sql.startsWith("INSERT INTO missions")) {
        const [
          id,
          slug,
          dir,
          conv_id,
          project_id,
          task,
          preset_name,
          status,
          cost_total,
          phase_current,
          phase_count,
          ts,
        ] = params as [
          string, string, string, string, string, string,
          string | null, string, number, number, number, number,
        ]
        const existing = h.rows.find((r) => r.id === id)
        if (existing) {
          // ON CONFLICT: preserva created_at, atualiza o resto.
          Object.assign(existing, {
            task, preset_name, status, cost_total,
            phase_current, phase_count, updated_at: ts,
          })
        } else {
          h.rows.push({
            id, slug, dir, conv_id, project_id, task, preset_name, status,
            cost_total, phase_current, phase_count, created_at: ts, updated_at: ts,
          })
        }
        return { rowsAffected: 1 }
      }
      throw new Error(`SQL não mapeado (execute): ${sql}`)
    },
    select: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("WHERE project_id")) {
        const [pid] = params as [string]
        return h.rows
          .filter((r) => r.project_id === pid)
          .sort((a, b) => b.updated_at - a.updated_at)
          .map((r) => ({ ...r }))
      }
      return [...h.rows].sort((a, b) => b.updated_at - a.updated_at).map((r) => ({ ...r }))
    },
  }
  return { default: { load: async () => fakeDb } }
})

;(globalThis as Record<string, unknown>).window = { __TAURI_INTERNALS__: {} }

import { listMissions, upsertMission, type MissionIndexRow } from "@/lib/db"

function row(over: Partial<MissionIndexRow> = {}): MissionIndexRow {
  return {
    id: "m1",
    slug: "2026-07-24-abc-tarefa",
    dir: ".mycockpit/missions/2026-07-24-abc-tarefa",
    convId: "c1",
    projectId: "p1",
    task: "tarefa",
    presetName: "Feature completa",
    status: "running",
    costTotal: 0,
    phaseCurrent: 0,
    phaseCount: 3,
    createdAt: 100,
    updatedAt: 100,
    ...over,
  }
}

beforeEach(() => {
  h.rows.length = 0
})

describe("índice de missões (banco)", () => {
  it("upsert insere e depois atualiza status/custo preservando created_at", async () => {
    await upsertMission(row({ createdAt: 100, updatedAt: 100 }))
    await upsertMission(
      row({ status: "done", costTotal: 12.5, phaseCurrent: 3, updatedAt: 500 }),
    )
    const all = await listMissions()
    expect(all).toHaveLength(1) // upsert, não duplica
    expect(all[0].status).toBe("done")
    expect(all[0].costTotal).toBe(12.5)
    expect(all[0].createdAt).toBe(100) // ON CONFLICT preserva a criação
    expect(all[0].updatedAt).toBe(500)
  })

  it("list ordena por updated_at DESC e filtra por projeto", async () => {
    await upsertMission(row({ id: "a", projectId: "p1", updatedAt: 100 }))
    await upsertMission(row({ id: "b", projectId: "p1", updatedAt: 300 }))
    await upsertMission(row({ id: "c", projectId: "p2", updatedAt: 200 }))
    expect((await listMissions()).map((m) => m.id)).toEqual(["b", "c", "a"])
    expect((await listMissions("p1")).map((m) => m.id)).toEqual(["b", "a"])
  })
})
