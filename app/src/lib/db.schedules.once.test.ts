// Recorrência "uma vez" na PERSISTÊNCIA: o que sobrevive a fechar o app. O
// Database do plugin-sql é um mini-engine em memória (padrão db.cards.test.ts /
// db.presets.test.ts) com uma diferença: ele conhece as COLUNAS da tabela.
// Statement que cita coluna inexistente lança "no such column", então um drift
// entre o SELECT/INSERT e o ALTER estoura aqui em vez de virar lista vazia em
// produção (listSchedules degrada pra [] em qualquer erro — falha muda).
//
// A tabela nasce como o banco de quem ATUALIZA o app (sem `kind`, sem
// `completed_at`), que é o caminho que ninguém tinha exercitado: é ali que a
// coluna nova ou entra pelo addColumn ou NADA de "uma vez" persiste.

import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  /** Colunas da tabela `schedules` no banco ANTIGO (build anterior ao `kind` e
   *  ao "uma vez"): as duas novas só existem se o ALTER do boot rodar. */
  cols: new Set<string>([
    "id",
    "name",
    "project_id",
    "agent",
    "model",
    "prompt",
    "permission",
    "recurrence",
    "enabled",
    "next_run",
    "last_run_at",
    "last_run_status",
    "created_at",
  ]),
  rows: [] as Record<string, unknown>[],
  runs: [] as Record<string, unknown>[],
  /** Colunas efetivamente acrescentadas por ALTER (prova a migração e a
   *  idempotência: o segundo boot não acrescenta nada). */
  altered: [] as string[],
}))

vi.mock("@tauri-apps/plugin-sql", () => {
  const assertCol = (c: string) => {
    if (!h.cols.has(c)) throw new Error(`no such column: ${c}`)
  }
  const value = (tok: string, params: unknown[]): unknown => {
    if (tok === "NULL") return null
    if (tok.startsWith("$")) return params[Number(tok.slice(1)) - 1] ?? null
    return Number(tok)
  }
  const fakeDb = {
    execute: async (sql: string, params: unknown[] = []) => {
      // a tabela e o índice já existem no banco de quem atualiza o app
      if (sql.startsWith("CREATE TABLE") || sql.startsWith("CREATE INDEX")) {
        return { rowsAffected: 0 }
      }
      const alter = /^ALTER TABLE schedules ADD COLUMN (\w+)/.exec(sql)
      if (alter) {
        const col = alter[1]
        // mensagem REAL do SQLite — é ela que o addColumn reconhece pra engolir
        if (h.cols.has(col)) throw new Error(`duplicate column name: ${col}`)
        h.cols.add(col)
        h.altered.push(col)
        return { rowsAffected: 0 }
      }
      const ins = /^INSERT INTO schedules \(([^)]+)\) VALUES/.exec(sql)
      if (ins) {
        const cols = ins[1].split(",").map((c) => c.trim())
        const row: Record<string, unknown> = {}
        cols.forEach((c, i) => {
          assertCol(c)
          row[c] = params[i] ?? null
        })
        h.rows.push(row)
        return { rowsAffected: 1 }
      }
      const upd = /^UPDATE schedules SET (.+) WHERE id = \$(\d+)$/.exec(sql)
      if (upd) {
        const patch: Record<string, unknown> = {}
        for (const a of upd[1].split(",")) {
          const p = /^\s*(\w+)\s*=\s*(\$\d+|NULL|-?\d+)\s*$/.exec(a)
          if (!p) throw new Error(`atribuição não mapeada no fake: ${a}`)
          assertCol(p[1])
          patch[p[1]] = value(p[2], params)
        }
        const id = params[Number(upd[2]) - 1]
        const row = h.rows.find((r) => r.id === id)
        if (!row) return { rowsAffected: 0 }
        Object.assign(row, patch)
        return { rowsAffected: 1 }
      }
      if (sql.startsWith("DELETE FROM schedule_runs WHERE schedule_id")) {
        const [id] = params as [string]
        h.runs = h.runs.filter((r) => r.schedule_id !== id)
        return { rowsAffected: 1 }
      }
      if (sql.startsWith("DELETE FROM schedules WHERE id")) {
        const [id] = params as [string]
        const i = h.rows.findIndex((r) => r.id === id)
        if (i >= 0) h.rows.splice(i, 1)
        return { rowsAffected: i >= 0 ? 1 : 0 }
      }
      throw new Error(`SQL não mapeado no fake (execute): ${sql}`)
    },
    select: async (sql: string) => {
      const sel = /^SELECT (.+) FROM schedules ORDER BY created_at ASC$/.exec(
        sql.trim(),
      )
      if (sel) {
        const cols = sel[1].split(",").map((c) => c.trim())
        cols.forEach(assertCol)
        return [...h.rows]
          .sort((a, b) => (a.created_at as number) - (b.created_at as number))
          .map((r) =>
            Object.fromEntries(cols.map((c) => [c, r[c] ?? null])),
          )
      }
      throw new Error(`SQL não mapeado no fake (select): ${sql}`)
    },
  }
  return { default: { load: async () => fakeDb } }
})

// isTauri() exige window.__TAURI_INTERNALS__ (ambiente node não tem window).
;(globalThis as Record<string, unknown>).window = { __TAURI_INTERNALS__: {} }

import {
  deleteSchedule,
  insertSchedule,
  listSchedules,
  markScheduleCompleted,
  markScheduleRun,
  rescheduleSchedule,
  setScheduleEnabled,
  type ScheduleRecord,
} from "@/lib/db"
import {
  computeNextRun,
  parseRecurrence,
  scheduleLifecycle,
  splitDueAndMissed,
} from "@/lib/schedules"

const MIN = 60_000
// 25/07/2026 18:30 — o caso real: "hoje às 18:30, merge da PR da release".
const T0 = new Date(2026, 6, 25, 18, 30, 0, 0).getTime()

function rec(over: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id: "s1",
    name: "merge da PR da release",
    projectId: "p1",
    kind: "agent",
    agent: "codex",
    model: null,
    prompt: "faz o merge da PR da release",
    permission: "padrao",
    recurrence: JSON.stringify({ kind: "once", at: T0 }),
    enabled: true,
    nextRun: T0,
    lastRunAt: null,
    lastRunStatus: null,
    completedAt: null,
    createdAt: T0 - 60 * MIN,
    ...over,
  }
}

const byId = async (id: string): Promise<ScheduleRecord> => {
  const found = (await listSchedules())?.find((s) => s.id === id)
  if (!found) throw new Error(`automação ${id} sumiu da lista`)
  return found
}

beforeEach(() => {
  // as COLUNAS não resetam: a migração roda uma vez por processo (o
  // ensureScheduleTables cacheia a promessa), igual ao app.
  h.rows.length = 0
  h.runs.length = 0
})

describe("migração da coluna completed_at", () => {
  it("o boot acrescenta kind e completed_at por ALTER (tabela que nasce do frontend)", async () => {
    await listSchedules()
    expect(h.altered).toEqual(["kind", "completed_at"])
    expect(h.cols.has("completed_at")).toBe(true)
  })
})

describe("round-trip da recorrência", () => {
  it("'uma vez': o registro volta do banco idêntico, com o `at` intacto", async () => {
    const original = rec()
    await insertSchedule(original)

    const lida = await byId("s1")
    expect(lida).toEqual(original)
    // o `at` é o dado que não pode se perder: sem ele não há o que reagendar
    expect(parseRecurrence(lida.recurrence)).toEqual({ kind: "once", at: T0 })
  })

  it("daily, weekly e cron fazem o mesmo round-trip (sem regressão)", async () => {
    const casos = [
      { id: "d", r: { kind: "daily", hour: 3, minute: 0 } },
      { id: "w", r: { kind: "weekly", weekday: 1, hour: 9, minute: 30 } },
      { id: "c", r: { kind: "cron", expr: "*/15 * * * *" } },
    ]
    for (const [i, c] of casos.entries()) {
      await insertSchedule(
        rec({
          id: c.id,
          recurrence: JSON.stringify(c.r),
          createdAt: T0 + i,
        }),
      )
    }

    for (const c of casos) {
      const lida = await byId(c.id)
      expect(parseRecurrence(lida.recurrence)).toEqual(c.r)
      // recorrente nunca nasce (nem fica) marcada como encerrada
      expect(lida.completedAt).toBeNull()
      expect(scheduleLifecycle(lida)).toBe("ativa")
    }
  })
})

describe("encerramento da automação de uma vez", () => {
  it("depois de disparar: desabilitada, sem próxima e carimbada — e a linha CONTINUA na lista", async () => {
    await insertSchedule(rec())

    await markScheduleCompleted("s1", T0 + MIN)

    const lista = (await listSchedules())!
    // o contrato do item: a automação SE ENCERRA, não some (o histórico e o
    // Reagendar dependem de ela continuar existindo).
    expect(lista).toHaveLength(1)
    expect(lista[0]).toMatchObject({
      enabled: false,
      nextRun: null,
      completedAt: T0 + MIN,
    })
    expect(scheduleLifecycle(lista[0])).toBe("concluida")
    expect(parseRecurrence(lista[0].recurrence)).toEqual({
      kind: "once",
      at: T0,
    })
  })

  it("a concluída NUNCA volta pro calendário: nem due, nem missed, nem próximo disparo", async () => {
    await insertSchedule(rec())
    await markScheduleCompleted("s1", T0 + MIN)

    const lida = await byId("s1")
    const depois = T0 + 30 * MIN
    // o motor não acha nada pra rodar nem no tick seguinte...
    expect(splitDueAndMissed([lida], depois)).toEqual({ due: [], missed: [] })
    // ...e a recorrência, mesmo intacta, já não produz horário nenhum.
    expect(computeNextRun(parseRecurrence(lida.recurrence)!, new Date(depois))).toBeNull()
  })

  it("concluída ≠ pausada: pausar é gesto do usuário e NÃO carimba completed_at", async () => {
    // as duas terminam com enabled=0 e next_run=NULL — só o carimbo distingue,
    // e é ele que decide entre "rodou e acabou" e "eu desliguei".
    await insertSchedule(rec({ id: "pausada", createdAt: 1 }))
    await insertSchedule(rec({ id: "concluida", createdAt: 2 }))

    await setScheduleEnabled("pausada", false, null)
    await markScheduleCompleted("concluida", T0 + MIN)

    const pausada = await byId("pausada")
    const concluida = await byId("concluida")
    expect(pausada.enabled).toBe(false)
    expect(pausada.nextRun).toBeNull()
    expect(pausada.completedAt).toBeNull()
    expect(scheduleLifecycle(pausada)).toBe("pausada")
    expect(scheduleLifecycle(concluida)).toBe("concluida")
  })
})

describe("Reagendar (o botão da automação concluída)", () => {
  const novo = T0 + 24 * 60 * MIN

  it("devolve a automação ao calendário: religa, limpa a marca e grava o novo instante", async () => {
    await insertSchedule(rec())
    await markScheduleCompleted("s1", T0 + MIN)

    await rescheduleSchedule(
      "s1",
      JSON.stringify({ kind: "once", at: novo }),
      novo,
    )

    const lida = await byId("s1")
    expect(lida.enabled).toBe(true)
    expect(lida.completedAt).toBeNull()
    expect(lida.nextRun).toBe(novo)
    expect(parseRecurrence(lida.recurrence)).toEqual({ kind: "once", at: novo })
    // volta a ser uma automação viva de verdade, não só verde na tela
    expect(scheduleLifecycle(lida)).toBe("ativa")
    expect(
      computeNextRun(parseRecurrence(lida.recurrence)!, new Date(T0 + MIN)),
    ).toBe(novo)
  })

  it("preserva o histórico da execução que já rodou (reagendar não é recomeçar do zero)", async () => {
    await insertSchedule(rec())
    await markScheduleRun("s1", T0, "ok")
    await markScheduleCompleted("s1", T0 + MIN)

    await rescheduleSchedule(
      "s1",
      JSON.stringify({ kind: "once", at: novo }),
      novo,
    )

    const lida = await byId("s1")
    expect(lida.lastRunAt).toBe(T0)
    expect(lida.lastRunStatus).toBe("ok")
  })
})

describe("exclusão", () => {
  it("excluir é o ÚNICO caminho que tira a automação da lista", async () => {
    await insertSchedule(rec())
    await markScheduleCompleted("s1", T0 + MIN)
    expect((await listSchedules())!).toHaveLength(1)

    await deleteSchedule("s1")

    expect(await listSchedules()).toEqual([])
  })
})

describe("segundo boot, sobre o banco JÁ migrado", () => {
  it("o ALTER duplicado é engolido — a lista não degrada pra vazia", async () => {
    await insertSchedule(rec())

    // novo processo: o cache do ensureScheduleTables se perde e os ALTERs
    // rodam de novo, agora contra colunas que já existem.
    vi.resetModules()
    const fresh = await import("@/lib/db")

    expect(await fresh.listSchedules()).toHaveLength(1)
    // nada foi acrescentado desta vez: só o "duplicate column name" engolido
    expect(h.altered).toEqual(["kind", "completed_at"])
  })
})
