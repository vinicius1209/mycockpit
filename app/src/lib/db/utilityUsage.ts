// O uso das inferências auxiliares por dia, tarefa e fonte. Morava junto do
// resumo da aba Conversa (`conversationMaps.ts`), que saiu inteiro no
// ADR-233; o uso continua valendo para as tarefas do helper.

import type Database from "@tauri-apps/plugin-sql"
import { getDb } from "@/lib/db"
import type { UtilityTaskKind } from "@/lib/utility/types"

let tableReady: Promise<void> | null = null

async function ensureUtilityUsageTable(db: Database): Promise<void> {
  if (!tableReady) {
    tableReady = db
      .execute(
        `CREATE TABLE IF NOT EXISTS utility_usage_daily (
          day TEXT NOT NULL,
          task TEXT NOT NULL,
          source_id TEXT NOT NULL,
          calls INTEGER NOT NULL DEFAULT 0,
          successes INTEGER NOT NULL DEFAULT 0,
          unpriced_calls INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          last_latency_ms INTEGER,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (day, task, source_id)
        )`,
      )
      .then(() => undefined)
      .catch((error) => {
        tableReady = null
        throw error
      })
  }
  return tableReady
}

export interface UtilityUsageSample {
  task: UtilityTaskKind
  sourceId: string
  ok: boolean
  costUsd: number | null
  inputTokens?: number
  outputTokens?: number
  latencyMs?: number
  at?: number
}

export async function recordUtilityUsage(sample: UtilityUsageSample): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureUtilityUsageTable(db)
  const now = sample.at ?? Date.now()
  const day = new Date(now).toISOString().slice(0, 10)
  await db.execute(
    `INSERT INTO utility_usage_daily (
      day, task, source_id, calls, successes, unpriced_calls, cost_usd,
      input_tokens, output_tokens, last_latency_ms, updated_at
    ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT(day, task, source_id) DO UPDATE SET
      calls = calls + 1,
      successes = successes + excluded.successes,
      unpriced_calls = unpriced_calls + excluded.unpriced_calls,
      cost_usd = cost_usd + excluded.cost_usd,
      input_tokens = input_tokens + excluded.input_tokens,
      output_tokens = output_tokens + excluded.output_tokens,
      last_latency_ms = excluded.last_latency_ms,
      updated_at = excluded.updated_at`,
    [
      day,
      sample.task,
      sample.sourceId,
      sample.ok ? 1 : 0,
      sample.costUsd == null ? 1 : 0,
      sample.costUsd ?? 0,
      sample.inputTokens ?? 0,
      sample.outputTokens ?? 0,
      sample.latencyMs ?? null,
      now,
    ],
  )
}
