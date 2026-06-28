import Database from "@tauri-apps/plugin-sql"
import type { Project } from "@/lib/types"
import type { ChatItem } from "@/store/chat"
import type { ConvRef } from "@/lib/attachments"
import type { FusionRun } from "@/store/fusion"

const DB_URL = "sqlite:mycockpit.db" // DEVE bater com add_migrations no lib.rs

let dbPromise: Promise<Database> | null = null

/** Estamos rodando dentro do runtime do Tauri? (vs. `vite dev` no browser) */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

async function getDb(): Promise<Database | null> {
  if (!isTauri()) return null
  if (!dbPromise) dbPromise = Database.load(DB_URL)
  return dbPromise
}

interface ProjectRow {
  id: string
  name: string
  path: string
  created_at: number
  has_claude_md: number
  has_agents_md: number
  permission_mode: string
}

function toProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    createdAt: r.created_at,
    hasClaudeMd: r.has_claude_md === 1,
    hasAgentsMd: r.has_agents_md === 1,
    permissionMode: (r.permission_mode as Project["permissionMode"]) ?? "padrao",
    status: "idle",
  }
}

export async function listProjects(): Promise<Project[] | null> {
  const db = await getDb()
  if (!db) return null
  const rows = await db.select<ProjectRow[]>(
    "SELECT id, name, path, created_at, has_claude_md, has_agents_md, permission_mode FROM projects ORDER BY created_at DESC",
  )
  return rows.map(toProject)
}

export async function insertProject(p: Project): Promise<boolean> {
  const db = await getDb()
  if (!db) return false
  await db.execute(
    "INSERT OR IGNORE INTO projects (id, name, path, created_at, has_claude_md, has_agents_md, permission_mode) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [
      p.id,
      p.name,
      p.path,
      p.createdAt,
      p.hasClaudeMd ? 1 : 0,
      p.hasAgentsMd ? 1 : 0,
      p.permissionMode ?? "padrao",
    ],
  )
  return true
}

export async function updateProjectPermission(
  projectId: string,
  mode: string,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await db.execute("UPDATE projects SET permission_mode = $1 WHERE id = $2", [
    mode,
    projectId,
  ])
}

export interface ConversationMeta {
  id: string
  title: string | null
  updatedAt: number
}

interface ConvListRow {
  id: string
  title: string | null
  updated_at: number
}

/** Lista as conversas de um projeto em ordem de criação (estável; novas embaixo). */
export async function listConversations(
  projectId: string,
): Promise<ConversationMeta[] | null> {
  const db = await getDb()
  if (!db) return null
  const rows = await db.select<ConvListRow[]>(
    "SELECT id, title, updated_at FROM conversations WHERE project_id = $1 ORDER BY created_at ASC",
    [projectId],
  )
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }))
}

interface ConvLoadRow {
  session_id: string | null
  items: string
  title: string | null
  suggestions: string | null
  agent: string | null
  req_model: string | null
  effort: string | null
}

export async function loadConversation(
  id: string,
): Promise<{
  sessionId: string | null
  items: ChatItem[]
  title: string | null
  suggestions: string[]
  agent: string
  reqModel: string | null
  effort: string | null
} | null> {
  const db = await getDb()
  if (!db) return null
  const rows = await db.select<ConvLoadRow[]>(
    "SELECT session_id, items, title, suggestions, agent, req_model, effort FROM conversations WHERE id = $1",
    [id],
  )
  if (!rows.length) return null
  try {
    return {
      sessionId: rows[0].session_id,
      items: JSON.parse(rows[0].items) as ChatItem[],
      title: rows[0].title,
      suggestions: rows[0].suggestions
        ? (JSON.parse(rows[0].suggestions) as string[])
        : [],
      agent: rows[0].agent ?? "claude-code",
      reqModel: rows[0].req_model,
      effort: rows[0].effort,
    }
  } catch {
    return null
  }
}

/** Cria uma conversa vazia. O `id` é gerado pelo chamador (crypto.randomUUID). */
export async function createConversation(
  projectId: string,
  id: string,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  const now = Date.now()
  await db.execute(
    "INSERT INTO conversations (id, project_id, title, session_id, items, created_at, updated_at) VALUES ($1, $2, NULL, NULL, '[]', $3, $3)",
    [id, projectId, now],
  )
}

export async function saveConversation(
  id: string,
  projectId: string,
  title: string | null,
  sessionId: string | null,
  items: ChatItem[],
  suggestions: string[],
  agent: string,
  reqModel: string | null,
  effort: string | null,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await db.execute(
    "INSERT INTO conversations (id, project_id, title, session_id, items, suggestions, agent, req_model, effort, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) ON CONFLICT(id) DO UPDATE SET title = excluded.title, session_id = excluded.session_id, items = excluded.items, suggestions = excluded.suggestions, agent = excluded.agent, req_model = excluded.req_model, effort = excluded.effort, updated_at = excluded.updated_at",
    [
      id,
      projectId,
      title,
      sessionId,
      JSON.stringify(items),
      JSON.stringify(suggestions),
      agent,
      reqModel,
      effort,
      Date.now(),
    ],
  )
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDb()
  if (!db) return
  await db.execute("DELETE FROM conversations WHERE id = $1", [id])
}

/** Arquiva uma disputa de Fusion (auditável pós-restart; alimenta "ver disputa"). */
export async function saveFusionRun(
  id: string,
  convId: string,
  data: unknown,
  pending: boolean,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await db.execute(
    "INSERT INTO fusion_runs (id, conv_id, data, created_at, pending) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(id) DO UPDATE SET data = excluded.data, pending = excluded.pending",
    [id, convId, JSON.stringify(data), Date.now(), pending ? 1 : 0],
  )
}

/** Disputas arquivadas de uma conversa (mais antiga primeiro). */
export async function loadFusionRuns(convId: string): Promise<unknown[]> {
  const db = await getDb()
  if (!db) return []
  try {
    const rows = await db.select<{ data: string }[]>(
      "SELECT data FROM fusion_runs WHERE conv_id = $1 ORDER BY created_at ASC",
      [convId],
    )
    return rows.map((r) => JSON.parse(r.data))
  } catch {
    return []
  }
}

/** A disputa PENDENTE (esperando decisão) de uma conversa, se houver — caso 2. */
export async function loadPendingFusion(
  convId: string,
): Promise<FusionRun | null> {
  const db = await getDb()
  if (!db) return null
  try {
    const rows = await db.select<{ data: string }[]>(
      "SELECT data FROM fusion_runs WHERE conv_id = $1 AND pending = 1 ORDER BY created_at DESC LIMIT 1",
      [convId],
    )
    if (!rows.length) return null
    return JSON.parse(rows[0].data) as FusionRun
  } catch {
    return null
  }
}

/** Marca as disputas pendentes da conversa como resolvidas (descartar). */
export async function clearPendingFusion(convId: string): Promise<void> {
  const db = await getDb()
  if (!db) return
  await db.execute(
    "UPDATE fusion_runs SET pending = 0 WHERE conv_id = $1 AND pending = 1",
    [convId],
  )
}

/** Refs de TODAS as conversas (id + updatedAt) p/ o GC de anexos. Retorna `null`
 *  em qualquer falha/não-Tauri (F1: o boot NÃO chama o GC com null — só com `[]`
 *  o GC pode rodar o orphan-sweep). */
export async function listConvRefs(): Promise<ConvRef[] | null> {
  const db = await getDb()
  if (!db) return null
  try {
    const rows = await db.select<{ id: string; updated_at: number }[]>(
      "SELECT id, updated_at FROM conversations",
    )
    return rows.map((r) => ({ id: r.id, updated_at: r.updated_at }))
  } catch {
    return null
  }
}
