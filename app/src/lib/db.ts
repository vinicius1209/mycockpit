import Database from "@tauri-apps/plugin-sql"
import type { Project } from "@/lib/types"
import type { ChatItem } from "@/store/chat"
import type { ConvRef } from "@/lib/attachments"
import type { FusionRun } from "@/store/fusion"
import type { DeliveryRecord } from "@/lib/recall"

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
  color: string | null
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
    color: r.color ?? null,
    status: "idle",
  }
}

export async function listProjects(): Promise<Project[] | null> {
  const db = await getDb()
  if (!db) return null
  const rows = await db.select<ProjectRow[]>(
    "SELECT id, name, path, created_at, has_claude_md, has_agents_md, permission_mode, color FROM projects WHERE deleted_at IS NULL ORDER BY created_at DESC",
  )
  return rows.map(toProject)
}

/** Renomeia um projeto (UPDATE pontual). */
export async function renameProject(id: string, name: string): Promise<void> {
  const db = await getDb()
  if (!db) return
  await db.execute("UPDATE projects SET name = $1 WHERE id = $2", [name, id])
}

/** Define (ou limpa, com null) a cor-rótulo de um projeto. */
export async function setProjectColor(
  id: string,
  color: string | null,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await db.execute("UPDATE projects SET color = $1 WHERE id = $2", [color, id])
}

/** Insere o projeto. `false` = path já cadastrado (o OR IGNORE não inseriu);
 *  o caller decide restaurar/selecionar o existente em vez de criar fantasma. */
export async function insertProject(p: Project): Promise<boolean> {
  const db = await getDb()
  if (!db) return false
  const res = await db.execute(
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
  return (res?.rowsAffected ?? 0) > 0
}

/** Procura um projeto pelo path, INCLUINDO arquivados (pro re-add restaurar). */
export async function findProjectByPath(
  path: string,
): Promise<{ id: string; deleted: boolean } | null> {
  const db = await getDb()
  if (!db) return null
  const rows = await db.select<{ id: string; deleted_at: number | null }[]>(
    "SELECT id, deleted_at FROM projects WHERE path = $1",
    [path],
  )
  if (!rows.length) return null
  return { id: rows[0].id, deleted: rows[0].deleted_at != null }
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

/** Soft delete: arquiva o projeto (`deleted_at`). Conversas PRESERVADAS (métricas/
 *  restauração). NÃO apaga nada no disco. */
export async function archiveProject(id: string): Promise<void> {
  const db = await getDb()
  if (!db) return
  await db.execute("UPDATE projects SET deleted_at = $1 WHERE id = $2", [
    Date.now(),
    id,
  ])
}

/** Restaura um projeto arquivado (limpa `deleted_at`). */
export async function restoreProject(id: string): Promise<void> {
  const db = await getDb()
  if (!db) return
  await db.execute("UPDATE projects SET deleted_at = NULL WHERE id = $1", [id])
}

export interface ConversationMeta {
  id: string
  title: string | null
  updatedAt: number
  color: string | null
  worktreePath: string | null
  /** Agent persistido da conversa (null = nunca rodou/persistiu — livre).
   *  Permite ao office achar "a conversa da mesa" sem carregar cada linha. */
  agent: string | null
}

interface ConvListRow {
  id: string
  title: string | null
  updated_at: number
  color: string | null
  worktree_path: string | null
  agent: string | null
}

/** Lista as conversas de um projeto em ordem de criação (estável; novas embaixo). */
export async function listConversations(
  projectId: string,
): Promise<ConversationMeta[] | null> {
  const db = await getDb()
  if (!db) return null
  const rows = await db.select<ConvListRow[]>(
    "SELECT id, title, updated_at, color, worktree_path, agent FROM conversations WHERE project_id = $1 ORDER BY created_at ASC",
    [projectId],
  )
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updated_at,
    color: r.color ?? null,
    worktreePath: r.worktree_path ?? null,
    agent: r.agent ?? null,
  }))
}

export interface ConvSearchHit {
  id: string
  projectId: string
  projectName: string
  title: string | null
}

/** Busca full-text simples (LIKE) em título + conteúdo das conversas, cross-
 *  projeto (ignora projetos arquivados). Barato o bastante pro ⌘K debounced. */
export async function searchConversations(q: string): Promise<ConvSearchHit[]> {
  const db = await getDb()
  if (!db) return []
  // escapa curingas do LIKE (busca literal, não padrão)
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`
  const rows = await db.select<
    { id: string; project_id: string; project_name: string; title: string | null }[]
  >(
    `SELECT c.id, c.project_id, p.name AS project_name, c.title
       FROM conversations c
       JOIN projects p ON p.id = c.project_id
      WHERE p.deleted_at IS NULL
        AND (c.title LIKE $1 ESCAPE '\\' OR c.items LIKE $1 ESCAPE '\\')
      ORDER BY c.updated_at DESC
      LIMIT 12`,
    [like],
  )
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name,
    title: r.title,
  }))
}

/** Renomeia uma conversa (UPDATE pontual; não toca em items/sessão). */
export async function renameConversation(
  id: string,
  title: string,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await db.execute("UPDATE conversations SET title = $1 WHERE id = $2", [
    title,
    id,
  ])
}

/** Define (ou limpa, com null) a cor-rótulo de uma conversa. */
export async function setConversationColor(
  id: string,
  color: string | null,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await db.execute("UPDATE conversations SET color = $1 WHERE id = $2", [
    color,
    id,
  ])
}

/** Define/limpa o worktree isolado de uma conversa (NULL = compartilha o projeto). */
export async function setConversationWorktree(
  id: string,
  path: string | null,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await db.execute("UPDATE conversations SET worktree_path = $1 WHERE id = $2", [
    path,
    id,
  ])
}

interface ConvLoadRow {
  session_id: string | null
  items: string
  title: string | null
  suggestions: string | null
  agent: string | null
  req_model: string | null
  effort: string | null
  /** Modelo RESOLVIDO da última sessão (o que o CLI reportou no init). */
  model: string | null
  worktree_path: string | null
}

/** `null` = conversa não existe; `"corrupt"` = a linha EXISTE mas o JSON não
 *  parseou. O caller NÃO pode tratar corrupt como vazio: o persist (UPSERT de
 *  linha inteira) destruiria dados ainda recuperáveis via SQLite. */
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
  model: string | null
  worktreePath: string | null
} | null | "corrupt"> {
  const db = await getDb()
  if (!db) return null
  const rows = await db.select<ConvLoadRow[]>(
    "SELECT session_id, items, title, suggestions, agent, req_model, effort, model, worktree_path FROM conversations WHERE id = $1",
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
      model: rows[0].model,
      worktreePath: rows[0].worktree_path,
    }
  } catch {
    return "corrupt"
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
  model: string | null,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await db.execute(
    "INSERT INTO conversations (id, project_id, title, session_id, items, suggestions, agent, req_model, effort, model, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) ON CONFLICT(id) DO UPDATE SET title = excluded.title, session_id = excluded.session_id, items = excluded.items, suggestions = excluded.suggestions, agent = excluded.agent, req_model = excluded.req_model, effort = excluded.effort, model = excluded.model, updated_at = excluded.updated_at",
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
      model,
      Date.now(),
    ],
  )
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDb()
  if (!db) return
  // E1 (S1.2): o card NUNCA morre junto da conversa — ele é a intenção, e a
  // intenção sobrevive à execução. Card ligado não-terminal volta pro backlog;
  // o link some em TODOS (a conversa não existe mais, manter o id seria
  // fingir). done/cancelled preservam o estado (histórico fechado fica fechado).
  // A limpeza roda ANTES do DELETE (D1): sem transação no plugin, falha aqui
  // deixa tudo intacto e o retry fica limpo — na ordem inversa, DELETE feito +
  // UPDATE falho abortava o removeConversation antes de limpar o store, e o
  // persist (UPSERT de linha inteira) ressuscitava a conversa-zumbi.
  await ensureBoardTables(db)
  const now = Date.now()
  await db.execute(
    "UPDATE cards SET state = 'backlog', updated_at = $1 WHERE conversation_id = $2 AND state NOT IN ('done', 'cancelled')",
    [now, id],
  )
  await db.execute(
    "UPDATE cards SET conversation_id = NULL, updated_at = $1 WHERE conversation_id = $2",
    [now, id],
  )
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

/** A disputa PENDENTE (esperando decisão) de uma conversa, se houver, caso 2. */
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

// ---------------- Custo por entrega (stage_runs) ----------------

export interface StageRunRow {
  skill: string
  agent: string
  model: string | null
  ok: boolean
  costUsd: number | null
  costSource: string | null
  createdAt: number
}

/** Grava uma etapa SDD dirigida pelo cockpit (a matéria-prima do US$/feature). */
export async function insertStageRun(r: {
  projectId: string
  slug: string
  skill: string
  agent: string
  model: string | null
  ok: boolean
  costUsd: number | null
  costSource: string | null
  durationMs: number | null
}): Promise<void> {
  const db = await getDb()
  if (!db) return
  await db.execute(
    "INSERT INTO stage_runs (id, project_id, slug, skill, agent, model, ok, cost_usd, cost_source, duration_ms, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    [
      crypto.randomUUID(),
      r.projectId,
      r.slug,
      r.skill,
      r.agent,
      r.model,
      r.ok ? 1 : 0,
      r.costUsd,
      r.costSource,
      r.durationMs,
      Date.now(),
    ],
  )
}

/** Custo agregado por feature (slug) de um projeto: total + nº de runs + se
 *  algum custo é estimado (o "~" honesto na soma). */
export async function listStageCosts(
  projectId: string,
): Promise<Record<string, { total: number; runs: number; estimated: boolean }>> {
  const db = await getDb()
  if (!db) return {}
  try {
    const rows = await db.select<
      { slug: string; total: number | null; runs: number; est: number }[]
    >(
      "SELECT slug, SUM(cost_usd) AS total, COUNT(*) AS runs, MAX(CASE WHEN cost_source != 'reported' THEN 1 ELSE 0 END) AS est FROM stage_runs WHERE project_id = $1 GROUP BY slug",
      [projectId],
    )
    const out: Record<string, { total: number; runs: number; estimated: boolean }> =
      {}
    for (const r of rows) {
      out[r.slug] = { total: r.total ?? 0, runs: r.runs, estimated: r.est === 1 }
    }
    return out
  } catch {
    return {}
  }
}

/** Runs de uma feature (breakdown por etapa no detalhe do plano). */
export async function listStageRuns(
  projectId: string,
  slug: string,
): Promise<StageRunRow[]> {
  const db = await getDb()
  if (!db) return []
  try {
    const rows = await db.select<
      {
        skill: string
        agent: string
        model: string | null
        ok: number
        cost_usd: number | null
        cost_source: string | null
        created_at: number
      }[]
    >(
      "SELECT skill, agent, model, ok, cost_usd, cost_source, created_at FROM stage_runs WHERE project_id = $1 AND slug = $2 ORDER BY created_at ASC",
      [projectId, slug],
    )
    return rows.map((r) => ({
      skill: r.skill,
      agent: r.agent,
      model: r.model,
      ok: r.ok === 1,
      costUsd: r.cost_usd,
      costSource: r.cost_source,
      createdAt: r.created_at,
    }))
  } catch {
    return []
  }
}

/** Disputas pendentes de decisão em TODAS as conversas (pro inbox de decisões),
 *  com o projeto e o título da conversa via join. */
export async function listPendingDecisions(): Promise<
  { convId: string; projectId: string; title: string | null; createdAt: number }[]
> {
  const db = await getDb()
  if (!db) return []
  try {
    const rows = await db.select<
      {
        conv_id: string
        project_id: string
        title: string | null
        created_at: number
      }[]
    >(
      "SELECT f.conv_id, c.project_id, c.title, f.created_at FROM fusion_runs f JOIN conversations c ON c.id = f.conv_id WHERE f.pending = 1 ORDER BY f.created_at DESC",
    )
    return rows.map((r) => ({
      convId: r.conv_id,
      projectId: r.project_id,
      title: r.title,
      createdAt: r.created_at,
    }))
  } catch {
    return []
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

// ---------------- Auto-aprendizado: deliveries + lessons (M1/M2) ----------------
// Tabelas criadas do FRONTEND via CREATE TABLE IF NOT EXISTS (idempotente, sem
// migration no lib.rs — decisão do M1/M2). `ensureLearningTables` roda uma vez
// por processo (guarda de promessa) antes de qualquer leitura/escrita.

let learningReady: Promise<void> | null = null

/** project_id sentinela das lições GLOBAIS (valem em todo projeto). Uma lição
 *  scope='global' é gravada com este project_id e o listLessons a traz em
 *  qualquer projeto (WHERE scope='global' OR project_id=$1). */
export const GLOBAL_PROJECT_ID = "__global__"

export type LessonScope = "global" | "project"

/** Estágio 1 do funil de aprendizado (docs/autonomy.md): `active` injeta no
 *  prompt; `candidate` fica só na auditoria (derivada do loop do Mission, ainda
 *  não promovida); `archived` foi retirada mas é reversível. */
export type LessonStatus = "active" | "candidate" | "archived"

/** ALTER idempotente: engole SÓ "duplicate column" (coluna já existe, re-run).
 *  Qualquer OUTRO erro (ex.: 'database is locked' transitório) PROPAGA — senão
 *  o schema fica sem a coluna e o cache fixaria o estado envenenado. */
async function addColumn(db: Database, sql: string): Promise<void> {
  try {
    await db.execute(sql)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/duplicate column/i.test(msg)) throw e
  }
}

async function ensureLearningTables(db: Database): Promise<void> {
  if (!learningReady) {
    const run = (async () => {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS deliveries (
           id TEXT PRIMARY KEY,
           project_id TEXT NOT NULL,
           task TEXT NOT NULL,
           plan_summary TEXT,
           files_touched TEXT,
           cost_usd REAL,
           agent TEXT,
           model TEXT,
           created_at INTEGER NOT NULL
         )`,
      )
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_deliveries_project ON deliveries(project_id)`,
      )
      await db.execute(
        `CREATE TABLE IF NOT EXISTS lessons (
           id TEXT PRIMARY KEY,
           project_id TEXT NOT NULL,
           rule TEXT NOT NULL,
           source TEXT,
           created_at INTEGER NOT NULL,
           uses INTEGER NOT NULL DEFAULT 0
         )`,
      )
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_lessons_project ON lessons(project_id)`,
      )
      // M2 do Linear: coluna `scope` (global × projeto). A tabela `lessons` já
      // existe em bancos antigos → ALTER idempotente (só "duplicate column" é
      // absorvido; erro real propaga e o cache reseta pra retentar).
      await addColumn(
        db,
        `ALTER TABLE lessons ADD COLUMN scope TEXT NOT NULL DEFAULT 'project'`,
      )
      // Estágio 1 do funil (CURADOR): status + sinais de reforço.
      await addColumn(
        db,
        `ALTER TABLE lessons ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
      )
      await addColumn(db, `ALTER TABLE lessons ADD COLUMN last_used_at INTEGER`)
      await addColumn(
        db,
        `ALTER TABLE lessons ADD COLUMN reinforced INTEGER NOT NULL DEFAULT 0`,
      )
    })()
    // o cache só fica FIXO em sucesso: em falha, reseta pra próxima chamada
    // RETENTAR (um erro transitório não pode envenenar o processo inteiro).
    learningReady = run.catch((e) => {
      learningReady = null
      throw e
    })
  }
  return learningReady
}

interface DeliveryRow {
  id: string
  task: string
  plan_summary: string | null
  files_touched: string | null
  cost_usd: number | null
  agent: string | null
  model: string | null
  created_at: number
}

function toDelivery(r: DeliveryRow): DeliveryRecord {
  let files: string[] = []
  try {
    const p = r.files_touched ? JSON.parse(r.files_touched) : []
    if (Array.isArray(p)) files = p.filter((x): x is string => typeof x === "string")
  } catch {
    files = []
  }
  return {
    id: r.id,
    task: r.task,
    planSummary: r.plan_summary ?? "",
    filesTouched: files,
    costUsd: r.cost_usd,
    agent: r.agent ?? "",
    model: r.model,
    createdAt: r.created_at,
  }
}

/** Grava UMA entrega que passou nos gates (Mission terminou "done"). É a
 *  matéria-prima do recall (M1) — pares tarefa→resolução reusáveis. */
export async function insertDelivery(d: {
  projectId: string
  task: string
  planSummary: string
  filesTouched: string[]
  costUsd: number | null
  agent: string
  model: string | null
}): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureLearningTables(db)
  await db.execute(
    "INSERT INTO deliveries (id, project_id, task, plan_summary, files_touched, cost_usd, agent, model, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      crypto.randomUUID(),
      d.projectId,
      d.task,
      d.planSummary,
      JSON.stringify(d.filesTouched),
      d.costUsd,
      d.agent,
      d.model,
      Date.now(),
    ],
  )
}

/** Entregas passadas de um projeto (mais recentes primeiro), p/ o recall. */
export async function listDeliveries(
  projectId: string,
  limit = 200,
): Promise<DeliveryRecord[]> {
  const db = await getDb()
  if (!db) return []
  try {
    await ensureLearningTables(db)
    const rows = await db.select<DeliveryRow[]>(
      "SELECT id, task, plan_summary, files_touched, cost_usd, agent, model, created_at FROM deliveries WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2",
      [projectId, limit],
    )
    return rows.map(toDelivery)
  } catch {
    return []
  }
}

/** Entrega com o projeto dono — o Painel (F4) lista cross-projeto. */
export interface RecentDelivery extends DeliveryRecord {
  projectId: string
}

/** Entregas mais recentes de TODOS os projetos (Painel, bloco "Entregas
 *  recentes"): mais nova primeiro, limitado. */
export async function listRecentDeliveries(
  limit = 8,
): Promise<RecentDelivery[]> {
  const db = await getDb()
  if (!db) return []
  try {
    await ensureLearningTables(db)
    const rows = await db.select<(DeliveryRow & { project_id: string })[]>(
      "SELECT id, project_id, task, plan_summary, files_touched, cost_usd, agent, model, created_at FROM deliveries ORDER BY created_at DESC LIMIT $1",
      [limit],
    )
    return rows.map((r) => ({ ...toDelivery(r), projectId: r.project_id }))
  } catch {
    return []
  }
}

// ---------------- Ledger de custo por turno (turn_costs) ----------------

/** Uma linha do ledger de custo — turno de chat OU entrega de missão,
 *  normalizados p/ as janelas hoje/7d/30d, o ranking por agente e o sparkline. */
export interface LedgerEntry {
  agent: string
  projectId: string
  costUsd: number | null
  tokens: number
  createdAt: number
}

/** Grava o custo de UM turno de chat linear. `INSERT OR REPLACE` por run_id:
 *  results parciais do mesmo run colapsam no total final (o último vence).
 *  Best-effort — perder uma linha de custo não pode derrubar o turno. */
export async function recordTurnCost(r: {
  runId: string
  projectId: string
  convId: string
  agent: string
  model: string | null
  costUsd: number | null
  costSource: string | null
  input: number
  output: number
  cache: number
}): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    await db.execute(
      "INSERT OR REPLACE INTO turn_costs (run_id, project_id, conv_id, agent, model, cost_usd, cost_source, input_tokens, output_tokens, cache_tokens, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
      [
        r.runId,
        r.projectId,
        r.convId,
        r.agent,
        r.model,
        r.costUsd,
        r.costSource,
        r.input,
        r.output,
        r.cache,
        Date.now(),
      ],
    )
  } catch {
    // best-effort
  }
}

/** Ledger unificado desde `sinceMs`: turnos de chat + candidatos de disputa
 *  (turn_costs) + entregas de missão (deliveries) + etapas SDD (stage_runs).
 *  São caminhos DISJUNTOS de execução, então a união NÃO conta em dobro:
 *  chat/disputa gravam turn_costs, missão grava deliveries, SDD grava
 *  stage_runs. (deliveries e stage_runs não guardam tokens → 0.) */
export async function loadLedger(sinceMs: number): Promise<LedgerEntry[]> {
  const db = await getDb()
  if (!db) return []
  try {
    const rows = await db.select<
      {
        agent: string
        project_id: string
        cost_usd: number | null
        tokens: number
        created_at: number
      }[]
    >(
      "SELECT agent, project_id, cost_usd, (input_tokens + output_tokens) AS tokens, created_at FROM turn_costs WHERE created_at >= $1 " +
        "UNION ALL " +
        "SELECT agent, project_id, cost_usd, 0 AS tokens, created_at FROM deliveries WHERE created_at >= $1 " +
        "UNION ALL " +
        "SELECT agent, project_id, cost_usd, 0 AS tokens, created_at FROM stage_runs WHERE created_at >= $1",
      [sinceMs],
    )
    return rows.map((r) => ({
      agent: r.agent,
      projectId: r.project_id,
      costUsd: r.cost_usd,
      tokens: r.tokens ?? 0,
      createdAt: r.created_at,
    }))
  } catch {
    return []
  }
}

export interface LessonRecord {
  id: string
  rule: string
  source: string | null
  createdAt: number
  uses: number
  scope: LessonScope
  /** Estágio 1: só `active` é injetado; `candidate`/`archived` ficam na
   *  auditoria (reversível via promover/rebaixar). */
  status: LessonStatus
  /** Último ms em que a lição foi injetada (markLessonsUsed). */
  lastUsedAt: number | null
  /** Quantas vezes o 👍 reforçou a lição (sinal de utilidade real). */
  reinforced: number
  /** project_id da linha (GLOBAL_PROJECT_ID p/ lições globais) — pro badge. */
  projectId: string
}

interface LessonRow {
  id: string
  project_id: string
  rule: string
  source: string | null
  created_at: number
  uses: number
  scope: string | null
  status: string | null
  last_used_at: number | null
  reinforced: number | null
}

function toStatus(s: string | null): LessonStatus {
  return s === "candidate" || s === "archived" ? s : "active"
}

function toLesson(r: LessonRow): LessonRecord {
  return {
    id: r.id,
    rule: r.rule,
    source: r.source,
    createdAt: r.created_at,
    uses: r.uses,
    scope: r.scope === "global" ? "global" : "project",
    status: toStatus(r.status),
    lastUsedAt: r.last_used_at ?? null,
    reinforced: r.reinforced ?? 0,
    projectId: r.project_id,
  }
}

/** Grava UMA lição destilada (M2). O dedup por similaridade é responsabilidade
 *  do chamador (lib/learning) — aqui é só o INSERT. `scope='global'` usa o
 *  project_id sentinela (GLOBAL_PROJECT_ID); o chamador NÃO precisa saber disso. */
export async function insertLesson(l: {
  projectId: string
  rule: string
  source: string
  scope?: LessonScope
  /** Estágio 1: default `active` (save explícito injeta já). O loop do Mission
   *  grava `candidate` — não injeta até promover. */
  status?: LessonStatus
}): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureLearningTables(db)
  const scope: LessonScope = l.scope ?? "project"
  const status: LessonStatus = l.status ?? "active"
  const projectId = scope === "global" ? GLOBAL_PROJECT_ID : l.projectId
  await db.execute(
    "INSERT INTO lessons (id, project_id, rule, source, created_at, uses, scope, status, reinforced) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, 0)",
    [crypto.randomUUID(), projectId, l.rule, l.source, Date.now(), scope, status],
  )
}

/** Lições que valem num projeto: as PRÓPRIAS dele + as GLOBAIS (valem em todo
 *  projeto). Ordena por mais USADAS e mais RECENTES (as que valem injetar
 *  primeiro). O cap é aplicado pelo chamador na injeção. */
const LESSON_COLS =
  "id, project_id, rule, source, created_at, uses, scope, status, last_used_at, reinforced"

export async function listLessons(projectId: string): Promise<LessonRecord[]> {
  const db = await getDb()
  if (!db) return []
  try {
    await ensureLearningTables(db)
    const rows = await db.select<LessonRow[]>(
      `SELECT ${LESSON_COLS} FROM lessons WHERE scope = 'global' OR project_id = $1 ORDER BY uses DESC, created_at DESC`,
      [projectId],
    )
    return rows.map(toLesson)
  } catch {
    return []
  }
}

/** Lições ATIVAS de um projeto (próprias + globais) — as ÚNICAS que a injeção
 *  considera (estágio 1: candidate/archived não injetam). */
export async function listActiveLessons(
  projectId: string,
): Promise<LessonRecord[]> {
  const db = await getDb()
  if (!db) return []
  try {
    await ensureLearningTables(db)
    const rows = await db.select<LessonRow[]>(
      `SELECT ${LESSON_COLS} FROM lessons WHERE status = 'active' AND (scope = 'global' OR project_id = $1) ORDER BY uses DESC, created_at DESC`,
      [projectId],
    )
    return rows.map(toLesson)
  } catch {
    return []
  }
}

/** Muda o status de uma lição (promover candidate→active, rebaixar
 *  active→candidate, arquivar). Reversível — NÃO exclui. Best-effort. */
export async function setLessonStatus(
  id: string,
  status: LessonStatus,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    await db.execute("UPDATE lessons SET status = $1 WHERE id = $2", [status, id])
  } catch {
    // best-effort: falha não vale quebrar a auditoria.
  }
}

/** Funde os usos de uma lição duplicada na canônica (curador/dedup): soma o
 *  `uses` da `fromId` no `intoId`. Best-effort. */
export async function mergeLessonUses(
  intoId: string,
  fromUses: number,
): Promise<void> {
  if (fromUses <= 0) return
  const db = await getDb()
  if (!db) return
  try {
    await db.execute("UPDATE lessons SET uses = uses + $1 WHERE id = $2", [
      fromUses,
      intoId,
    ])
  } catch {
    // best-effort.
  }
}

/** Poda uma lição (UI de auditoria — princípio "nunca promover sem revisão"). */
export async function deleteLesson(id: string): Promise<void> {
  const db = await getDb()
  if (!db) return
  await db.execute("DELETE FROM lessons WHERE id = $1", [id])
}

/** Incrementa o contador de usos das lições injetadas (feedback de relevância:
 *  o ranking sobe as que reaparecem). */
export async function bumpLessonUses(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const db = await getDb()
  if (!db) return
  // $1 = agora (last_used_at); os ids vêm a partir de $2.
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ")
  await db.execute(
    `UPDATE lessons SET uses = uses + 1, last_used_at = $1 WHERE id IN (${placeholders})`,
    [Date.now(), ...ids],
  )
}

/** Reforça as lições injetadas quando o 👍 valida o turno (sinal de utilidade
 *  REAL — o curador rebaixa as muito injetadas mas nunca reforçadas). */
export async function reinforceLessons(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const db = await getDb()
  if (!db) return
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ")
  try {
    await db.execute(
      `UPDATE lessons SET reinforced = reinforced + 1 WHERE id IN (${placeholders})`,
      ids,
    )
  } catch {
    // best-effort: reforço é sinal secundário.
  }
}

// ---------------- Curador de modelos: model_proposals ----------------
// Propostas do curador LLM (Camada C): modelos novos do catálogo (models.dev)
// que AINDA não estão nos pickers. `proposed` espera revisão humana em
// Configurações ▸ Agents; `active` entra no picker (merge em agentModels);
// `dismissed` fica como memória de "já ofereci" (o curador não re-propõe).
// Mesmo padrão idempotente das tabelas de aprendizado (CREATE IF NOT EXISTS,
// cache de promessa que RESETA em falha).

export type ModelProposalStatus = "proposed" | "active" | "dismissed"

export interface ModelProposal {
  id: string
  /** Agent dono do picker ("claude-code" | "codex"). */
  agent: string
  /** O que vai em `--model` (alias anthropic ou id openai). */
  value: string
  label: string
  description: string
  status: ModelProposalStatus
  createdAt: number
}

let proposalsReady: Promise<void> | null = null

async function ensureProposalTable(db: Database): Promise<void> {
  if (!proposalsReady) {
    const run = (async () => {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS model_proposals (
           id TEXT PRIMARY KEY,
           agent TEXT NOT NULL,
           value TEXT NOT NULL,
           label TEXT NOT NULL,
           description TEXT NOT NULL,
           status TEXT NOT NULL DEFAULT 'proposed',
           created_at INTEGER NOT NULL
         )`,
      )
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_model_proposals_status ON model_proposals(status)`,
      )
    })()
    // cache fixa SÓ em sucesso (falha transitória não envenena o processo).
    proposalsReady = run.catch((e) => {
      proposalsReady = null
      throw e
    })
  }
  return proposalsReady
}

interface ModelProposalRow {
  id: string
  agent: string
  value: string
  label: string
  description: string
  status: string
  created_at: number
}

function toProposalStatus(s: string): ModelProposalStatus {
  return s === "active" || s === "dismissed" ? s : "proposed"
}

/** Propostas do curador (todas, ou só de um status). [] em falha/não-Tauri. */
export async function listModelProposals(
  status?: ModelProposalStatus,
): Promise<ModelProposal[]> {
  const db = await getDb()
  if (!db) return []
  try {
    await ensureProposalTable(db)
    const rows = status
      ? await db.select<ModelProposalRow[]>(
          "SELECT id, agent, value, label, description, status, created_at FROM model_proposals WHERE status = $1 ORDER BY created_at ASC",
          [status],
        )
      : await db.select<ModelProposalRow[]>(
          "SELECT id, agent, value, label, description, status, created_at FROM model_proposals ORDER BY created_at ASC",
        )
    return rows.map((r) => ({
      id: r.id,
      agent: r.agent,
      value: r.value,
      label: r.label,
      description: r.description,
      status: toProposalStatus(r.status),
      createdAt: r.created_at,
    }))
  } catch {
    return []
  }
}

/** Grava as propostas de UMA rodada do curador (status='proposed'). */
export async function insertModelProposals(
  rows: { agent: string; value: string; label: string; description: string }[],
): Promise<void> {
  if (rows.length === 0) return
  const db = await getDb()
  if (!db) return
  await ensureProposalTable(db)
  const now = Date.now()
  for (const r of rows) {
    await db.execute(
      "INSERT INTO model_proposals (id, agent, value, label, description, status, created_at) VALUES ($1, $2, $3, $4, $5, 'proposed', $6)",
      [crypto.randomUUID(), r.agent, r.value, r.label, r.description, now],
    )
  }
}

/** Decisão do gate humano: Aprovar → 'active' · Dispensar → 'dismissed'. */
export async function setModelProposalStatus(
  id: string,
  status: ModelProposalStatus,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    await ensureProposalTable(db)
    await db.execute("UPDATE model_proposals SET status = $1 WHERE id = $2", [
      status,
      id,
    ])
  } catch {
    // best-effort: a UI recarrega do banco na próxima abertura.
  }
}

// ---------------- F6: automações agendadas (schedules + schedule_runs) ----------------
// Mesmo padrão idempotente das tabelas de aprendizado: CREATE TABLE IF NOT
// EXISTS do frontend, cache de promessa que RESETA em falha (erro transitório
// não envenena o processo). A recorrência é um JSON string discriminado
// (lib/schedules.Recurrence); o DB não interpreta.

/** Permissão de uma automação. 'liberado' NUNCA existe aqui — nem no tipo. */
export type SchedulePermission = "leitura" | "padrao"

export interface ScheduleRecord {
  id: string
  name: string
  projectId: string
  agent: string
  /** Valor cru do picker ("default" = deixa o CLI escolher). */
  model: string | null
  prompt: string
  permission: SchedulePermission
  /** JSON discriminado (lib/schedules.parseRecurrence valida na leitura). */
  recurrence: string
  enabled: boolean
  nextRun: number | null
  lastRunAt: number | null
  lastRunStatus: string | null
  createdAt: number
}

export interface ScheduleRunRecord {
  id: string
  scheduleId: string
  startedAt: number
  /** "ok" | "failed" (v1 não tem retry automático — falha fica falha). */
  status: string
  cost: number | null
  convId: string | null
}

let schedulesReady: Promise<void> | null = null

async function ensureScheduleTables(db: Database): Promise<void> {
  if (!schedulesReady) {
    const run = (async () => {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS schedules (
           id TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           project_id TEXT NOT NULL,
           agent TEXT NOT NULL,
           model TEXT,
           prompt TEXT NOT NULL,
           permission TEXT NOT NULL DEFAULT 'leitura',
           recurrence TEXT NOT NULL,
           enabled INTEGER NOT NULL DEFAULT 1,
           next_run INTEGER,
           last_run_at INTEGER,
           last_run_status TEXT,
           created_at INTEGER NOT NULL
         )`,
      )
      await db.execute(
        `CREATE TABLE IF NOT EXISTS schedule_runs (
           id TEXT PRIMARY KEY,
           schedule_id TEXT NOT NULL,
           started_at INTEGER NOT NULL,
           status TEXT NOT NULL,
           cost REAL,
           conv_id TEXT
         )`,
      )
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule ON schedule_runs(schedule_id)`,
      )
    })()
    schedulesReady = run.catch((e) => {
      schedulesReady = null
      throw e
    })
  }
  return schedulesReady
}

interface ScheduleRow {
  id: string
  name: string
  project_id: string
  agent: string
  model: string | null
  prompt: string
  permission: string
  recurrence: string
  enabled: number
  next_run: number | null
  last_run_at: number | null
  last_run_status: string | null
  created_at: number
}

function toSchedule(r: ScheduleRow): ScheduleRecord {
  return {
    id: r.id,
    name: r.name,
    projectId: r.project_id,
    agent: r.agent,
    model: r.model,
    prompt: r.prompt,
    // clamp de leitura: qualquer valor estranho (inclusive um 'liberado'
    // gravado à mão no SQLite) degrada pra 'leitura' — a regra dura do F6.
    permission: r.permission === "padrao" ? "padrao" : "leitura",
    recurrence: r.recurrence,
    enabled: r.enabled === 1,
    nextRun: r.next_run,
    lastRunAt: r.last_run_at,
    lastRunStatus: r.last_run_status,
    createdAt: r.created_at,
  }
}

const SCHEDULE_COLS =
  "id, name, project_id, agent, model, prompt, permission, recurrence, enabled, next_run, last_run_at, last_run_status, created_at"

/** Todas as automações (habilitadas ou não). null = fora do Tauri; [] = falha. */
export async function listSchedules(): Promise<ScheduleRecord[] | null> {
  const db = await getDb()
  if (!db) return null
  try {
    await ensureScheduleTables(db)
    const rows = await db.select<ScheduleRow[]>(
      `SELECT ${SCHEDULE_COLS} FROM schedules ORDER BY created_at ASC`,
    )
    return rows.map(toSchedule)
  } catch {
    return []
  }
}

export async function insertSchedule(s: ScheduleRecord): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureScheduleTables(db)
  await db.execute(
    "INSERT INTO schedules (id, name, project_id, agent, model, prompt, permission, recurrence, enabled, next_run, last_run_at, last_run_status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
    [
      s.id,
      s.name,
      s.projectId,
      s.agent,
      s.model,
      s.prompt,
      s.permission,
      s.recurrence,
      s.enabled ? 1 : 0,
      s.nextRun,
      s.lastRunAt,
      s.lastRunStatus,
      s.createdAt,
    ],
  )
}

/** Liga/pausa uma automação. Ao ligar, o caller recalcula e passa o next_run. */
export async function setScheduleEnabled(
  id: string,
  enabled: boolean,
  nextRun: number | null,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    await ensureScheduleTables(db)
    await db.execute(
      "UPDATE schedules SET enabled = $1, next_run = $2 WHERE id = $3",
      [enabled ? 1 : 0, nextRun, id],
    )
  } catch {
    // best-effort: a UI recarrega do banco.
  }
}

export async function setScheduleNextRun(
  id: string,
  nextRun: number | null,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    await ensureScheduleTables(db)
    await db.execute("UPDATE schedules SET next_run = $1 WHERE id = $2", [
      nextRun,
      id,
    ])
  } catch {
    // best-effort.
  }
}

/** Marca o desfecho da última execução (o next_run já foi avançado no disparo). */
export async function markScheduleRun(
  id: string,
  lastRunAt: number,
  lastRunStatus: string,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    await ensureScheduleTables(db)
    await db.execute(
      "UPDATE schedules SET last_run_at = $1, last_run_status = $2 WHERE id = $3",
      [lastRunAt, lastRunStatus, id],
    )
  } catch {
    // best-effort.
  }
}

/** Exclui a automação E o histórico dela (hard delete, com confirm na UI). */
export async function deleteSchedule(id: string): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureScheduleTables(db)
  await db.execute("DELETE FROM schedule_runs WHERE schedule_id = $1", [id])
  await db.execute("DELETE FROM schedules WHERE id = $1", [id])
}

export async function insertScheduleRun(r: ScheduleRunRecord): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    await ensureScheduleTables(db)
    await db.execute(
      "INSERT INTO schedule_runs (id, schedule_id, started_at, status, cost, conv_id) VALUES ($1, $2, $3, $4, $5, $6)",
      [r.id, r.scheduleId, r.startedAt, r.status, r.cost, r.convId],
    )
  } catch {
    // best-effort: perder uma linha de histórico não pode derrubar o motor.
  }
}

/** Histórico recente de TODAS as automações (a view agrupa por schedule_id —
 *  alimenta o custo médio das últimas 5 e o histórico expandível). */
export async function listScheduleRuns(
  limit = 300,
): Promise<ScheduleRunRecord[]> {
  const db = await getDb()
  if (!db) return []
  try {
    await ensureScheduleTables(db)
    const rows = await db.select<
      {
        id: string
        schedule_id: string
        started_at: number
        status: string
        cost: number | null
        conv_id: string | null
      }[]
    >(
      "SELECT id, schedule_id, started_at, status, cost, conv_id FROM schedule_runs ORDER BY started_at DESC LIMIT $1",
      [limit],
    )
    return rows.map((r) => ({
      id: r.id,
      scheduleId: r.schedule_id,
      startedAt: r.started_at,
      status: r.status,
      cost: r.cost,
      convId: r.conv_id,
    }))
  } catch {
    return []
  }
}

// ---------------- E1: Board de intenção (cards) ----------------
// O CARD é a unidade durável de intenção, ligada à conversa que a executa.
// Mesmo padrão idempotente das tabelas de aprendizado: CREATE TABLE IF NOT
// EXISTS do frontend (`ensureBoardTables`), cache de promessa que RESETA em
// falha. SEM migração no lib.rs (board não é tabela núcleo; v25/v26 ficam
// reservadas pros presets do Sprint 3).

export type CardState =
  | "backlog"
  | "working"
  | "review"
  | "blocked"
  | "done"
  | "cancelled"

/** Máquina de estados EXPLÍCITA do card: backlog → working → review|blocked →
 *  done|cancelled. Regressões honestas (review→working = retrabalho,
 *  blocked→working = desbloqueou, working→backlog = recuar) são permitidas;
 *  `cancelled` é alcançável de qualquer estado não-terminal (abandonar uma
 *  intenção é sempre direito do humano). done/cancelled são TERMINAIS e só
 *  entram via `closeCard` (gate humano-only — `setCardState` recusa).
 *  EXCEÇÃO DE SISTEMA (documentada, não escondida): a limpeza do
 *  `deleteConversation` devolve card ligado não-terminal pro backlog via SQL
 *  direto — um bypass working|review|blocked→backlog fora da máquina, porque
 *  ali não há gesto de board: a conversa sumiu e o card volta pra fila. */
export const CARD_STATE_MACHINE: Record<CardState, readonly CardState[]> = {
  backlog: ["working", "cancelled"],
  working: ["review", "blocked", "backlog", "cancelled"],
  review: ["working", "blocked", "done", "cancelled"],
  blocked: ["working", "review", "done", "cancelled"],
  done: [],
  cancelled: [],
}

export const TERMINAL_CARD_STATES: readonly CardState[] = ["done", "cancelled"]

export function isTerminalCardState(s: CardState): boolean {
  return TERMINAL_CARD_STATES.includes(s)
}

/** Valida uma transição contra a máquina. Lança em transição inválida — o
 *  chamador (store/UI) decide como apresentar. */
export function assertCardTransition(from: CardState, to: CardState): void {
  if (!CARD_STATE_MACHINE[from]?.includes(to)) {
    throw new Error(`transição de card inválida: ${from} → ${to}`)
  }
}

export interface CardRecord {
  id: string
  projectId: string
  title: string
  body: string | null
  state: CardState
  /** Agent que executou o 1º turno da conversa ligada (carimbo lazy, S1.4). */
  assigneeAgent: string | null
  /** Conversa que executa a intenção (sobrevive a resume/transplant). */
  conversationId: string | null
  /** Reservado pra identidade de persona (Sprint 3) — NÃO inventar antes. */
  owner: string | null
  pinned: boolean
  pinRank: number | null
  createdAt: number
  updatedAt: number
}

let boardReady: Promise<void> | null = null

async function ensureBoardTables(db: Database): Promise<void> {
  if (!boardReady) {
    const run = (async () => {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS cards (
           id TEXT PRIMARY KEY,
           project_id TEXT,
           title TEXT NOT NULL,
           body TEXT,
           state TEXT NOT NULL DEFAULT 'backlog',
           assignee_agent TEXT,
           conversation_id TEXT,
           owner TEXT,
           pinned INTEGER NOT NULL DEFAULT 0,
           pin_rank INTEGER,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         )`,
      )
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_cards_project ON cards(project_id, state)`,
      )
    })()
    // cache fixa SÓ em sucesso (falha transitória não envenena o processo).
    boardReady = run.catch((e) => {
      boardReady = null
      throw e
    })
  }
  return boardReady
}

interface CardRow {
  id: string
  project_id: string
  title: string
  body: string | null
  state: string
  assignee_agent: string | null
  conversation_id: string | null
  owner: string | null
  pinned: number
  pin_rank: number | null
  created_at: number
  updated_at: number
}

const CARD_COLS =
  "id, project_id, title, body, state, assignee_agent, conversation_id, owner, pinned, pin_rank, created_at, updated_at"

/** Clamp de leitura: valor estranho gravado à mão degrada pra 'backlog'. */
function toCardState(s: string): CardState {
  return s in CARD_STATE_MACHINE ? (s as CardState) : "backlog"
}

function toCard(r: CardRow): CardRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    body: r.body,
    state: toCardState(r.state),
    assigneeAgent: r.assignee_agent,
    conversationId: r.conversation_id,
    owner: r.owner,
    pinned: r.pinned === 1,
    pinRank: r.pin_rank,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/** Cria um card no backlog e devolve o registro. Fora do Tauri o registro
 *  existe só em memória (nada persiste, como todo o resto do dev no browser). */
export async function createCard(c: {
  projectId: string
  title: string
  body?: string | null
}): Promise<CardRecord> {
  const now = Date.now()
  const card: CardRecord = {
    id: crypto.randomUUID(),
    projectId: c.projectId,
    title: c.title,
    body: c.body ?? null,
    state: "backlog",
    assigneeAgent: null,
    conversationId: null,
    owner: null,
    pinned: false,
    pinRank: null,
    createdAt: now,
    updatedAt: now,
  }
  const db = await getDb()
  if (!db) return card
  await ensureBoardTables(db)
  await db.execute(
    "INSERT INTO cards (id, project_id, title, body, state, assignee_agent, conversation_id, owner, pinned, pin_rank, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    [
      card.id,
      card.projectId,
      card.title,
      card.body,
      card.state,
      card.assigneeAgent,
      card.conversationId,
      card.owner,
      card.pinned ? 1 : 0,
      card.pinRank,
      card.createdAt,
      card.updatedAt,
    ],
  )
  return card
}

/** Cards (de um projeto, ou todos) em ordem de criação. SEM catch: erro real
 *  propaga — o store decide manter o estado anterior em vez de zerar o board. */
export async function listCards(projectId?: string): Promise<CardRecord[]> {
  const db = await getDb()
  if (!db) return []
  await ensureBoardTables(db)
  const rows = projectId
    ? await db.select<CardRow[]>(
        `SELECT ${CARD_COLS} FROM cards WHERE project_id = $1 ORDER BY created_at ASC`,
        [projectId],
      )
    : await db.select<CardRow[]>(
        `SELECT ${CARD_COLS} FROM cards ORDER BY created_at ASC`,
      )
  return rows.map(toCard)
}

/** Um card pelo id (interno da validação de transição). */
async function loadCardState(db: Database, id: string): Promise<CardState> {
  const rows = await db.select<{ state: string }[]>(
    "SELECT state FROM cards WHERE id = $1",
    [id],
  )
  // sem id técnico: a mensagem vaza pro toast da UI.
  if (!rows.length) throw new Error("Card não encontrado no board")
  return toCardState(rows[0].state)
}

/** Patch parcial (campo `undefined` = mantém; não há como limpar pra NULL no
 *  v1 — se precisar, ganha função própria). Estado NÃO passa por aqui. */
export async function updateCard(
  id: string,
  patch: {
    title?: string
    body?: string
    pinned?: boolean
    pinRank?: number
  },
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureBoardTables(db)
  await db.execute(
    "UPDATE cards SET title = COALESCE($1, title), body = COALESCE($2, body), pinned = COALESCE($3, pinned), pin_rank = COALESCE($4, pin_rank), updated_at = $5 WHERE id = $6",
    [
      patch.title ?? null,
      patch.body ?? null,
      patch.pinned == null ? null : patch.pinned ? 1 : 0,
      patch.pinRank ?? null,
      Date.now(),
      id,
    ],
  )
}

/** Move o card validando a máquina de estados. done/cancelled NUNCA entram por
 *  aqui (gate humano-only): só via `closeCard`. Lança em transição inválida.
 *  `now` (S2.2/F1): UM relógio por mutação — o store passa o MESMO timestamp
 *  que carimba no patch local, senão um reload do banco chega com updated_at
 *  diferente por ms e o vigia lê drift como "atividade" (episódio duplicado). */
export async function setCardState(
  id: string,
  state: CardState,
  now: number = Date.now(),
): Promise<void> {
  if (isTerminalCardState(state)) {
    // pt-BR sem jargão: a mensagem vaza pro toast da UI (gate humano-only).
    throw new Error(
      "Concluir ou cancelar um card é gesto humano: use a ação de fechar do card",
    )
  }
  const db = await getDb()
  if (!db) return
  await ensureBoardTables(db)
  const cur = await loadCardState(db, id)
  assertCardTransition(cur, state)
  await db.execute("UPDATE cards SET state = $1, updated_at = $2 WHERE id = $3", [
    state,
    now,
    id,
  ])
}

/** Fecha o card (done/cancelled) — o ÚNICO caminho pros estados terminais,
 *  reservado ao gesto humano (prepara o E3). Valida a máquina.
 *  `now`: mesmo contrato de relógio único do setCardState. */
export async function closeCard(
  id: string,
  state: "done" | "cancelled",
  now: number = Date.now(),
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureBoardTables(db)
  const cur = await loadCardState(db, id)
  assertCardTransition(cur, state)
  await db.execute("UPDATE cards SET state = $1, updated_at = $2 WHERE id = $3", [
    state,
    now,
    id,
  ])
}

/** Liga o card à conversa que o executa (S1.4). O link sobrevive a
 *  resume/transplant (mesmo conversation_id).
 *  `now`: mesmo contrato de relógio único do setCardState. */
export async function linkCardConversation(
  id: string,
  convId: string,
  now: number = Date.now(),
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureBoardTables(db)
  await db.execute(
    "UPDATE cards SET conversation_id = $1, updated_at = $2 WHERE id = $3",
    [convId, now, id],
  )
}

/** Carimba o agent que o 1º turno da conversa ligada resolveu (S1.4).
 *  `now`: mesmo contrato de relógio único do setCardState. */
export async function setCardAssignee(
  id: string,
  agent: string,
  now: number = Date.now(),
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureBoardTables(db)
  await db.execute(
    "UPDATE cards SET assignee_agent = $1, updated_at = $2 WHERE id = $3",
    [agent, now, id],
  )
}

/** Custo por card v1 = soma de turn_costs por conv_id (cobre chat + disputas;
 *  missão/SDD não têm conv_id e ficam FORA — a UI diz isso em vez de fingir
 *  total). `estimated` = algum custo sem proveniência 'reported' (COALESCE:
 *  cost_source NULL também conta como estimado — o "~" honesto). Erro PROPAGA
 *  (nada de catch silencioso em polling): o caller mantém o last-known. */
export async function listCardCosts(
  convIds: string[],
): Promise<Record<string, { total: number; estimated: boolean }>> {
  if (convIds.length === 0) return {}
  const db = await getDb()
  if (!db) return {}
  try {
    const placeholders = convIds.map((_, i) => `$${i + 1}`).join(", ")
    const rows = await db.select<
      { conv_id: string; total: number | null; est: number }[]
    >(
      `SELECT conv_id, SUM(cost_usd) AS total, MAX(CASE WHEN COALESCE(cost_source, '') != 'reported' THEN 1 ELSE 0 END) AS est FROM turn_costs WHERE conv_id IN (${placeholders}) GROUP BY conv_id`,
      convIds,
    )
    const out: Record<string, { total: number; estimated: boolean }> = {}
    for (const r of rows) {
      out[r.conv_id] = { total: r.total ?? 0, estimated: r.est === 1 }
    }
    return out
  } catch (e) {
    console.warn("[cards] listCardCosts falhou", e)
    throw e
  }
}

/** Refs de TODAS as conversas (id + updatedAt) p/ o GC de anexos. Retorna `null`
 *  em qualquer falha/não-Tauri (F1: o boot NÃO chama o GC com null, só com `[]`
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
