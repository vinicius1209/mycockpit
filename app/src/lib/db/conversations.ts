// CRUD de conversas — extraído de lib/db.ts pela catraca de tamanho (o
// arquivo passou do teto congelado). Fatia coesa: tudo aqui gira em torno da
// tabela `conversations`; o resto (projetos, fusion, mission, deliveries,
// ledger, presets, cards...) fica em db.ts.

import { getDb, ensureBoardTables } from "@/lib/db"
import { ensureComposerDraftTables, ensureConversationHierarchySchema } from "@/lib/db/schema"
import type { ChatItem } from "@/store/chat"
import type { ContextBasis } from "@/lib/contextSnapshot"
import type { SessoesAnteriores } from "@/lib/retomadaDeMotor"
import { loadConversationItemSnapshot } from "@/lib/db/conversationItems"

/** S1.2 — persiste a ordem manual das conversas DE UM projeto. O filtro por
 *  project_id impede que um id vazado de outra lista mexa em conversa alheia. */
export async function persistConversationOrder(
  projectId: string,
  ids: string[],
): Promise<void> {
  const db = await getDb()
  if (!db) return
  for (let i = 0; i < ids.length; i++) {
    await db.execute(
      "UPDATE conversations SET sort_order = $1 WHERE id = $2 AND project_id = $3",
      [i, ids[i], projectId],
    )
  }
}

export interface ConversationMeta {
  id: string
  title: string | null
  updatedAt: number
  color: string | null
  worktreePath: string | null
  /** Agent persistido da conversa (null = nunca rodou/persistiu — livre).
   *  Permite achar "a conversa da mesa" de cada agent (ensureDeskConversation,
   *  lib/fleet/send — o Companion usa) sem carregar cada linha. */
  agent: string | null
  /** Id da conversa de origem quando esta conversa é um fork/duplicata (null se raiz). */
  parentId?: string | null
  /** Há texto ou anexo não enviado, sem carregar o histórico inteiro. */
  hasDraft?: boolean
}

interface ConvListRow {
  id: string
  title: string | null
  updated_at: number
  color: string | null
  worktree_path: string | null
  agent: string | null
  parent_id: string | null
  has_draft: number
}

/** Lista as conversas de um projeto na ordem MANUAL (S1.2; fallback: criação,
 *  novas embaixo — linha sem sort_order cai no fim, onde o padrão a colocaria). */
export async function listConversations(
  projectId: string,
): Promise<ConversationMeta[] | null> {
  const db = await getDb()
  if (!db) return null
  await ensureComposerDraftTables(db)
  await ensureConversationHierarchySchema(db)
  const rows = await db.select<ConvListRow[]>(
    `SELECT c.id, c.title, c.updated_at, c.color, c.worktree_path, c.agent, c.parent_id,
            EXISTS(SELECT 1 FROM conversation_drafts d WHERE d.conversation_id = c.id) AS has_draft
       FROM conversations c
      WHERE c.project_id = $1
      ORDER BY (c.sort_order IS NULL), c.sort_order ASC, c.created_at ASC`,
    [projectId],
  )
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updated_at,
    color: r.color ?? null,
    worktreePath: r.worktree_path ?? null,
    agent: r.agent ?? null,
    parentId: r.parent_id ?? null,
    hasDraft: r.has_draft === 1,
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

/** Define/limpa a conversa pai de um fork/duplicata (NULL = raiz/independente). */
export async function setConversationParent(
  id: string,
  parentId: string | null,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await db.execute("UPDATE conversations SET parent_id = $1 WHERE id = $2", [
    parentId,
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
  /** Preset (persona) que iniciou a conversa + o digest da versão exata dele
   *  no 1º run (S3.2, padrão role_ref+role_digest do MyPeople). */
  preset_id: string | null
  preset_digest: string | null
  context_tokens: number | null // ContextRing; NULL = nunca rodou turno aqui
  context_window: number | null
  /** NULL = legado/sem medição confiável. */
  context_basis: string | null
  /** Modo desta conversa. NULL = herda o do projeto (≠ "sem modo"). */
  session_mode: string | null
  /** JSON das sessões que cada motor deixou nesta conversa (revezamento R5).
   *  NULL = nenhuma, ou linha anterior à migração 51. */
  sessoes_anteriores: string | null
}

/** Sessões guardadas por motor (revezamento R5). JSON quebrado vira `undefined`:
 *  perder a chance de retomar é degradação; derrubar a conversa não é. */
function lerSessoesAnteriores(bruto: string | null): SessoesAnteriores | undefined {
  if (!bruto) return undefined
  try {
    const lido = JSON.parse(bruto) as SessoesAnteriores
    return lido && typeof lido === "object" ? lido : undefined
  } catch {
    return undefined
  }
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
  presetId: string | null
  presetDigest: string | null
  contextTokens: number | null
  contextWindow: number | null
  contextBasis: ContextBasis | null
  /** `null` = herda o modo do projeto. */
  sessionMode: string | null
  /** Sessões que cada motor deixou aqui (revezamento R5). */
  sessoesAnteriores?: SessoesAnteriores
} | null | "corrupt"> {
  const db = await getDb()
  if (!db) return null
  const rows = await db.select<ConvLoadRow[]>(
    "SELECT session_id, items, title, suggestions, agent, req_model, effort, model, worktree_path, preset_id, preset_digest, context_tokens, context_window, context_basis, session_mode, sessoes_anteriores FROM conversations WHERE id = $1",
    [id],
  )
  if (!rows.length) return null
  try {
    const incrementalItems = await loadConversationItemSnapshot(id)
    return {
      sessionId: rows[0].session_id,
      // A fonte nova é realmente preferencial: um snapshot legado danificado
      // não invalida uma revisão incremental que já fechou contagem e ids.
      items:
        incrementalItems ?? (JSON.parse(rows[0].items) as ChatItem[]),
      title: rows[0].title,
      suggestions: rows[0].suggestions
        ? (JSON.parse(rows[0].suggestions) as string[])
        : [],
      agent: rows[0].agent ?? "claude-code",
      reqModel: rows[0].req_model,
      effort: rows[0].effort,
      model: rows[0].model,
      worktreePath: rows[0].worktree_path,
      presetId: rows[0].preset_id ?? null,
      presetDigest: rows[0].preset_digest ?? null,
      contextTokens: rows[0].context_tokens,
      contextWindow: rows[0].context_window,
      contextBasis:
        rows[0].context_basis === "last_call" ||
        rows[0].context_basis === "unavailable"
          ? rows[0].context_basis
          : null,
      sessionMode: rows[0].session_mode,
      // Sessões guardadas: JSON quebrado não derruba a conversa (fail-open no
      // render), só some com a chance de retomar.
      sessoesAnteriores: lerSessoesAnteriores(rows[0].sessoes_anteriores),
    }
  } catch {
    return "corrupt"
  }
}

/** Cria uma conversa vazia. O `id` é gerado pelo chamador (crypto.randomUUID).
 *  Preset NÃO entra aqui: a marcação/carimbo é sempre via setConversationPreset
 *  (seleção no composer e 1º run). */
export async function createConversation(
  projectId: string,
  id: string,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  const now = Date.now()
  // sort_order = MAX+1 do projeto: conversa nova entra no FIM da lista (mesmo
  // lugar do padrão created_at ASC), respeitando a ordem manual (S1.2).
  await db.execute(
    "INSERT INTO conversations (id, project_id, title, session_id, items, created_at, updated_at, sort_order) VALUES ($1, $2, NULL, NULL, '[]', $3, $3, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM conversations WHERE project_id = $2))",
    [id, projectId, now],
  )
}

/** Marca/carimba (ou limpa, com nulls) o preset de uma conversa. UPDATE
 *  pontual, padrão setConversationColor — o persist (UPSERT) NÃO toca nessas
 *  colunas, então o carimbo sobrevive aos saves de linha inteira. */
export async function setConversationPreset(
  id: string,
  presetId: string | null,
  presetDigest: string | null,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await db.execute(
    "UPDATE conversations SET preset_id = $1, preset_digest = $2 WHERE id = $3",
    [presetId, presetDigest, id],
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
  contextTokens: number | null,
  contextWindow: number | null,
  contextBasis: ContextBasis | null,
  /** `null` = herda o projeto. Ver a migração 37. */
  sessionMode: string | null,
  /** JSON de `SessoesAnteriores` (revezamento R5), ou `null`. */
  sessoesAnteriores: string | null,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  // sort_order só no INSERT (linha nova, ex.: duplicar conversa → entra no fim
  // da lista do projeto); o ON CONFLICT não toca nela — a ordem manual (S1.2)
  // sobrevive aos saves de linha inteira, igual color/worktree/preset.
  await db.execute(
    "INSERT INTO conversations (id, project_id, title, session_id, items, suggestions, agent, req_model, effort, model, context_tokens, context_window, context_basis, session_mode, sessoes_anteriores, created_at, updated_at, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM conversations WHERE project_id = $2)) ON CONFLICT(id) DO UPDATE SET title = excluded.title, session_id = excluded.session_id, items = excluded.items, suggestions = excluded.suggestions, agent = excluded.agent, req_model = excluded.req_model, effort = excluded.effort, model = excluded.model, context_tokens = excluded.context_tokens, context_window = excluded.context_window, context_basis = excluded.context_basis, session_mode = excluded.session_mode, sessoes_anteriores = excluded.sessoes_anteriores, updated_at = excluded.updated_at",
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
      contextTokens,
      contextWindow,
      contextBasis,
      sessionMode,
      sessoesAnteriores,
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
