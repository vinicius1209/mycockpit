import Database from "@tauri-apps/plugin-sql"
import type { Project } from "@/lib/types"
import type { ChatItem } from "@/store/chat"

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

interface ConversationRow {
  session_id: string | null
  items: string
}

export async function loadConversation(
  projectId: string,
): Promise<{ sessionId: string | null; items: ChatItem[] } | null> {
  const db = await getDb()
  if (!db) return null
  const rows = await db.select<ConversationRow[]>(
    "SELECT session_id, items FROM conversations WHERE project_id = $1",
    [projectId],
  )
  if (!rows.length) return null
  try {
    return {
      sessionId: rows[0].session_id,
      items: JSON.parse(rows[0].items) as ChatItem[],
    }
  } catch {
    return null
  }
}

export async function saveConversation(
  projectId: string,
  sessionId: string | null,
  items: ChatItem[],
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await db.execute(
    "INSERT INTO conversations (project_id, session_id, items, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT(project_id) DO UPDATE SET session_id = excluded.session_id, items = excluded.items, updated_at = excluded.updated_at",
    [projectId, sessionId, JSON.stringify(items), Date.now()],
  )
}
