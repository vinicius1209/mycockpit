// Lógica do Painel (home): parse do `gh pr view`, elegibilidade de Merge,
// ordenação da fila "Precisam de você" e janelas de custo (hoje/7d).
// Tudo puro e testável, exceto os dois wrappers de invoke no fim — que são
// fail-soft e têm cache module-level de 60s (o enriquecimento é lazy por card
// e NUNCA pode martelar o `gh` a cada render/ciclo).

import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"
import type { Decision } from "@/lib/inbox"

/** Estado rico de um PR, já digerido do JSON cru do `gh pr view`. */
export interface PrEnrichment {
  state: string
  title: string
  additions: number
  deletions: number
  /** "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | "" (ausente). */
  mergeable: string
  /** "" | "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED". */
  reviewDecision: string
  isDraft: boolean
  /** updatedAt em epoch ms (null = ausente/não-parseável). */
  updatedAt: number | null
  checksTotal: number
  checksPassed: number
  checksFailed: number
}

/** Conta o statusCheckRollup do gh. Cada item é CheckRun (`conclusion`) ou
 *  StatusContext (`state`): SUCCESS conta como passado; FAILURE/ERROR como
 *  falha; o resto (PENDING, SKIPPED, null…) só entra no total. */
export function countChecks(rollup: unknown): {
  total: number
  passed: number
  failed: number
} {
  if (!Array.isArray(rollup)) return { total: 0, passed: 0, failed: 0 }
  let passed = 0
  let failed = 0
  for (const c of rollup) {
    const item = (c ?? {}) as Record<string, unknown>
    const v = String(item.conclusion ?? item.state ?? "").toUpperCase()
    if (v === "SUCCESS") passed++
    else if (v === "FAILURE" || v === "ERROR") failed++
  }
  return { total: rollup.length, passed, failed }
}

/** JSON cru do gh_pr_view → PrEnrichment. null = shape inesperado (degrade:
 *  o card fica sem a 2ª linha). Campos individuais faltando têm default. */
export function parsePrView(json: unknown): PrEnrichment | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null
  const j = json as Record<string, unknown>
  const checks = countChecks(j.statusCheckRollup)
  const ts = typeof j.updatedAt === "string" ? Date.parse(j.updatedAt) : NaN
  return {
    state: typeof j.state === "string" ? j.state : "",
    title: typeof j.title === "string" ? j.title : "",
    additions: typeof j.additions === "number" ? j.additions : 0,
    deletions: typeof j.deletions === "number" ? j.deletions : 0,
    mergeable: typeof j.mergeable === "string" ? j.mergeable : "",
    reviewDecision:
      typeof j.reviewDecision === "string" ? j.reviewDecision : "",
    isDraft: j.isDraft === true,
    updatedAt: Number.isFinite(ts) ? ts : null,
    checksTotal: checks.total,
    checksPassed: checks.passed,
    checksFailed: checks.failed,
  }
}

/** Merge liberado SÓ com tudo verde: todos os checks SUCCESS (0 checks conta
 *  como verde — o GitHub ainda barra se a branch exigir), mergeable, sem
 *  CHANGES_REQUESTED e fora de draft. Sem enriquecimento = sem Merge. */
export function mergeEligible(e: PrEnrichment | null | undefined): boolean {
  if (!e) return false
  return (
    e.checksFailed === 0 &&
    e.checksPassed === e.checksTotal &&
    e.mergeable === "MERGEABLE" &&
    e.reviewDecision !== "CHANGES_REQUESTED" &&
    !e.isDraft
  )
}

/** Saúde do PR pro card e pra ordenação: verde (todos os checks passaram),
 *  falhando (algum FAILURE/ERROR) ou desconhecida (sem dado / checks rodando). */
export type PrHealth = "green" | "failing" | "unknown"

export function prHealth(e: PrEnrichment | null | undefined): PrHealth {
  if (!e) return "unknown"
  if (e.checksFailed > 0) return "failing"
  if (e.checksPassed === e.checksTotal) return "green"
  return "unknown"
}

/** PR já resolvida no GitHub (mergeada/fechada) — o manifest SDD local pode
 *  estar desatualizado (merge feito fora do app), então o `state` real do
 *  gh_pr_view é quem tira o card da fila (auto-cura da exibição). */
export function prResolved(e: PrEnrichment | null | undefined): boolean {
  return e != null && (e.state === "MERGED" || e.state === "CLOSED")
}

/** Rank da fila: PR checks-verdes (0) → disputa (1) → PRD e card do board (2)
 *  → PR sem dado / checks rodando (3) → PR com checks falhando por último (4). */
export function queueRank(
  d: Decision,
  e: PrEnrichment | null | undefined,
): number {
  if (d.kind === "pr") {
    const h = prHealth(e)
    return h === "green" ? 0 : h === "failing" ? 4 : 3
  }
  return d.kind === "fusion" ? 1 : 2
}

/** Ordena a fila "Precisam de você" pelos ranks acima. ESTÁVEL dentro do mesmo
 *  rank (preserva a ordem de chegada do scan). */
export function orderQueue(
  decisions: Decision[],
  byUrl: Record<string, PrEnrichment | null>,
): Decision[] {
  return decisions
    .map((d, i) => ({
      d,
      i,
      r: queueRank(d, d.kind === "pr" ? byUrl[d.prUrl] : null),
    }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.d)
}

/** Soma de custo por janela: `today` desde a meia-noite LOCAL, `week` nos
 *  últimos 7 dias corridos. Entregas com timestamp futuro ficam de fora. */
export function costWindows(
  deliveries: { costUsd: number | null; createdAt: number }[],
  now = Date.now(),
): { today: number; week: number } {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const startToday = midnight.getTime()
  const start7d = now - 7 * 24 * 60 * 60 * 1000
  let today = 0
  let week = 0
  for (const d of deliveries) {
    if (d.createdAt > now) continue
    const c = d.costUsd ?? 0
    if (d.createdAt >= start7d) week += c
    if (d.createdAt >= startToday) today += c
  }
  return { today, week }
}

// ───────────────── Ledger de custo (Painel "Instrumento") ─────────────────
// Agregadores PUROS sobre o ledger unificado (turnos de chat + entregas). O
// fetch mora em db.loadLedger; aqui só a matemática, testável sem banco.

export interface LedgerRow {
  agent: string
  projectId: string
  costUsd: number | null
  tokens: number
  createdAt: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Recorta o ledger por janela (auditoria): 'today' (meia-noite local), '7d',
 *  '30d'. Ignora timestamps futuros. */
export function windowRows(
  rows: LedgerRow[],
  win: "today" | "7d" | "30d",
  now = Date.now(),
): LedgerRow[] {
  let start: number
  if (win === "today") {
    const m = new Date(now)
    m.setHours(0, 0, 0, 0)
    start = m.getTime()
  } else {
    start = now - (win === "7d" ? 7 : 30) * DAY_MS
  }
  return rows.filter((r) => r.createdAt >= start && r.createdAt <= now)
}

/** Janelas hoje (meia-noite local) / 7d / 30d corridos, ignorando futuro. */
export function ledgerWindows(
  rows: LedgerRow[],
  now = Date.now(),
): { today: number; week: number; month: number } {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const startToday = midnight.getTime()
  const start7d = now - 7 * DAY_MS
  const start30d = now - 30 * DAY_MS
  let today = 0
  let week = 0
  let month = 0
  for (const r of rows) {
    if (r.createdAt > now) continue
    const c = r.costUsd ?? 0
    if (r.createdAt >= start30d) month += c
    if (r.createdAt >= start7d) week += c
    if (r.createdAt >= startToday) today += c
  }
  return { today, week, month }
}

export interface AgentSpend {
  agent: string
  costUsd: number
  tokens: number
  /** fração 0–1 do total (p/ a barra segmentada + ranking). */
  share: number
}

/** Custo por agente (desc), com share do total. Agrupa por `agent`. */
export function costByAgent(rows: LedgerRow[]): AgentSpend[] {
  const by = new Map<string, { costUsd: number; tokens: number }>()
  let total = 0
  for (const r of rows) {
    const c = r.costUsd ?? 0
    total += c
    const cur = by.get(r.agent) ?? { costUsd: 0, tokens: 0 }
    cur.costUsd += c
    cur.tokens += r.tokens
    by.set(r.agent, cur)
  }
  return [...by.entries()]
    .map(([agent, v]) => ({
      agent,
      costUsd: v.costUsd,
      tokens: v.tokens,
      share: total > 0 ? v.costUsd / total : 0,
    }))
    .sort((a, b) => b.costUsd - a.costUsd)
}

export interface ProjectSpend {
  projectId: string
  costUsd: number
  share: number
}

/** Custo por projeto (desc), com share do total — o breakdown "por projeto" da
 *  auditoria. Agrupa por projectId. */
export function costByProject(rows: LedgerRow[]): ProjectSpend[] {
  const by = new Map<string, number>()
  let total = 0
  for (const r of rows) {
    const c = r.costUsd ?? 0
    total += c
    by.set(r.projectId, (by.get(r.projectId) ?? 0) + c)
  }
  return [...by.entries()]
    .map(([projectId, costUsd]) => ({
      projectId,
      costUsd,
      share: total > 0 ? costUsd / total : 0,
    }))
    .sort((a, b) => b.costUsd - a.costUsd)
}

/** Série de gasto por dia (do mais antigo → hoje), `days` posições, p/ o
 *  sparkline. Cada bucket é um dia LOCAL; o último é hoje. */
export function dailySpend(
  rows: LedgerRow[],
  days: number,
  now = Date.now(),
): number[] {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const startToday = midnight.getTime()
  const out = new Array(days).fill(0)
  for (const r of rows) {
    if (r.createdAt > now) continue
    // dias-atrás pela MEIA-NOITE LOCAL da entrada (senão hoje 12:00 daria índice
    // negativo); round absorve a folga de DST.
    const em = new Date(r.createdAt)
    em.setHours(0, 0, 0, 0)
    const dayIdx = Math.round((startToday - em.getTime()) / DAY_MS)
    if (dayIdx < 0 || dayIdx >= days) continue
    out[days - 1 - dayIdx] += r.costUsd ?? 0
  }
  return out
}

/** Total de tokens no ledger (readout "Tokens"). */
export function ledgerTokens(rows: LedgerRow[]): number {
  let t = 0
  for (const r of rows) t += r.tokens
  return t
}

// ─── Enriquecimento via gh (lazy, cache 60s, fail-soft) ─────────────────────

const PR_CACHE_TTL_MS = 60_000
const prCache = new Map<string, { at: number; data: PrEnrichment | null }>()

/** Hit síncrono do cache (pro estado inicial do card, sem flash). */
export function cachedPrEnrichment(url: string): PrEnrichment | null {
  const hit = prCache.get(url)
  return hit && Date.now() - hit.at < PR_CACHE_TTL_MS ? hit.data : null
}

/** Busca o estado rico do PR (comando Rust gh_pr_view). Cache module-level de
 *  60s por URL — inclusive de FALHA (null), pra não re-tentar a cada ciclo.
 *  Qualquer erro → null: o card degrada pra versão sem 2ª linha. */
export async function fetchPrEnrichment(
  url: string,
): Promise<PrEnrichment | null> {
  const hit = prCache.get(url)
  if (hit && Date.now() - hit.at < PR_CACHE_TTL_MS) return hit.data
  let data: PrEnrichment | null = null
  if (isTauri()) {
    try {
      data = parsePrView(await invoke("gh_pr_view", { url }))
    } catch {
      data = null
    }
  }
  prCache.set(url, { at: Date.now(), data })
  return data
}

/** Merge via Rust (squash). Sucesso devolve o stdout do gh; falha REJEITA com
 *  a mensagem do GitHub — o chamador mostra no toast. Invalida o cache do PR
 *  (o estado mudou de verdade). */
export async function mergePr(url: string): Promise<string> {
  const out = await invoke<string>("gh_pr_merge", { url })
  prCache.delete(url)
  return out
}
