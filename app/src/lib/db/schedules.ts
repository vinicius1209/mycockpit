// F6 — automações agendadas (`schedules` + `schedule_runs`), extraído de
// lib/db.ts pela catraca de tamanho. Fatia coesa: tudo aqui gira em torno das
// duas tabelas; `lib/db.ts` re-exporta a porta pública, então os call sites e
// os mocks de teste (`vi.mock("@/lib/db")`) continuam apontando pro mesmo lugar.
//
// Mesmo padrão idempotente das tabelas de aprendizado: CREATE TABLE IF NOT
// EXISTS do frontend, cache de promessa que RESETA em falha (erro transitório
// não envenena o processo). A recorrência é um JSON string discriminado
// (lib/schedules.Recurrence); o DB não interpreta.

import type Database from "@tauri-apps/plugin-sql"
import { getDb } from "@/lib/db"
import { addColumn } from "@/lib/db/schema"
import {
  normalizeSchedulePermission,
  type SchedulePermission,
} from "@/lib/sessionMode"

/** Definido no eixo (lib/sessionMode), reexportado pela porta de sempre. */
export type { SchedulePermission }

/** Fluxo do disparo:
 *  - "agent"   → um prompt num agent de código, numa conversa nova (o F6 original);
 *  - "mission" → um PLANO DE VOO (missão multi-fase) na conversa nova: o loop
 *    agêntico completo, com handoff entre fases, teto de custo e worktree;
 *  - "lead"    → LEGADO (ADR-078): o produtor saiu, o leitor fica pra que a
 *    linha antiga possa ser desligada com a causa escrita.
 *  Valor estranho no banco degrada pra "agent". */
export type ScheduleKind = "agent" | "mission" | "lead"

export interface ScheduleRecord {
  id: string
  name: string
  projectId: string
  /** Fluxo do disparo. Valor estranho no banco degrada pra "agent". */
  kind: ScheduleKind
  agent: string
  /** Valor cru do picker ("default" = deixa o CLI escolher). */
  model: string | null
  /** Effort do raciocínio; null = default do agent (nenhuma flag). Só o fluxo
   *  "agent" usa — no Plano de voo o effort é POR FASE, e mora no preset. */
  effort: string | null
  prompt: string
  permission: SchedulePermission
  /** Plano de voo do fluxo "mission" (`settings.missionPresets[].id`). null nos
   *  demais fluxos. Plano apagado depois de agendado NÃO vira prompt solto: o
   *  disparo falha com a causa escrita (ver lib/scheduleMission). */
  planId: string | null
  /** JSON discriminado (lib/schedules.parseRecurrence valida na leitura). */
  recurrence: string
  enabled: boolean
  nextRun: number | null
  lastRunAt: number | null
  lastRunStatus: string | null
  /** Quando a automação SE ENCERROU (só a recorrência "uma vez" chega aqui):
   *  ela fica na lista, desabilitada e marcada como concluída, com "Reagendar".
   *  null = nunca encerrou. Distingue "concluída" de "pausada pelo usuário". */
  completedAt: number | null
  createdAt: number
}

export interface ScheduleRunRecord {
  id: string
  scheduleId: string
  startedAt: number
  /** "ok" | "failed" | "blocked" (v1 não tem retry automático — falha fica
   *  falha; "blocked" é o preflight de capability que nem chegou a gastar). */
  status: string
  cost: number | null
  convId: string | null
  /** O MOTIVO real da falha, uma linha, colhido do turno (nunca inventado).
   *  null = deu certo, ou o desfecho veio mudo. Sem isto a lista dizia só
   *  "falhou" e o usuário tinha que abrir a conversa pra descobrir o quê. */
  error: string | null
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
      // S4.3 — tipo do schedule (agent × lead). Tabela nasce do frontend, então
      // coluna nova entra via addColumn (idempotente, padrão lessons.scope).
      await addColumn(
        db,
        `ALTER TABLE schedules ADD COLUMN kind TEXT NOT NULL DEFAULT 'agent'`,
      )
      // Recorrência "uma vez": marca de encerramento. Mesma via do `kind`
      // (addColumn idempotente) — a tabela nasce do frontend, então NADA de
      // migration no lib.rs (v25/v26 seguem reservadas pros presets).
      await addColumn(db, `ALTER TABLE schedules ADD COLUMN completed_at INTEGER`)
      // ADR-158 — o esforço do modelo e o Plano de voo. Mesma via: colunas
      // NULL, sem default, porque "não escolhido" e "escolhido como default"
      // são a mesma coisa aqui (o motor não manda flag nenhuma).
      await addColumn(db, `ALTER TABLE schedules ADD COLUMN effort TEXT`)
      await addColumn(db, `ALTER TABLE schedules ADD COLUMN plan_id TEXT`)
      // O motivo da falha vive na LINHA da execução, não no schedule: cada
      // disparo falha pelo seu próprio motivo, e o histórico é o que se lê.
      await addColumn(db, `ALTER TABLE schedule_runs ADD COLUMN error TEXT`)
    })()
    schedulesReady = run.catch((e) => {
      schedulesReady = null
      throw e
    })
  }
  return schedulesReady
}

/** (testes) força o próximo ensure a rodar de novo. */
export function _resetScheduleTablesForTests(): void {
  schedulesReady = null
}

interface ScheduleRow {
  id: string
  name: string
  project_id: string
  kind: string
  agent: string
  model: string | null
  effort: string | null
  prompt: string
  permission: string
  plan_id: string | null
  recurrence: string
  enabled: number
  next_run: number | null
  last_run_at: number | null
  last_run_status: string | null
  completed_at: number | null
  created_at: number
}

/** Clamp de leitura do fluxo: só os três conhecidos passam; o resto degrada
 *  pra "agent" (o fluxo original, e o único que não depende de nada externo). */
function toKind(raw: string): ScheduleKind {
  return raw === "lead" || raw === "mission" ? raw : "agent"
}

function toSchedule(r: ScheduleRow): ScheduleRecord {
  return {
    id: r.id,
    name: r.name,
    projectId: r.project_id,
    kind: toKind(r.kind),
    agent: r.agent,
    model: r.model,
    effort: r.effort,
    prompt: r.prompt,
    // clamp de leitura ÚNICO (lib/sessionMode): 'liberado' gravado à mão no
    // SQLite, ou qualquer valor estranho, degrada pra 'leitura'.
    permission: normalizeSchedulePermission(r.permission),
    planId: r.plan_id,
    recurrence: r.recurrence,
    enabled: r.enabled === 1,
    nextRun: r.next_run,
    lastRunAt: r.last_run_at,
    lastRunStatus: r.last_run_status,
    completedAt: r.completed_at,
    createdAt: r.created_at,
  }
}

const SCHEDULE_COLS =
  "id, name, project_id, kind, agent, model, effort, prompt, permission, plan_id, recurrence, enabled, next_run, last_run_at, last_run_status, completed_at, created_at"

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
    "INSERT INTO schedules (id, name, project_id, kind, agent, model, effort, prompt, permission, plan_id, recurrence, enabled, next_run, last_run_at, last_run_status, completed_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)",
    [
      s.id,
      s.name,
      s.projectId,
      s.kind,
      s.agent,
      s.model,
      s.effort,
      s.prompt,
      s.permission,
      s.planId,
      s.recurrence,
      s.enabled ? 1 : 0,
      s.nextRun,
      s.lastRunAt,
      s.lastRunStatus,
      s.completedAt,
      s.createdAt,
    ],
  )
}

/** Campos EDITÁVEIS de uma automação já criada. O que fica de fora é
 *  deliberado: `id`/`createdAt` são identidade, e o histórico (`lastRun*`,
 *  `completedAt`) é fato consumado — reescrever passado é o teatro que o §
 *  "estado real" proíbe. O `nextRun` vem calculado pelo store a partir da
 *  recorrência nova, nunca digitado. */
export interface ScheduleEdit {
  name: string
  projectId: string
  kind: ScheduleKind
  agent: string
  model: string | null
  effort: string | null
  prompt: string
  permission: SchedulePermission
  planId: string | null
  recurrence: string
  nextRun: number | null
}

/** Edita uma automação existente. Gesto humano explícito, então a falha SOBE
 *  (a view mostra o erro em vez de fingir que salvou) — mesma régua do
 *  `rescheduleSchedule`. Editar LIMPA a marca de concluída: mudar o que a
 *  automação faz e reagendá-la é justamente o caminho de dar vida nova a uma
 *  "uma vez" que já rodou. */
export async function updateSchedule(
  id: string,
  e: ScheduleEdit,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureScheduleTables(db)
  await db.execute(
    "UPDATE schedules SET name = $1, project_id = $2, kind = $3, agent = $4, model = $5, effort = $6, prompt = $7, permission = $8, plan_id = $9, recurrence = $10, next_run = $11, completed_at = NULL WHERE id = $12",
    [
      e.name,
      e.projectId,
      e.kind,
      e.agent,
      e.model,
      e.effort,
      e.prompt,
      e.permission,
      e.planId,
      e.recurrence,
      e.nextRun,
      id,
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

/** ENCERRA a automação de uma vez: desabilita, zera o next_run e carimba a
 *  marca de concluída. Não apaga nada — o registro fica na lista com o
 *  histórico do que rodou (apagar não deixaria rastro nem do disparo nem da
 *  conversa que ele produziu). Best-effort com aviso no console: o motor não
 *  pode cair aqui, mas uma falha silenciosa deixaria a automação re-disparável. */
export async function markScheduleCompleted(
  id: string,
  completedAt: number,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    await ensureScheduleTables(db)
    await db.execute(
      "UPDATE schedules SET enabled = 0, next_run = NULL, completed_at = $1 WHERE id = $2",
      [completedAt, id],
    )
  } catch (e) {
    console.warn("[schedules] markScheduleCompleted falhou", e)
  }
}

/** Reagenda uma automação: nova recorrência + next_run, religa e LIMPA a marca
 *  de concluída. É o botão "Reagendar" da lista — gesto humano explícito, então
 *  a falha SOBE (a view mostra o erro em vez de fingir que salvou). */
export async function rescheduleSchedule(
  id: string,
  recurrence: string,
  nextRun: number,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureScheduleTables(db)
  await db.execute(
    "UPDATE schedules SET recurrence = $1, next_run = $2, enabled = 1, completed_at = NULL WHERE id = $3",
    [recurrence, nextRun, id],
  )
}

/** Apaga as automações DE UM PROJETO (e o histórico delas) — o projeto sumiu,
 *  a automação seguiria disparando fantasma. As linhas de `schedule_runs` vão
 *  junto: antes ficavam órfãs de um schedule_id que não existe mais, lixo
 *  invisível que nada nunca mais leria nem limparia. */
export async function deleteSchedulesOfProject(projectId: string): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureScheduleTables(db)
  await db.execute(
    "DELETE FROM schedule_runs WHERE schedule_id IN (SELECT id FROM schedules WHERE project_id = $1)",
    [projectId],
  )
  await db.execute("DELETE FROM schedules WHERE project_id = $1", [projectId])
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
      "INSERT INTO schedule_runs (id, schedule_id, started_at, status, cost, conv_id, error) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [r.id, r.scheduleId, r.startedAt, r.status, r.cost, r.convId, r.error],
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
        error: string | null
      }[]
    >(
      "SELECT id, schedule_id, started_at, status, cost, conv_id, error FROM schedule_runs ORDER BY started_at DESC LIMIT $1",
      [limit],
    )
    return rows.map((r) => ({
      id: r.id,
      scheduleId: r.schedule_id,
      startedAt: r.started_at,
      status: r.status,
      cost: r.cost,
      convId: r.conv_id,
      error: r.error,
    }))
  } catch {
    return []
  }
}
