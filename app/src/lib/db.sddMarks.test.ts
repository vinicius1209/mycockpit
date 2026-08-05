// ADR-032, o SQL das marcas de plano SDD (`sdd_plan_marks`): idempotência da
// adoção, "adotar limpa o ignorado" e a ASSIMETRIA do ignorar (INSERT grava
// adopted_at NULL, DO UPDATE preserva a adoção). Sem isto, as afirmações do ADR
// viviam só nos comentários — os testes do inbox mockam `@/lib/db` inteiro e
// nunca tocam nestes statements.
//
// Fake SQLite mínimo (mesmo padrão de db.cards.test / db.missions.test): cada
// statement que o db.ts emite tem um handler que aplica a semântica REAL do
// sqlite (COALESCE, excluded, ON CONFLICT). SQL não mapeado LANÇA — mudou o
// statement, o teste avisa antes da produção.

import { beforeEach, describe, expect, it, vi } from "vitest"

interface Row {
  project_id: string
  slug: string
  adopted_at: number | null
  ignored_at: number | null
}

const h = vi.hoisted(() => ({
  rows: [] as Row[],
  /** Ordem dos DELETEs do hard delete (a marca é estado vivo: tem que cair). */
  deleted: [] as string[],
}))

/** Espaço colapsado: os statements do db.ts são multi-linha e indentados. */
const norm = (sql: string) => sql.replace(/\s+/g, " ").trim()

const ADOPT_SQL =
  "INSERT INTO sdd_plan_marks (project_id, slug, adopted_at, ignored_at) " +
  "VALUES ($1, $2, $3, NULL) ON CONFLICT(project_id, slug) DO UPDATE SET " +
  "adopted_at = COALESCE(sdd_plan_marks.adopted_at, excluded.adopted_at), " +
  "ignored_at = NULL"

const IGNORE_SQL =
  "INSERT INTO sdd_plan_marks (project_id, slug, adopted_at, ignored_at) " +
  "VALUES ($1, $2, NULL, $3) ON CONFLICT(project_id, slug) DO UPDATE SET " +
  "ignored_at = excluded.ignored_at"

function find(projectId: string, slug: string): Row | undefined {
  return h.rows.find((r) => r.project_id === projectId && r.slug === slug)
}

vi.mock("@tauri-apps/plugin-sql", () => {
  const fakeDb = {
    execute: async (rawSql: string, params: unknown[] = []) => {
      const sql = norm(rawSql)
      if (sql.startsWith("CREATE TABLE") || sql.startsWith("ALTER TABLE")) {
        return { rowsAffected: 0 }
      }
      if (sql.startsWith("CREATE INDEX") || sql.startsWith("CREATE UNIQUE INDEX")) {
        return { rowsAffected: 0 }
      }
      if (sql === ADOPT_SQL) {
        const [projectId, slug, now] = params as [string, string, number]
        const row = find(projectId, slug)
        if (!row) {
          h.rows.push({
            project_id: projectId,
            slug,
            adopted_at: now,
            ignored_at: null,
          })
          return { rowsAffected: 1 }
        }
        // COALESCE(existente, novo): o 1º adopted_at manda. ignored_at = NULL.
        row.adopted_at = row.adopted_at ?? now
        row.ignored_at = null
        return { rowsAffected: 1 }
      }
      if (sql === IGNORE_SQL) {
        const [projectId, slug, ignoredAt] = params as [
          string,
          string,
          number | null,
        ]
        const row = find(projectId, slug)
        if (!row) {
          // INSERT grava adopted_at NULL: ignorar NÃO adota.
          h.rows.push({
            project_id: projectId,
            slug,
            adopted_at: null,
            ignored_at: ignoredAt,
          })
          return { rowsAffected: 1 }
        }
        // DO UPDATE só mexe em ignored_at: a adoção existente sobrevive.
        row.ignored_at = ignoredAt
        return { rowsAffected: 1 }
      }
      if (sql.startsWith("DELETE FROM sdd_plan_marks WHERE project_id")) {
        const [projectId] = params as [string]
        h.deleted.push("sdd_plan_marks")
        for (let i = h.rows.length - 1; i >= 0; i--) {
          if (h.rows[i].project_id === projectId) h.rows.splice(i, 1)
        }
        return { rowsAffected: 1 }
      }
      const outros = ["schedules", "cards", "conversations", "projects"]
      for (const t of outros) {
        if (sql.startsWith(`DELETE FROM ${t} `)) {
          h.deleted.push(t)
          return { rowsAffected: 1 }
        }
      }
      throw new Error(`SQL não mapeado no fake (execute): ${sql}`)
    },
    select: async (rawSql: string) => {
      const sql = norm(rawSql)
      if (
        sql ===
        "SELECT project_id, slug, adopted_at, ignored_at FROM sdd_plan_marks"
      ) {
        return h.rows.map((r) => ({ ...r }))
      }
      throw new Error(`SQL não mapeado no fake (select): ${sql}`)
    },
  }
  return { default: { load: async () => fakeDb } }
})

// isTauri() exige window.__TAURI_INTERNALS__ (ambiente node não tem window).
;(globalThis as Record<string, unknown>).window = { __TAURI_INTERNALS__: {} }

import {
  adoptSddPlan,
  hardDeleteProject,
  listSddPlanMarks,
  setSddPlanIgnored,
} from "@/lib/db"

const P = "p-ingresso"
const SLUG = "sdd-auth-05-mobile-mfa"

beforeEach(() => {
  h.rows.length = 0
  h.deleted.length = 0
})

describe("adoptSddPlan", () => {
  it("marca a adoção com o instante do gesto, sem ignorar nada", async () => {
    await adoptSddPlan(P, SLUG, 1_000)
    const marks = await listSddPlanMarks()
    expect(marks).toEqual([
      { projectId: P, slug: SLUG, adoptedAt: 1_000, ignoredAt: null },
    ])
  })

  it("é IDEMPOTENTE: a 2ª adoção mantém o adopted_at da 1ª", async () => {
    await adoptSddPlan(P, SLUG, 1_000)
    await adoptSddPlan(P, SLUG, 9_999)
    const marks = await listSddPlanMarks()
    expect(marks).toHaveLength(1)
    expect(marks?.[0].adoptedAt).toBe(1_000)
  })

  it("adotar LIMPA o ignorado: encostar no plano é dizer que ele voltou a importar", async () => {
    await setSddPlanIgnored(P, SLUG, true, 500)
    await adoptSddPlan(P, SLUG, 1_000)
    const [m] = (await listSddPlanMarks()) ?? []
    expect(m.ignoredAt).toBeNull()
    expect(m.adoptedAt).toBe(1_000)
  })

  it("a chave é (projeto, slug): mesmo slug em outro projeto é outra linha", async () => {
    await adoptSddPlan(P, SLUG, 1_000)
    await adoptSddPlan("p-outro", SLUG, 2_000)
    const marks = (await listSddPlanMarks()) ?? []
    expect(marks).toHaveLength(2)
    expect(marks.map((m) => m.projectId).sort()).toEqual(["p-ingresso", "p-outro"])
  })
})

describe("setSddPlanIgnored", () => {
  it("ignorar plano NUNCA tocado grava adopted_at NULL (ignorar não adota)", async () => {
    await setSddPlanIgnored(P, SLUG, true, 500)
    const [m] = (await listSddPlanMarks()) ?? []
    expect(m.adoptedAt).toBeNull()
    expect(m.ignoredAt).toBe(500)
  })

  it("ignorar plano ADOTADO preserva a adoção (o INSERT não zera o adopted_at)", async () => {
    await adoptSddPlan(P, SLUG, 1_000)
    await setSddPlanIgnored(P, SLUG, true, 2_000)
    const [m] = (await listSddPlanMarks()) ?? []
    expect(m.adoptedAt).toBe(1_000)
    expect(m.ignoredAt).toBe(2_000)
  })

  it("desfazer o ignorar de um plano adotado devolve ele ao badge", async () => {
    await adoptSddPlan(P, SLUG, 1_000)
    await setSddPlanIgnored(P, SLUG, true, 2_000)
    await setSddPlanIgnored(P, SLUG, false, 3_000)
    const [m] = (await listSddPlanMarks()) ?? []
    expect(m.ignoredAt).toBeNull()
    expect(m.adoptedAt).toBe(1_000) // continua pendência de verdade
  })

  it("desfazer o ignorar de um plano só DESCOBERTO não o promove a adotado", async () => {
    await setSddPlanIgnored(P, SLUG, true, 500)
    await setSddPlanIgnored(P, SLUG, false, 600)
    const [m] = (await listSddPlanMarks()) ?? []
    expect(m.ignoredAt).toBeNull()
    expect(m.adoptedAt).toBeNull() // volta pra "Encontrados no projeto"
  })

  it("devolve true quando gravou (a UI só some com o item se houve escrita)", async () => {
    expect(await setSddPlanIgnored(P, SLUG, true, 500)).toBe(true)
  })
})

describe("hardDeleteProject", () => {
  it("apaga as marcas do projeto excluído (marca é estado vivo, não histórico)", async () => {
    await adoptSddPlan(P, SLUG, 1_000)
    await setSddPlanIgnored(P, "sdd-auth-06-cleanup", true, 1_500)
    await adoptSddPlan("p-outro", SLUG, 2_000)
    await hardDeleteProject(P)
    expect(h.deleted).toContain("sdd_plan_marks")
    const marks = (await listSddPlanMarks()) ?? []
    expect(marks).toEqual([
      { projectId: "p-outro", slug: SLUG, adoptedAt: 2_000, ignoredAt: null },
    ])
  })
})
