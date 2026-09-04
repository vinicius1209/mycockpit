import type Database from "@tauri-apps/plugin-sql"
import { getDb } from "@/lib/db"
import {
  EMPTY_CONVERSATION_MAP_PINS,
  type ConversationMapPinsV1,
  type SemanticConversationMapV1,
  type StoredConversationMap,
} from "@/lib/conversationMap/types"
import type { UtilityTaskKind } from "@/lib/utility/types"

let tablesReady: Promise<void> | null = null

export async function ensureConversationMapTables(db: Database): Promise<void> {
  if (!tablesReady) {
    const run = (async () => {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS conversation_maps (
          conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
          schema_version INTEGER NOT NULL,
          prompt_version INTEGER NOT NULL,
          payload_json TEXT NOT NULL,
          summarized_through_item_id TEXT,
          summarized_through_ts INTEGER,
          input_digest TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          source_id TEXT NOT NULL,
          source_fingerprint TEXT,
          generation_mode TEXT NOT NULL,
          generated_at INTEGER NOT NULL,
          latency_ms INTEGER,
          turns_since_rebase INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL,
          cost_source TEXT
        )`,
      )
      await db.execute(
        `CREATE TABLE IF NOT EXISTS conversation_map_pins (
          conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
          schema_version INTEGER NOT NULL,
          revision INTEGER NOT NULL,
          pins_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
      )
      await db.execute(
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
    })()
    tablesReady = run.catch((error) => {
      tablesReady = null
      throw error
    })
  }
  return tablesReady
}

export function _resetConversationMapTablesForTests(): void {
  tablesReady = null
}

interface MapRow {
  conversation_id: string
  schema_version: number
  prompt_version: number
  payload_json: string
  summarized_through_item_id: string | null
  summarized_through_ts: number | null
  input_digest: string
  source_kind: string
  source_id: string
  source_fingerprint: string | null
  generation_mode: string
  generated_at: number
  latency_ms: number | null
  turns_since_rebase: number
  cost_usd: number | null
  cost_source: string | null
}

function parseMapRow(row: MapRow): StoredConversationMap | "corrupt" {
  try {
    if (
      row.schema_version !== 1 ||
      !["device", "local_process", "remote"].includes(row.source_kind) ||
      !["incremental", "rebase"].includes(row.generation_mode)
    ) {
      return "corrupt"
    }
    const payload = JSON.parse(row.payload_json) as SemanticConversationMapV1
    if (payload?.schemaVersion !== 1) return "corrupt"
    return {
      conversationId: row.conversation_id,
      schemaVersion: 1,
      promptVersion: row.prompt_version,
      payload,
      summarizedThroughItemId: row.summarized_through_item_id,
      summarizedThroughTs: row.summarized_through_ts,
      inputDigest: row.input_digest,
      sourceKind: row.source_kind as StoredConversationMap["sourceKind"],
      sourceId: row.source_id,
      sourceFingerprint: row.source_fingerprint,
      generationMode: row.generation_mode as StoredConversationMap["generationMode"],
      generatedAt: row.generated_at,
      latencyMs: row.latency_ms,
      turnsSinceRebase: row.turns_since_rebase,
      costUsd: row.cost_usd,
      costSource: row.cost_source as StoredConversationMap["costSource"],
    }
  } catch {
    return "corrupt"
  }
}

function validPinText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.normalize("NFC") &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 180
  )
}

export function validConversationMapPins(
  value: unknown,
): value is ConversationMapPinsV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const pins = value as Partial<ConversationMapPinsV1>
  const validPin = (pin: ConversationMapPinsV1["currentFocus"]) =>
    pin == null ||
    (typeof pin.id === "string" &&
      pin.id.length > 0 &&
      validPinText(pin.text) &&
      typeof pin.pinnedAt === "number" &&
      Number.isFinite(pin.pinnedAt))
  return (
    pins.schemaVersion === 1 &&
    Number.isInteger(pins.revision) &&
    (pins.revision ?? -1) >= 0 &&
    validPin(pins.currentFocus) &&
    validPin(pins.explicitGoal) &&
    Array.isArray(pins.constraints) &&
    pins.constraints.length <= 10 &&
    pins.constraints.every(validPin)
  )
}

export async function loadConversationMap(
  conversationId: string,
): Promise<StoredConversationMap | null | "corrupt"> {
  const db = await getDb()
  if (!db) return null
  await ensureConversationMapTables(db)
  const rows = await db.select<MapRow[]>(
    "SELECT * FROM conversation_maps WHERE conversation_id = $1",
    [conversationId],
  )
  return rows[0] ? parseMapRow(rows[0]) : null
}

const MAP_COLUMNS = [
  "schema_version = $2",
  "prompt_version = $3",
  "payload_json = $4",
  "summarized_through_item_id = $5",
  "summarized_through_ts = $6",
  "input_digest = $7",
  "source_kind = $8",
  "source_id = $9",
  "source_fingerprint = $10",
  "generation_mode = $11",
  "generated_at = $12",
  "latency_ms = $13",
  "turns_since_rebase = $14",
  "cost_usd = $15",
  "cost_source = $16",
].join(", ")

function mapParams(row: StoredConversationMap): unknown[] {
  return [
    row.conversationId,
    row.schemaVersion,
    row.promptVersion,
    JSON.stringify(row.payload),
    row.summarizedThroughItemId,
    row.summarizedThroughTs,
    row.inputDigest,
    row.sourceKind,
    row.sourceId,
    row.sourceFingerprint,
    row.generationMode,
    row.generatedAt,
    row.latencyMs,
    row.turnsSinceRebase,
    row.costUsd,
    row.costSource,
  ]
}

export async function saveConversationMapIfCurrent(
  row: StoredConversationMap,
  expectedStoredDigest: string | null,
): Promise<"saved" | "stale"> {
  const db = await getDb()
  if (!db) return "stale"
  await ensureConversationMapTables(db)
  const params = mapParams(row)
  if (expectedStoredDigest == null) {
    const result = await db.execute(
      `INSERT OR IGNORE INTO conversation_maps (
        conversation_id, schema_version, prompt_version, payload_json,
        summarized_through_item_id, summarized_through_ts, input_digest,
        source_kind, source_id, source_fingerprint, generation_mode,
        generated_at, latency_ms, turns_since_rebase, cost_usd, cost_source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      params,
    )
    return result.rowsAffected > 0 ? "saved" : "stale"
  }
  const result = await db.execute(
    `UPDATE conversation_maps SET ${MAP_COLUMNS}
      WHERE conversation_id = $1 AND input_digest = $17`,
    [...params, expectedStoredDigest],
  )
  return result.rowsAffected > 0 ? "saved" : "stale"
}

export async function loadConversationMapPins(
  conversationId: string,
): Promise<ConversationMapPinsV1 | "corrupt"> {
  const db = await getDb()
  if (!db) return EMPTY_CONVERSATION_MAP_PINS
  await ensureConversationMapTables(db)
  const rows = await db.select<
    { schema_version: number; revision: number; pins_json: string }[]
  >(
    "SELECT schema_version, revision, pins_json FROM conversation_map_pins WHERE conversation_id = $1",
    [conversationId],
  )
  if (!rows[0]) return EMPTY_CONVERSATION_MAP_PINS
  try {
    const pins = JSON.parse(rows[0].pins_json) as ConversationMapPinsV1
    return validConversationMapPins(pins) && pins.revision === rows[0].revision
      ? pins
      : "corrupt"
  } catch {
    return "corrupt"
  }
}

export async function saveConversationMapPins(
  conversationId: string,
  pins: ConversationMapPinsV1,
  expectedRevision: number,
): Promise<"saved" | "conflict"> {
  const db = await getDb()
  if (!db) return "conflict"
  await ensureConversationMapTables(db)
  if (
    !validConversationMapPins(pins) ||
    pins.revision !== expectedRevision + 1
  ) {
    return "conflict"
  }
  if (expectedRevision === 0) {
    const inserted = await db.execute(
      "INSERT OR IGNORE INTO conversation_map_pins (conversation_id, schema_version, revision, pins_json, updated_at) VALUES ($1, 1, $2, $3, $4)",
      [conversationId, pins.revision, JSON.stringify(pins), Date.now()],
    )
    if (inserted.rowsAffected > 0) return "saved"
  }
  const updated = await db.execute(
    "UPDATE conversation_map_pins SET schema_version = 1, revision = $2, pins_json = $3, updated_at = $4 WHERE conversation_id = $1 AND revision = $5",
    [conversationId, pins.revision, JSON.stringify(pins), Date.now(), expectedRevision],
  )
  return updated.rowsAffected > 0 ? "saved" : "conflict"
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
  await ensureConversationMapTables(db)
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
