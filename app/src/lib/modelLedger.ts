// O LEDGER DE MODELOS: o que aconteceu com cada par (agent, slug), quem
// decidiu e por quê. Saiu do `lib/db.ts` quando o M3 (docs/model-autonomy-plan)
// dobrou o tamanho do assunto: é um domínio inteiro, com duas tabelas e uma
// leitura de conversas, e o db.ts já era o arquivo mais gordo da casa.
//
// Não abre banco novo: usa o `getDb()` do db.ts, que é a conexão única do app.

import type Database from "@tauri-apps/plugin-sql"
import { addColumn, getDb } from "@/lib/db"

// ---------------- Modelos: o LEDGER de decisões (model_proposals) ----------------
// Nasceu como fila de propostas do curador LLM (modelos novos do catálogo que
// ainda não estão nos pickers, esperando aprovação humana). Com o M3 do
// `model-autonomy-plan` a tabela virou o LEDGER de decisões sobre modelos: cada
// linha diz o que aconteceu com um par (agent, slug), QUEM decidiu e POR QUÊ.
// A tabela manteve o nome porque renomear tabela é migração sem ganho.
//
//   proposed  — pendente: falta alguma perna pra decidir (o motivo está em
//               `reason`). Não entra no picker.
//   active    — está no picker (merge em agentModels). Pode ter entrado pelo
//               gate humano OU sozinho pela regra das três pernas (`decidedBy`).
//   dismissed — VOCÊ mandou sumir. A rodada nunca ressuscita.
//   rejected  — a regra reprovou, com o motivo escrito. Fica visível em
//               Configurações ▸ Modelos: reprovado não é desaparecido.
//
// A APOSENTADORIA não é status daqui, e isso é deliberado: ela mora na tabela
// `model_retirements` justamente para NÃO poder mexer no picker. Um modelo em
// vias de aposentadoria continua funcionando, e tirá-lo do seletor por causa do
// aviso quebraria a conversa de quem está com ele escolhido.
//
// Mesmo padrão idempotente das tabelas de aprendizado (CREATE IF NOT EXISTS +
// addColumn, cache de promessa que RESETA em falha).

export type ModelProposalStatus =
  | "proposed"
  | "active"
  | "dismissed"
  | "rejected"

/** Quem carimbou a decisão: a REGRA (três pernas) ou o humano no gate. É o que
 *  a UI mostra como procedência ("entrou sozinho" × "você aprovou"). */
export type ModelDecidedBy = "app" | "human"

/** De onde o candidato NASCEU: da lista viva do próprio CLI ou do curador LLM
 *  em cima do catálogo. */
export type ModelProposalOrigin = "cli" | "curator"

export interface ModelProposal {
  id: string
  /** Agent dono do picker ("claude-code" | "codex"). */
  agent: string
  /** O que vai em `--model` (alias anthropic ou id openai). */
  value: string
  label: string
  description: string
  status: ModelProposalStatus
  origin: ModelProposalOrigin
  decidedBy: ModelDecidedBy
  /** A frase pt-BR do porquê deste status (procedência ou motivo da recusa). */
  reason: string
  /** A frase do PRÓPRIO CLI (evidência, não paráfrase): o detalhe da fumaça ou
   *  o texto de aposentadoria do fornecedor. */
  evidence: string | null
  /** Sucessor anunciado pelo fornecedor, quando a lista viva anuncia um. */
  successor: string | null
  createdAt: number
  /** Quando este status foi carimbado (0 = linha antiga, nunca redecidida). */
  decidedAt: number
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
      // M3: a linha passou a carregar procedência e motivo. Os defaults contam
      // a verdade das linhas ANTIGAS: elas nasceram do curador e, se estão
      // ativas, foi um humano que aprovou.
      await addColumn(
        db,
        "ALTER TABLE model_proposals ADD COLUMN origin TEXT NOT NULL DEFAULT 'curator'",
      )
      await addColumn(
        db,
        "ALTER TABLE model_proposals ADD COLUMN decided_by TEXT NOT NULL DEFAULT 'human'",
      )
      await addColumn(
        db,
        "ALTER TABLE model_proposals ADD COLUMN reason TEXT NOT NULL DEFAULT ''",
      )
      await addColumn(db, "ALTER TABLE model_proposals ADD COLUMN evidence TEXT")
      await addColumn(
        db,
        "ALTER TABLE model_proposals ADD COLUMN successor TEXT",
      )
      await addColumn(
        db,
        "ALTER TABLE model_proposals ADD COLUMN decided_at INTEGER NOT NULL DEFAULT 0",
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
  origin: string | null
  decided_by: string | null
  reason: string | null
  evidence: string | null
  successor: string | null
  created_at: number
  decided_at: number | null
}

function toProposalStatus(s: string): ModelProposalStatus {
  return s === "active" || s === "dismissed" || s === "rejected"
    ? s
    : "proposed"
}

const PROPOSAL_COLS =
  "id, agent, value, label, description, status, origin, decided_by, reason, evidence, successor, created_at, decided_at"

function toProposal(r: ModelProposalRow): ModelProposal {
  return {
    id: r.id,
    agent: r.agent,
    value: r.value,
    label: r.label,
    description: r.description,
    status: toProposalStatus(r.status),
    origin: r.origin === "cli" ? "cli" : "curator",
    decidedBy: r.decided_by === "app" ? "app" : "human",
    reason: r.reason ?? "",
    evidence: r.evidence,
    successor: r.successor,
    createdAt: r.created_at,
    decidedAt: r.decided_at ?? 0,
  }
}

/** O ledger de modelos (tudo, ou só de um status). [] em falha/não-Tauri. */
export async function listModelProposals(
  status?: ModelProposalStatus,
): Promise<ModelProposal[]> {
  const db = await getDb()
  if (!db) return []
  try {
    await ensureProposalTable(db)
    const rows = status
      ? await db.select<ModelProposalRow[]>(
          `SELECT ${PROPOSAL_COLS} FROM model_proposals WHERE status = $1 ORDER BY created_at ASC`,
          [status],
        )
      : await db.select<ModelProposalRow[]>(
          `SELECT ${PROPOSAL_COLS} FROM model_proposals ORDER BY created_at ASC`,
        )
    return rows.map(toProposal)
  } catch {
    return []
  }
}

/** Grava as propostas de UMA rodada do curador (status='proposed').
 *  `decided_by='app'` porque ninguém decidiu ainda: é a máquina dizendo "achei
 *  este candidato". Sem isso a linha nasceria travada como gesto humano e a
 *  rodada de promoção não poderia carimbar o veredito nela. */
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
      "INSERT INTO model_proposals (id, agent, value, label, description, status, origin, decided_by, reason, created_at, decided_at) VALUES ($1, $2, $3, $4, $5, 'proposed', 'curator', 'app', $6, $7, $7)",
      [
        crypto.randomUUID(),
        r.agent,
        r.value,
        r.label,
        r.description,
        "Achado no catálogo. Falta conferir com o CLI antes de entrar sozinho.",
        now,
      ],
    )
  }
}

/** Decisão do GATE HUMANO: Aprovar → 'active' · Dispensar → 'dismissed'.
 *  Carimba `decided_by='human'` (a procedência que a UI mostra) e o motivo em
 *  primeira pessoa. Devolve se gravou: gesto que não gravou não pode sumir da
 *  tela (ADR-017), então quem chama precisa saber. */
export async function setModelProposalStatus(
  id: string,
  status: ModelProposalStatus,
  reason?: string,
): Promise<boolean> {
  const db = await getDb()
  if (!db) return false
  try {
    await ensureProposalTable(db)
    await db.execute(
      "UPDATE model_proposals SET status = $1, decided_by = 'human', reason = $2, decided_at = $3 WHERE id = $4",
      [
        status,
        reason ??
          (status === "active"
            ? "Você aprovou este modelo no gate."
            : "Você dispensou este modelo."),
        Date.now(),
        id,
      ],
    )
    return true
  } catch (e) {
    console.warn("[modelos] falha ao gravar a decisão do gate", e)
    return false
  }
}

/** Uma decisão da RODADA (M3), por par (agent, value): insere ou atualiza a
 *  linha existente. Devolve `true` quando algo MUDOU de fato — linha nova ou
 *  status/motivo diferente. Decisão idêntica à que já estava gravada não
 *  reescreve nada, e é isso que impede o sino de reanunciar todo dia o mesmo
 *  modelo (a chave do aviso carrega o `decidedAt`).
 *
 *  NUNCA sobrescreve uma linha decidida por VOCÊ: aprovar e dispensar são
 *  gestos humanos, e a regra não desfaz gesto humano. */
export async function upsertModelDecision(row: {
  agent: string
  value: string
  label: string
  description: string
  status: ModelProposalStatus
  origin: ModelProposalOrigin
  reason: string
  evidence: string | null
  successor?: string | null
  now: number
}): Promise<boolean> {
  const db = await getDb()
  if (!db) return false
  try {
    await ensureProposalTable(db)
    const found = await db.select<ModelProposalRow[]>(
      `SELECT ${PROPOSAL_COLS} FROM model_proposals WHERE agent = $1 AND value = $2 LIMIT 1`,
      [row.agent, row.value],
    )
    const cur = found[0] ? toProposal(found[0]) : null
    if (cur) {
      if (cur.decidedBy === "human") return false
      if (cur.status === row.status && cur.reason === row.reason) return false
      await db.execute(
        "UPDATE model_proposals SET label = $1, description = $2, status = $3, origin = $4, decided_by = 'app', reason = $5, evidence = $6, successor = $7, decided_at = $8 WHERE id = $9",
        [
          row.label,
          row.description,
          row.status,
          row.origin,
          row.reason,
          row.evidence,
          row.successor ?? null,
          row.now,
          cur.id,
        ],
      )
      return true
    }
    await db.execute(
      "INSERT INTO model_proposals (id, agent, value, label, description, status, origin, decided_by, reason, evidence, successor, created_at, decided_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'app', $8, $9, $10, $11, $11)",
      [
        crypto.randomUUID(),
        row.agent,
        row.value,
        row.label,
        row.description,
        row.status,
        row.origin,
        row.reason,
        row.evidence,
        row.successor ?? null,
        row.now,
      ],
    )
    return true
  } catch (e) {
    // A rodada ESPERA resultado (ADR-017): sem gravação, nada foi promovido —
    // o chamador conta a verdade, não um "2 modelos novos" que não existe.
    console.warn("[modelos] falha ao gravar a decisão da rodada", e)
    return false
  }
}

// ---------------- Modelos: aposentadoria anunciada (model_retirements) ----------------
// O achado do M2 que o plano não previa: o CLI ANUNCIA a aposentadoria de um
// slug, com sucessor e com o texto do próprio fornecedor. Isto aqui é só a
// memória desse anúncio, para o aviso sobreviver ao fechar do app.
//
// POR QUE UMA TABELA SÓ DELA: aposentadoria NÃO pode virar status no ledger.
// Modelo em vias de aposentadoria continua funcionando; se o anúncio mexesse no
// status, o slug sairia do picker e quebraria a conversa de quem está com ele
// escolhido. Aqui ele só ganha uma frase.
//
// A linha vale enquanto o CLI anuncia: a rodada REESCREVE o conjunto do motor
// que respondeu. Motor que não respondeu não perde nada ("não sei" nunca apaga).

export interface ModelRetirement {
  agent: string
  value: string
  /** O sucessor que o FORNECEDOR indica. */
  successor: string
  /** O texto cru do fornecedor (evidência, não paráfrase). */
  vendorNote: string | null
  /** A frase pt-BR completa, com sucessor e onde você usa o modelo. */
  reason: string
  /** Quando ESTE texto foi visto pela 1ª vez (só muda quando o texto muda). */
  seenAt: number
}

let retirementsReady: Promise<void> | null = null

async function ensureRetirementTable(db: Database): Promise<void> {
  if (!retirementsReady) {
    const run = (async () => {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS model_retirements (
           agent TEXT NOT NULL,
           value TEXT NOT NULL,
           successor TEXT NOT NULL,
           vendor_note TEXT,
           reason TEXT NOT NULL,
           seen_at INTEGER NOT NULL,
           PRIMARY KEY (agent, value)
         )`,
      )
    })()
    retirementsReady = run.catch((e) => {
      retirementsReady = null
      throw e
    })
  }
  return retirementsReady
}

/** As aposentadorias anunciadas que o app já viu. [] em falha/não-Tauri. */
export async function listModelRetirements(): Promise<ModelRetirement[]> {
  const db = await getDb()
  if (!db) return []
  try {
    await ensureRetirementTable(db)
    const rows = await db.select<
      {
        agent: string
        value: string
        successor: string
        vendor_note: string | null
        reason: string
        seen_at: number
      }[]
    >(
      "SELECT agent, value, successor, vendor_note, reason, seen_at FROM model_retirements ORDER BY seen_at ASC",
    )
    return rows.map((r) => ({
      agent: r.agent,
      value: r.value,
      successor: r.successor,
      vendorNote: r.vendor_note,
      reason: r.reason,
      seenAt: r.seen_at,
    }))
  } catch {
    return []
  }
}

/** Substitui o conjunto de aposentadorias anunciadas de UM motor.
 *
 *  Só quem RESPONDEU chama isto: motor que não deu para consultar mantém o que
 *  já se sabia. `seen_at` só muda quando o TEXTO muda, senão o sino
 *  reanunciaria todo dia a mesma aposentadoria (a chave do aviso carrega o
 *  carimbo). Devolve os slugs cujo anúncio é NOVO ou mudou. */
export async function replaceModelRetirements(
  agent: string,
  rows: {
    value: string
    successor: string
    vendorNote: string | null
    reason: string
  }[],
  now: number,
): Promise<string[]> {
  const db = await getDb()
  if (!db) return []
  try {
    await ensureRetirementTable(db)
    const antigas = (await listModelRetirements()).filter(
      (r) => r.agent === agent,
    )
    const manter = new Set(rows.map((r) => r.value))
    for (const velha of antigas)
      if (!manter.has(velha.value))
        await db.execute(
          "DELETE FROM model_retirements WHERE agent = $1 AND value = $2",
          [agent, velha.value],
        )
    const novidades: string[] = []
    for (const r of rows) {
      const anterior = antigas.find((a) => a.value === r.value)
      if (anterior && anterior.reason === r.reason) continue
      novidades.push(r.value)
      await db.execute(
        `INSERT INTO model_retirements (agent, value, successor, vendor_note, reason, seen_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT(agent, value) DO UPDATE SET successor = excluded.successor, vendor_note = excluded.vendor_note, reason = excluded.reason, seen_at = excluded.seen_at`,
        [agent, r.value, r.successor, r.vendorNote, r.reason, now],
      )
    }
    return novidades
  } catch (e) {
    console.warn("[modelos] falha ao gravar a aposentadoria anunciada", e)
    return []
  }
}

/** Onde um modelo está ESCOLHIDO nas conversas (M3: o aviso de aposentadoria
 *  precisa dizer que VOCÊ usa o modelo que vai sair).
 *
 *  Lê o `req_model`, que é o que você PEDIU, não o `model`, que é o que o CLI
 *  resolveu: quem vai ter que trocar de escolha é o pedido. Conversa sem
 *  modelo explícito (sentinela "default") não conta como escolha de ninguém. */
export async function listConversationModelChoices(): Promise<
  { agent: string; model: string; title: string }[]
> {
  const db = await getDb()
  if (!db) return []
  try {
    const rows = await db.select<
      { agent: string | null; req_model: string | null; title: string | null }[]
    >(
      "SELECT agent, req_model, title FROM conversations WHERE req_model IS NOT NULL AND req_model != '' AND req_model != 'default'",
    )
    return rows
      .filter((r) => r.agent && r.req_model)
      .map((r) => ({
        agent: r.agent as string,
        model: r.req_model as string,
        title: r.title?.trim() || "conversa sem título",
      }))
  } catch (e) {
    console.warn("[modelos] falha ao ler as escolhas de modelo das conversas", e)
    return []
  }
}
