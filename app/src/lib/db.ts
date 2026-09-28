import Database from "@tauri-apps/plugin-sql"
import type { Project } from "@/lib/types"
import type { ConvRef } from "@/lib/attachments"
import type { FusionRun } from "@/store/fusion"
import type { FusionOutcome } from "@/lib/retro"
import type { DeliveryRecord } from "@/lib/recall"
import type { CumulativeUsage } from "@/lib/usage"
import { planUsageRecompute, recomputeSummary, worthLedgerRow } from "@/lib/usage"
import { addColumn, ensureComposerDraftTables } from "@/lib/db/schema"
import { deleteSchedulesOfProject } from "@/lib/db/schedules"

export { addColumn } from "@/lib/db/schema"

const DB_URL = "sqlite:frota.db" // DEVE bater com add_migrations no lib.rs

let dbPromise: Promise<Database> | null = null

/** Estamos rodando dentro do runtime do Tauri? (vs. `vite dev` no browser) */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

/** A conexão única do app (`null` fora do Tauri). Exportada para domínios que
 *  moram em arquivo próprio (`lib/modelLedger.ts`) não abrirem uma segunda. */
export async function getDb(): Promise<Database | null> {
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

// Ordem do usuário (sort_order). Linha sem ordem cai no topo por created_at.
export async function listProjects(): Promise<Project[] | null> {
  const db = await getDb()
  if (!db) return null
  const rows = await db.select<ProjectRow[]>(
    "SELECT id, name, path, created_at, has_claude_md, has_agents_md, permission_mode, color FROM projects WHERE deleted_at IS NULL ORDER BY (sort_order IS NOT NULL), sort_order ASC, created_at DESC",
  )
  return rows.map(toProject)
}

/** Projetos arquivados (deleted_at), mais recentes primeiro: a seção
 *  "Arquivados (N)" da sidebar. */
export async function listArchivedProjects(): Promise<Project[] | null> {
  const db = await getDb()
  if (!db) return null
  const rows = await db.select<ProjectRow[]>(
    "SELECT id, name, path, created_at, has_claude_md, has_agents_md, permission_mode, color FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC",
  )
  return rows.map(toProject)
}

/** S1.2 — persiste a ordem manual dos projetos (ids na ordem de exibição).
 *  Renumera todo mundo: a lista é pequena e a simplicidade evita buracos. */
export async function persistProjectOrder(ids: string[]): Promise<void> {
  const db = await getDb()
  if (!db) return
  for (let i = 0; i < ids.length; i++) {
    await db.execute("UPDATE projects SET sort_order = $1 WHERE id = $2", [
      i,
      ids[i],
    ])
  }
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
  // sort_order = MIN-1: projeto novo entra no TOPO (comportamento herdado do
  // created_at DESC), sem atropelar a ordem manual dos existentes (S1.2).
  const res = await db.execute(
    "INSERT OR IGNORE INTO projects (id, name, path, created_at, has_claude_md, has_agents_md, permission_mode, color, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT COALESCE(MIN(sort_order), 1) - 1 FROM projects))",
    [
      p.id,
      p.name,
      p.path,
      p.createdAt,
      p.hasClaudeMd ? 1 : 0,
      p.hasAgentsMd ? 1 : 0,
      p.permissionMode ?? "padrao", p.color ?? null,
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

/** Exclui de vez um projeto já arquivado: a linha, as conversas, os
 *  agendamentos (senão disparariam automação para projeto morto) e os cards.
 *  Métricas históricas (stage_runs, turn_costs, deliveries, lessons) ficam:
 *  são registro do que aconteceu. Blobs órfãos caem no GC. Irreversível; o
 *  caller sempre confirma. */
export async function hardDeleteProject(id: string): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureBoardTables(db)
  await deleteSchedulesOfProject(id)
  await db.execute("DELETE FROM cards WHERE project_id = $1", [id])
  await db.execute("DELETE FROM conversations WHERE project_id = $1", [id])
  await db.execute("DELETE FROM projects WHERE id = $1", [id])
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

/** Disputas arquivadas desde `sinceMs`, reduzidas a vencedor e custo por
 *  candidato. `created_at` é o arquivamento, não o lançamento (irrelevante
 *  para 30 dias, e é o único carimbo). JSON inesperado é descartado: uma
 *  linha ilegível não derruba a tela. */
export async function listFusionOutcomes(
  sinceMs: number,
): Promise<FusionOutcome[]> {
  const db = await getDb()
  if (!db) return []
  try {
    const rows = await db.select<{ data: string; created_at: number }[]>(
      "SELECT data, created_at FROM fusion_runs WHERE created_at >= $1 ORDER BY created_at ASC",
      [sinceMs],
    )
    const out: FusionOutcome[] = []
    for (const r of rows) {
      try {
        const raw = JSON.parse(r.data) as {
          chosenId?: unknown
          candidates?: unknown
        }
        if (!Array.isArray(raw.candidates)) continue
        out.push({
          createdAt: r.created_at,
          chosenId: typeof raw.chosenId === "string" ? raw.chosenId : null,
          candidates: raw.candidates.map((c) => {
            const cand = (c ?? {}) as Record<string, unknown>
            return {
              id: typeof cand.id === "string" ? cand.id : "",
              agent: typeof cand.agent === "string" ? cand.agent : "",
              costUsd: typeof cand.costUsd === "number" ? cand.costUsd : null,
            }
          }),
        })
      } catch (e) {
        console.warn("[retro] disputa arquivada ilegível, ignorada", e)
      }
    }
    return out
  } catch (e) {
    console.warn("[retro] falha ao ler as disputas arquivadas", e)
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

// ---------------- Auto-aprendizado: deliveries + lessons ----------------
// Tabelas do frontend (CREATE IF NOT EXISTS, sem migração no lib.rs);
// `ensureLearningTables` roda uma vez por processo antes de ler ou escrever.

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

// ── Índice de MISSÕES ──
// Os artefatos moram em .frota/missions/<slug>/ (lib/missionPaths); este é o
// índice durável: sobrevive a mover a pasta, lista sem varrer o disco e
// guarda o `dir` de cada missão. Tabela do frontend, sem migração no lib.rs.
let missionsReady: Promise<void> | null = null
async function ensureMissionsTable(db: Database): Promise<void> {
  if (!missionsReady) {
    const run = db
      .execute(
        `CREATE TABLE IF NOT EXISTS missions (
           id TEXT PRIMARY KEY,
           slug TEXT NOT NULL,
           dir TEXT NOT NULL,
           conv_id TEXT NOT NULL,
           project_id TEXT NOT NULL,
           task TEXT NOT NULL,
           preset_name TEXT,
           status TEXT NOT NULL,
           cost_total REAL NOT NULL DEFAULT 0,
           phase_current INTEGER NOT NULL DEFAULT 0,
           phase_count INTEGER NOT NULL DEFAULT 0,
           review_caveat TEXT,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         )`,
      )
      .then(() =>
        // Audit trail do "done com ressalva": JSON {rounds, feedback} ou NULL,
        // por addColumn para bancos anteriores.
        addColumn(db, `ALTER TABLE missions ADD COLUMN review_caveat TEXT`),
      )
      .then(() =>
        db.execute(
          `CREATE INDEX IF NOT EXISTS idx_missions_project ON missions(project_id, updated_at)`,
        ),
      )
      .then(() => {})
    missionsReady = run.catch((e) => {
      missionsReady = null
      throw e
    })
  }
  return missionsReady
}

/** Linha do índice de missões (uma por missão, atualizada nos marcos). */
export interface MissionIndexRow {
  id: string
  slug: string
  dir: string
  convId: string
  projectId: string
  task: string
  presetName: string | null
  status: string
  costTotal: number
  phaseCurrent: number
  phaseCount: number
  /** MH1.1 — "done" SEM aprovação do revisor: {rounds, feedback} ou null. O
   *  histórico não pode contar "concluída" seca quando houve ressalva.
   *  Opcional na escrita (linhas antigas não tinham); a leitura sempre traz. */
  reviewCaveat?: { rounds: number; feedback: string } | null
  createdAt: number
  updatedAt: number
}

interface MissionIndexDbRow {
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
  review_caveat: string | null
  created_at: number
  updated_at: number
}

/** Parse tolerante do review_caveat persistido (JSON ou lixo ⇒ null). */
function parseMissionCaveat(
  raw: string | null,
): { rounds: number; feedback: string } | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as { rounds?: unknown; feedback?: unknown }
    if (typeof o?.rounds === "number" && typeof o?.feedback === "string") {
      return { rounds: o.rounds, feedback: o.feedback }
    }
  } catch {
    // lixo na coluna não derruba o histórico
  }
  return null
}

/** Grava/atualiza a missão no índice. `created_at` só entra no INSERT (o
 *  ON CONFLICT preserva a data de criação). Best-effort no caller. */
export async function upsertMission(m: MissionIndexRow): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureMissionsTable(db)
  await db.execute(
    // review_caveat entra por ÚLTIMO de propósito: os 13 primeiros parâmetros
    // preservam a ordem histórica (fakes/ferramentas que leem posicional não
    // quebram com a coluna nova).
    `INSERT INTO missions (id, slug, dir, conv_id, project_id, task, preset_name, status, cost_total, phase_current, phase_count, created_at, updated_at, review_caveat)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT(id) DO UPDATE SET
       task = excluded.task,
       preset_name = excluded.preset_name,
       status = excluded.status,
       cost_total = excluded.cost_total,
       phase_current = excluded.phase_current,
       phase_count = excluded.phase_count,
       review_caveat = excluded.review_caveat,
       updated_at = excluded.updated_at`,
    [
      m.id,
      m.slug,
      m.dir,
      m.convId,
      m.projectId,
      m.task,
      m.presetName,
      m.status,
      m.costTotal,
      m.phaseCurrent,
      m.phaseCount,
      m.createdAt,
      m.updatedAt,
      m.reviewCaveat ? JSON.stringify(m.reviewCaveat) : null,
    ],
  )
}

function toMissionIndex(r: MissionIndexDbRow): MissionIndexRow {
  return {
    id: r.id,
    slug: r.slug,
    dir: r.dir,
    convId: r.conv_id,
    projectId: r.project_id,
    task: r.task,
    presetName: r.preset_name,
    status: r.status,
    costTotal: r.cost_total,
    phaseCurrent: r.phase_current,
    phaseCount: r.phase_count,
    reviewCaveat: parseMissionCaveat(r.review_caveat),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/** Missões do índice (de um projeto, ou todas), mais recentes primeiro.
 *  Vazio em qualquer falha (histórico é secundário — nunca derruba a UI). */
export async function listMissions(
  projectId?: string,
  limit = 100,
): Promise<MissionIndexRow[]> {
  const db = await getDb()
  if (!db) return []
  try {
    await ensureMissionsTable(db)
    const rows = projectId
      ? await db.select<MissionIndexDbRow[]>(
          "SELECT * FROM missions WHERE project_id = $1 ORDER BY updated_at DESC LIMIT $2",
          [projectId, limit],
        )
      : await db.select<MissionIndexDbRow[]>(
          "SELECT * FROM missions ORDER BY updated_at DESC LIMIT $1",
          [limit],
        )
    return rows.map(toMissionIndex)
  } catch (e) {
    console.warn("[missões] listMissions falhou", e)
    return []
  }
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

/** Entregas de TODOS os projetos desde `sinceMs` (a retrospectiva do Painel).
 *  Sem LIMIT de propósito: aqui o número é DENOMINADOR ("US$ X por entrega"),
 *  e denominador cortado em silêncio é uma métrica que ninguém confere. */
export async function listDeliveriesSince(
  sinceMs: number,
): Promise<RecentDelivery[]> {
  const db = await getDb()
  if (!db) return []
  try {
    await ensureLearningTables(db)
    const rows = await db.select<(DeliveryRow & { project_id: string })[]>(
      "SELECT id, project_id, task, plan_summary, files_touched, cost_usd, agent, model, created_at FROM deliveries WHERE created_at >= $1 ORDER BY created_at DESC",
      [sinceMs],
    )
    return rows.map((r) => ({ ...toDelivery(r), projectId: r.project_id }))
  } catch {
    return []
  }
}

/** Quantas conversas NASCERAM desde `sinceMs` (a contagem da retrospectiva).
 *  null = sem banco ou falha de leitura: a UI omite a contagem em vez de
 *  mostrar "0 conversas", que seria mentira com cara de dado. */
export async function countConversationsSince(
  sinceMs: number,
): Promise<number | null> {
  const db = await getDb()
  if (!db) return null
  try {
    const rows = await db.select<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM conversations WHERE created_at >= $1",
      [sinceMs],
    )
    return rows[0]?.n ?? 0
  } catch (e) {
    console.warn("[retro] falha ao contar conversas", e)
    return null
  }
}

/** Quantas regras de aprendizado estão ATIVAS (cross-projeto). Contagem baixa
 *  não é feature morta; o app deixar de contar é que seria esquecê-la. */
export async function countActiveLessons(): Promise<number | null> {
  const db = await getDb()
  if (!db) return null
  try {
    await ensureLearningTables(db)
    const rows = await db.select<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM lessons WHERE status = 'active'",
    )
    return rows[0]?.n ?? 0
  } catch (e) {
    console.warn("[retro] falha ao contar aprendizados", e)
    return null
  }
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

// ---------------- Lead propositor: lead_proposals ----------------
// A proposta do lead é TEXTO, nunca ação: vira Decision na fila "Precisam de
// você" até ser dispensada. Aprovar um item é o gesto humano normal de
// despachar o card.

let leadReady: Promise<void> | null = null

async function ensureLeadTables(db: Database): Promise<void> {
  if (!leadReady) {
    const run = (async () => {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS lead_proposals (
           id TEXT PRIMARY KEY,
           project_id TEXT,
           body TEXT NOT NULL,
           created_at INTEGER NOT NULL,
           dismissed INTEGER NOT NULL DEFAULT 0
         )`,
      )
    })()
    // mesmo contrato do ensureLearningTables: cache só fixa em sucesso.
    leadReady = run.catch((e) => {
      leadReady = null
      throw e
    })
  }
  return leadReady
}

export interface LeadProposalRecord {
  id: string
  /** null = proposta do board inteiro (cross-projeto). */
  projectId: string | null
  body: string
  createdAt: number
}

/** Grava uma proposta do lead e devolve o id (fora do Tauri, nada persiste).
 *  A nova dispensa as abertas do MESMO escopo (mesmo projeto, ou o board
 *  inteiro), para um agendamento ignorado não empilhar propostas quase iguais.
 *  Escopos diferentes coexistem. */
export async function insertProposal(p: {
  projectId: string | null
  body: string
}): Promise<string> {
  const id = crypto.randomUUID()
  const db = await getDb()
  if (!db) return id
  await ensureLeadTables(db)
  if (p.projectId == null) {
    await db.execute(
      "UPDATE lead_proposals SET dismissed = 1 WHERE dismissed = 0 AND project_id IS NULL",
    )
  } else {
    await db.execute(
      "UPDATE lead_proposals SET dismissed = 1 WHERE dismissed = 0 AND project_id = $1",
      [p.projectId],
    )
  }
  await db.execute(
    "INSERT INTO lead_proposals (id, project_id, body, created_at, dismissed) VALUES ($1, $2, $3, $4, 0)",
    [id, p.projectId, p.body, Date.now()],
  )
  return id
}

/** Propostas ainda não dispensadas (mais novas primeiro) — a matéria-prima da
 *  derivação proposal→Decision no inbox. */
export async function listOpenProposals(): Promise<LeadProposalRecord[]> {
  const db = await getDb()
  if (!db) return []
  try {
    await ensureLeadTables(db)
    const rows = await db.select<
      {
        id: string
        project_id: string | null
        body: string
        created_at: number
      }[]
    >(
      "SELECT id, project_id, body, created_at FROM lead_proposals WHERE dismissed = 0 ORDER BY created_at DESC",
    )
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      body: r.body,
      createdAt: r.created_at,
    }))
  } catch {
    return []
  }
}

/** Dispensa a proposta (soft: a linha fica, fora da fila). */
export async function dismissProposal(id: string): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureLeadTables(db)
  await db.execute("UPDATE lead_proposals SET dismissed = 1 WHERE id = $1", [
    id,
  ])
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

/** Grava o custo de um run (turno, candidato de disputa ou tentativa de fase
 *  de missão). REPLACE por run_id colapsa os results parciais no total. Entra
 *  tudo que consumiu, com preço ou com `costUsd` NULL (ADR-047). Best-effort. */
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
  if (!db || !worthLedgerRow(r)) return // sem preço E sem token: não é consumo
  try {
    await db.execute(
      "INSERT OR REPLACE INTO turn_costs (run_id, project_id, conv_id, agent, model, cost_usd, cost_source, input_tokens, output_tokens, cache_tokens, created_at, usage_basis) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
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
        // ADR-033: da correção em diante TODA linha é o gasto DO TURNO (o
        // runner já subtraiu o acumulado da thread). O carimbo é o que separa
        // estas linhas do histórico antigo, que guardava o acumulado.
        USAGE_BASIS_DELTA,
      ],
    )
  } catch {
    // best-effort
  }
}

// ---- Usage acumulado por thread (ADR-033) ----
// O `codex exec` reporta o total da THREAD, não do turno. O runner normaliza
// para delta, mas a thread sobrevive ao run: o acumulado conhecido persiste
// aqui, junto do session_id da conversa.

/** Carimbo de base de uma linha de turn_costs (coluna `usage_basis`). */
export const USAGE_BASIS_DELTA = "delta"
export const USAGE_BASIS_RECOMPUTED = "recomputed"

let usageBaselineReady: Promise<void> | null = null

/** Tabelas do frontend: `usage_baselines` (acumulado já contabilizado por
 *  thread) e `turn_costs_usage_raw` (valores originais das linhas
 *  reconstruídas: a reconstrução é auditável e reversível). */
export async function ensureUsageTables(db: Database): Promise<void> {
  if (!usageBaselineReady) {
    const run = (async () => {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS usage_baselines (
           thread_id TEXT PRIMARY KEY,
           conv_id TEXT,
           input INTEGER NOT NULL DEFAULT 0,
           cached_input INTEGER NOT NULL DEFAULT 0,
           output INTEGER NOT NULL DEFAULT 0,
           updated_at INTEGER NOT NULL
         )`,
      )
      await db.execute(
        `CREATE TABLE IF NOT EXISTS turn_costs_usage_raw (
           run_id TEXT PRIMARY KEY,
           cost_usd REAL,
           input_tokens INTEGER NOT NULL DEFAULT 0,
           output_tokens INTEGER NOT NULL DEFAULT 0,
           cache_tokens INTEGER NOT NULL DEFAULT 0,
           backed_up_at INTEGER NOT NULL
         )`,
      )
    })()
    usageBaselineReady = run.catch((e) => {
      usageBaselineReady = null
      throw e
    })
  }
  return usageBaselineReady
}

/** Quanto a thread já acumulou (o baseline do próximo run). null = thread nova,
 *  o turno vale inteiro. Sem linha de baseline, semeia uma vez com a última
 *  linha de turn_costs da conversa, que ainda guarda o acumulado cru: evita
 *  cobrar a thread inteira de novo. Se a thread mudou nesse meio-tempo, o
 *  turno seguinte sai subcontado uma vez, na direção segura. */
export async function loadUsageBaseline(
  threadId: string,
  convId: string,
  cumulativeAgents: string[],
): Promise<CumulativeUsage | null> {
  const db = await getDb()
  if (!db) return null
  try {
    await ensureUsageTables(db)
    const rows = await db.select<
      { input: number; cached_input: number; output: number }[]
    >(
      "SELECT input, cached_input, output FROM usage_baselines WHERE thread_id = $1",
      [threadId],
    )
    if (rows.length) {
      return {
        input: rows[0].input,
        cached_input: rows[0].cached_input,
        output: rows[0].output,
      }
    }
    if (!cumulativeAgents.length) return null
    const ph = cumulativeAgents.map((_, i) => `$${i + 2}`).join(", ")
    const legacy = await db.select<
      {
        usage_basis: string | null
        i: number
        c: number
        o: number
      }[]
    >(
      `SELECT t.usage_basis AS usage_basis,
              COALESCE(b.input_tokens, t.input_tokens) AS i,
              COALESCE(b.cache_tokens, t.cache_tokens) AS c,
              COALESCE(b.output_tokens, t.output_tokens) AS o
         FROM turn_costs t
         LEFT JOIN turn_costs_usage_raw b ON b.run_id = t.run_id
        WHERE t.conv_id = $1 AND t.agent IN (${ph})
        ORDER BY t.created_at DESC LIMIT 1`,
      [convId, ...cumulativeAgents],
    )
    const last = legacy[0]
    // linha já gravada como delta = mundo pós-correção, nada a semear.
    if (!last || last.usage_basis === USAGE_BASIS_DELTA) return null
    const seed: CumulativeUsage = {
      input: last.i,
      cached_input: last.c,
      output: last.o,
    }
    if (!seed.input && !seed.cached_input && !seed.output) return null
    await saveUsageBaseline(threadId, convId, seed, "seed")
    return seed
  } catch {
    // Sem baseline o turno vale inteiro (superestima uma vez) — nunca derruba
    // o turno por causa de telemetria.
    return null
  }
}

/** Guarda o acumulado reportado nesta thread. `mode: "seed"` só preenche o que
 *  falta, para a reconstrução não atropelar um baseline mais novo. */
export async function saveUsageBaseline(
  threadId: string,
  convId: string | null,
  usage: CumulativeUsage,
  mode: "upsert" | "seed" = "upsert",
): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    await ensureUsageTables(db)
    await db.execute(
      `INSERT INTO usage_baselines (thread_id, conv_id, input, cached_input, output, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ${
         mode === "seed"
           ? "ON CONFLICT(thread_id) DO NOTHING"
           : `ON CONFLICT(thread_id) DO UPDATE SET
         conv_id = excluded.conv_id,
         input = excluded.input,
         cached_input = excluded.cached_input,
         output = excluded.output,
         updated_at = excluded.updated_at`
       }`,
      [
        threadId,
        convId,
        usage.input,
        usage.cached_input,
        usage.output,
        Date.now(),
      ],
    )
  } catch {
    // best-effort: perder o baseline superestima o PRÓXIMO turno, não quebra o run.
  }
}

/** Quantas linhas do ledger ainda estão na base antiga, e quanto somam. Só
 *  leitura: é o que a manutenção mostra antes de escrever. */
export async function countCumulativeLedgerRows(
  agentIds: string[],
): Promise<{ rows: number; total: number }> {
  const db = await getDb()
  if (!db || !agentIds.length) return { rows: 0, total: 0 }
  const ph = agentIds.map((_, i) => `$${i + 1}`).join(", ")
  const r = await db.select<{ n: number; total: number | null }[]>(
    `SELECT COUNT(*) AS n, SUM(cost_usd) AS total FROM turn_costs
      WHERE usage_basis IS NULL AND agent IN (${ph})`,
    agentIds,
  )
  return { rows: r[0]?.n ?? 0, total: r[0]?.total ?? 0 }
}

/** Reconstrói o gasto por turno das linhas gravadas como acumulado (ADR-033).
 *  Só por gesto em Configurações. Não apaga nada (originais vão para
 *  `turn_costs_usage_raw`, a linha fica carimbada `recomputed`); idempotente e
 *  retomável. */
export async function recomputeCumulativeLedger(
  agentIds: string[],
): Promise<{ rows: number; before: number; after: number }> {
  const db = await getDb()
  if (!db || !agentIds.length) return { rows: 0, before: 0, after: 0 }
  await ensureUsageTables(db)
  const ph = agentIds.map((_, i) => `$${i + 1}`).join(", ")
  const raw = await db.select<
    {
      run_id: string
      conv_id: string
      cost_usd: number | null
      input_tokens: number
      output_tokens: number
      cache_tokens: number
      created_at: number
    }[]
  >(
    `SELECT run_id, conv_id, cost_usd, input_tokens, output_tokens, cache_tokens, created_at
       FROM turn_costs
      WHERE usage_basis IS NULL AND agent IN (${ph})
      ORDER BY conv_id, created_at`,
    agentIds,
  )
  if (!raw.length) return { rows: 0, before: 0, after: 0 }
  const plan = planUsageRecompute(
    raw.map((r) => ({
      runId: r.run_id,
      convId: r.conv_id,
      costUsd: r.cost_usd,
      input: r.input_tokens,
      output: r.output_tokens,
      cache: r.cache_tokens,
      createdAt: r.created_at,
    })),
  )
  // Semeia o baseline das threads vivas antes do UPDATE: depois dele o
  // acumulado cru só existe no backup.
  const lastByConv = new Map<string, (typeof plan)[number]>()
  for (const row of plan) lastByConv.set(row.convId, row)
  for (const [convId, row] of lastByConv) {
    const conv = await db.select<{ session_id: string | null }[]>(
      "SELECT session_id FROM conversations WHERE id = $1",
      [convId],
    )
    const threadId = conv[0]?.session_id
    if (!threadId) continue
    await saveUsageBaseline(
      threadId,
      convId,
      {
        input: row.raw.input,
        cached_input: row.raw.cache,
        output: row.raw.output,
      },
      // nunca atropela um baseline mais novo (turno já corrigido nessa thread)
      "seed",
    )
  }
  for (const row of plan) {
    await db.execute(
      `INSERT OR IGNORE INTO turn_costs_usage_raw
         (run_id, cost_usd, input_tokens, output_tokens, cache_tokens, backed_up_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        row.runId,
        row.raw.costUsd,
        row.raw.input,
        row.raw.output,
        row.raw.cache,
        Date.now(),
      ],
    )
    await db.execute(
      `UPDATE turn_costs
          SET cost_usd = $1, input_tokens = $2, output_tokens = $3,
              cache_tokens = $4, usage_basis = $5
        WHERE run_id = $6`,
      [
        row.costUsd,
        row.input,
        row.output,
        row.cache,
        USAGE_BASIS_RECOMPUTED,
        row.runId,
      ],
    )
  }
  return recomputeSummary(plan)
}

/** Ledger unificado desde `sinceMs`: turn_costs (chat, disputa, fases de
 *  missão) e stage_runs, caminhos disjuntos que não contam em dobro.
 *  stage_runs é histórico só-leitura (a aba Features saiu), mas o dinheiro foi
 *  gasto e segue nos totais. `deliveries` é registro de entrega, não de custo,
 *  e fica fora: contaria as missões em dobro. stage_runs não guarda tokens. */
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

/** Muda o status de uma lição sem excluir. A falha propaga para a superfície
 *  não anunciar uma decisão que não foi persistida. */
export async function setLessonStatus(
  id: string,
  status: LessonStatus,
): Promise<void> {
  const db = await getDb()
  if (!db) throw new Error("Banco de memórias indisponível")
  await ensureLearningTables(db)
  await db.execute("UPDATE lessons SET status = $1 WHERE id = $2", [status, id])
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

// ---------------- agent_presets: legado, só leitura para migrar ----------------
// As personas moram em `.frota/agents/*.md` (ADR-025); esta tabela só alimenta
// a migração, uma vez por sessão. O CREATE IF NOT EXISTS fica para o SELECT
// devolver vazio numa instalação nova. AgentPreset segue sendo o formato da
// persona.

let presetsReady: Promise<void> | null = null

export interface AgentPreset {
  id: string
  name: string
  personalityMd: string
  /** Nomes de skills/comandos do projeto (o preflight valida contra o
   *  inventário real POR AGENT: .frota/commands + as convenções nativas
   *  do backend do preset). */
  skills: string[]
  policy: string | null
  /** Agent (CLI) que encarna a persona — obrigatório. */
  backend: string
  model: string | null
  effort: string | null
  /** Categoria de marketplace (Especialistas E2). Cosmético — NÃO entra no
   *  digest. Ausente no arquivo = "Geral". */
  category: string
  /** Rubrica: o checklist que a persona aplica. Entra no DIGEST (muda o
   *  comportamento). Ausente = []. */
  rubric: string[]
  /** Identidade visual DiceBear (Especialistas E2). Cosméticos — NÃO entram no
   *  digest. Ausentes = style "thumbs" (default do sistema), seed = slug; a cor
   *  vem da categoria (lib/avatar.avatarFor). avatarStyle é override avançado. */
  avatarStyle: string
  avatarSeed: string
  digest: string
  version: number
  createdAt: number
  updatedAt: number
}

/** Campos editáveis de um preset (o resto — digest/version/datas — é derivado). */
export interface AgentPresetInput {
  name: string
  personalityMd: string
  skills: string[]
  policy: string | null
  backend: string
  model: string | null
  effort: string | null
  category: string
  rubric: string[]
  avatarStyle: string
  avatarSeed: string
}

async function ensureAgentPresetTables(db: Database): Promise<void> {
  if (!presetsReady) {
    const run = (async () => {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS agent_presets (
           id TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           personality_md TEXT,
           skills_json TEXT,
           policy TEXT,
           backend TEXT NOT NULL,
           model TEXT,
           effort TEXT,
           digest TEXT NOT NULL,
           version INTEGER NOT NULL DEFAULT 1,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         )`,
      )
    })()
    // cache só fica FIXO em sucesso (falha reseta pra retentar) — padrão
    // ensureLearningTables.
    presetsReady = run.catch((e) => {
      presetsReady = null
      throw e
    })
  }
  return presetsReady
}

interface PresetRow {
  id: string
  name: string
  personality_md: string | null
  skills_json: string | null
  policy: string | null
  backend: string
  model: string | null
  effort: string | null
  digest: string
  version: number
  created_at: number
  updated_at: number
}

function toPreset(r: PresetRow): AgentPreset {
  let skills: string[] = []
  try {
    const p = r.skills_json ? JSON.parse(r.skills_json) : []
    if (Array.isArray(p)) {
      skills = p.filter((x): x is string => typeof x === "string")
    }
  } catch {
    skills = []
  }
  return {
    id: r.id,
    name: r.name,
    personalityMd: r.personality_md ?? "",
    skills,
    policy: r.policy ?? null,
    backend: r.backend,
    model: r.model ?? null,
    effort: r.effort ?? null,
    // Legado (tabela SQLite) nunca teve estes campos — defaults honestos. A
    // migração pra arquivo grava o slug de fato como seed (avatarSeed "" cai
    // no fallback do defFieldsFrom/AgentAvatar).
    category: "Geral",
    rubric: [],
    avatarStyle: "thumbs",
    avatarSeed: "",
    digest: r.digest,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const PRESET_COLUMNS =
  "id, name, personality_md, skills_json, policy, backend, model, effort, digest, version, created_at, updated_at"

/** Legado: a leitura de agent_presets que alimenta a migração
 *  (store/presets.migrarLegado). Sem caminho de escrita. */
export async function listPresets(): Promise<AgentPreset[]> {
  const db = await getDb()
  if (!db) return []
  await ensureAgentPresetTables(db)
  const rows = await db.select<PresetRow[]>(
    `SELECT ${PRESET_COLUMNS} FROM agent_presets ORDER BY name COLLATE NOCASE ASC`,
  )
  return rows.map(toPreset)
}

// ---------------- Automações agendadas (schedules + schedule_runs) ----------------
// A implementação mora em lib/db/schedules.ts; a porta fica aqui porque os
// call sites e os mocks de teste (`vi.mock("@/lib/db")`) apontam para este
// módulo.
export type {
  ScheduleEdit,
  ScheduleKind,
  SchedulePermission,
  ScheduleRecord,
  ScheduleRunRecord,
} from "@/lib/db/schedules"
export {
  _resetScheduleTablesForTests,
  deleteSchedule,
  deleteSchedulesOfProject,
  insertSchedule,
  insertScheduleRun,
  listScheduleRuns,
  listSchedules,
  markScheduleCompleted,
  markScheduleRun,
  rescheduleSchedule,
  setScheduleEnabled,
  setScheduleNextRun,
  updateSchedule,
} from "@/lib/db/schedules"


// ---------------- Board de intenção (cards) ----------------
// O card é a unidade durável de intenção, ligada à conversa que a executa.
// Tabela do frontend (`ensureBoardTables`, cache de promessa que reseta em
// falha), sem migração no lib.rs.

export type CardState =
  | "backlog"
  | "working"
  | "review"
  | "blocked"
  | "done"
  | "cancelled"

/** Máquina de estados do card: backlog → working → review|blocked →
 *  done|cancelled. Regressões honestas são permitidas; `cancelled` vale de
 *  qualquer não-terminal. done/cancelled só entram por `closeCard` (gate
 *  humano). Exceção de sistema: apagar a conversa devolve o card ligado ao
 *  backlog por SQL direto, porque ali não há gesto de board. */
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
  /** Epoch ms de quando foi ARQUIVADO (sai do board, recuperável). null =
   *  ativo. Dimensão ORTOGONAL ao state — arquivar não muda o estado, só tira
   *  de vista. Apagar (deleteCard) é destrutivo e não passa por aqui. */
  archivedAt: number | null
}

let boardReady: Promise<void> | null = null

// exportada: lib/db/conversations.ts (deleteConversation) também precisa —
// um card ligado a uma conversa deletada não pode ficar apontando pro vazio.
export async function ensureBoardTables(db: Database): Promise<void> {
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
      // Arquivar (sai do board, recuperável): coluna ADITIVA idempotente,
      // mesmo padrão do addColumn das tabelas de aprendizado. Board não é
      // tabela núcleo (sem migração no lib.rs) — a evolução mora aqui.
      await addColumn(db, `ALTER TABLE cards ADD COLUMN archived_at INTEGER`)
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
  archived_at: number | null
}

const CARD_COLS =
  "id, project_id, title, body, state, assignee_agent, conversation_id, owner, pinned, pin_rank, created_at, updated_at, archived_at"

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
    archivedAt: r.archived_at,
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
    archivedAt: null,
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

/** Patch parcial (`undefined` mantém; limpar para NULL pede função própria).
 *  Estado não passa por aqui. `now` é o mesmo timestamp do patch local. */
export async function updateCard(
  id: string,
  patch: {
    title?: string
    body?: string
    pinned?: boolean
    pinRank?: number
  },
  now: number = Date.now(),
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
      now,
      id,
    ],
  )
}

/** Move o card validando a máquina; done/cancelled só via `closeCard`. Lança em
 *  transição inválida. `now` é o mesmo timestamp do patch local: um reload com
 *  updated_at diferente por ms o vigia leria como atividade. */
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

/** Arquiva/desarquiva o card (sai/volta do board, recuperável). Ortogonal ao
 *  state: NÃO valida a máquina — arquivar é sempre direito do humano, em
 *  qualquer estado. `now` = mesmo contrato de relógio único (F1). */
export async function setCardArchived(
  id: string,
  archivedAt: number | null,
  now: number = Date.now(),
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureBoardTables(db)
  await db.execute(
    "UPDATE cards SET archived_at = $1, updated_at = $2 WHERE id = $3",
    [archivedAt, now, id],
  )
}

/** Apaga o card de vez, só por gesto confirmado. A conversa ligada não é
 *  tocada: é entidade própria. */
export async function deleteCard(id: string): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureBoardTables(db)
  await db.execute("DELETE FROM cards WHERE id = $1", [id])
}

/** Custo por card = soma de turn_costs por conv_id (chat, disputas, fases de
 *  missão; stage_runs fica fora, não tem conv_id). `estimated` = sem
 *  proveniência 'reported'. `total: null` = tem turno e nenhum com preço
 *  (ADR-047). Erro propaga: o caller mantém o último valor. */
export async function listCardCosts(
  convIds: string[],
): Promise<Record<string, { total: number | null; estimated: boolean }>> {
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
    const out: Record<string, { total: number | null; estimated: boolean }> = {}
    for (const r of rows) {
      out[r.conv_id] = { total: r.total ?? null, estimated: r.est === 1 }
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
    await ensureComposerDraftTables(db)
    const rows = await db.select<{ id: string; updated_at: number }[]>(
      `SELECT c.id,
              max(c.updated_at, coalesce(d.updated_at, c.updated_at)) AS updated_at
         FROM conversations c
         LEFT JOIN conversation_drafts d ON d.conversation_id = c.id`,
    )
    return rows.map((r) => ({ id: r.id, updated_at: r.updated_at }))
  } catch {
    return null
  }
}
