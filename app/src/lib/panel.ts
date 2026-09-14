// Lógica do Painel (home): ordenação da fila "Precisam de você", janelas de
// custo (hoje/7d) e os agregadores do ledger. Tudo puro e testável, sem banco.

import type { Decision } from "@/lib/inbox"

/** Rank da fila: disputa (0) → card do board e proposta do lead (1). A
 *  disputa vem antes porque tem candidatos rodando/pagos esperando veredito;
 *  card e proposta esperam leitura. */
export function queueRank(d: Decision): number {
  return d.kind === "fusion" ? 0 : 1
}

/** Ordena a fila "Precisam de você" pelos ranks acima. ESTÁVEL dentro do mesmo
 *  rank (preserva a ordem de chegada do scan). */
export function orderQueue(decisions: Decision[]): Decision[] {
  return decisions
    .map((d, i) => ({ d, i, r: queueRank(d) }))
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
// Agregadores PUROS sobre o ledger unificado (turnos de chat + disputa +
// fases de missão em turn_costs; etapas do ex-SDD em stage_runs, histórico só
// de leitura desde a remoção da aba Features). O fetch mora em
// db.loadLedger; aqui só a matemática, testável sem banco.

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

/** ADR-047 — o pedaço do ledger que o app NÃO sabe precificar: linha com
 *  tokens e `costUsd` NULL (modelo fora da tabela de preço). Antes essas
 *  linhas nem existiam e o consumo sumia; agora elas existem, e todo total em
 *  US$ desta tela é uma soma PARCIAL enquanto isto for maior que zero. Quem
 *  mostra o total imprime a ressalva ao lado (mesma regra do denominador à
 *  vista do ADR-040) — somar zero no lugar do desconhecido seria a ficção que
 *  o ADR-040 condenou. */
export interface UnpricedSpend {
  /** turnos com consumo medido e preço desconhecido. */
  turns: number
  /** tokens desses turnos (o que ficou fora da conta em US$). */
  tokens: number
}

export function unpricedSpend(rows: LedgerRow[]): UnpricedSpend {
  let turns = 0
  let tokens = 0
  for (const r of rows) {
    if (r.costUsd != null) continue
    turns += 1
    tokens += r.tokens
  }
  return { turns, tokens }
}

export interface AgentSpend {
  agent: string
  costUsd: number
  tokens: number
  /** fração 0–1 do total (p/ a barra segmentada + ranking). */
  share: number
  /** turnos deste agent sem preço (ADR-047): `costUsd` conta só o resto. */
  unpricedTurns: number
}

/** Custo por agente (desc), com share do total. Agrupa por `agent`. */
export function costByAgent(rows: LedgerRow[]): AgentSpend[] {
  const by = new Map<
    string,
    { costUsd: number; tokens: number; unpricedTurns: number }
  >()
  let total = 0
  for (const r of rows) {
    const c = r.costUsd ?? 0
    total += c
    const cur = by.get(r.agent) ?? { costUsd: 0, tokens: 0, unpricedTurns: 0 }
    cur.costUsd += c
    cur.tokens += r.tokens
    if (r.costUsd == null) cur.unpricedTurns += 1
    by.set(r.agent, cur)
  }
  return [...by.entries()]
    .map(([agent, v]) => ({
      agent,
      costUsd: v.costUsd,
      tokens: v.tokens,
      share: total > 0 ? v.costUsd / total : 0,
      unpricedTurns: v.unpricedTurns,
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
