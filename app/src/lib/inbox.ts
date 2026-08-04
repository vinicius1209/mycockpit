// Inbox de decisões: TUDO que espera o humano, num lugar só. O trabalho do
// piloto num cockpit multi-agent não é ler chats, é DECIDIR: disputa esperando
// veredito (fusion_runs pendentes no DB), PRD esperando aprovação e PR aberto
// (manifests do SDD no disco). Varredura barata (SQL + fs), sob demanda.

import {
  adoptSddPlan,
  listOpenProposals,
  listPendingDecisions,
  listSddPlanMarks,
  type CardRecord,
  type LeadProposalRecord,
  type SddPlanMark,
} from "@/lib/db"
import { loadSddPlans } from "@/lib/sdd"
import type { Project } from "@/lib/types"

/** Procedência de um gate do SDD: DE ONDE ele veio e o que já aconteceu com ele
 *  NO APP. Existe porque "o app achou isso no seu disco" e "isso está te
 *  esperando" são coisas diferentes: o badge do sino é sinal de AGORA, e um
 *  plano criado no terminal em maio não é agora. */
export interface DecisionOrigin {
  /** Onde o gate mora, relativo ao projeto: ".claude/plans/<slug>". Só LEITURA:
   *  o app nunca escreve nada nessa pasta. */
  path: string
  /** true = o app só DESCOBRIU no disco (nenhum gesto seu por aqui) → fica na
   *  seção "Encontrados no projeto" e NÃO conta no badge. Vira false no
   *  instante em que você encosta no plano pelo app (adoção persistida). */
  discovered: boolean
  /** true = você mandou o plano sumir da lista (reversível pelos "ignorados").
   *  Só vem preenchido quando a varredura pede `includeIgnored`. */
  ignored: boolean
}

export type Decision =
  | {
      kind: "fusion"
      convId: string
      projectId: string
      projectName: string
      title: string
    }
  | {
      kind: "card"
      cardId: string
      projectId: string
      projectName: string
      title: string
      /** Só review/blocked entram na fila (esperando humano). */
      state: "review" | "blocked"
      /** (S2.3) início do silêncio quando o vigia marcou o card como
       *  estagnado (transient do store, some com atividade). A fila usa pra
       *  destacar "parado há X min" — ausente = card na fila, mas não mudo. */
      stalledSince?: number
    }
  | {
      kind: "prd"
      projectId: string
      projectName: string
      slug: string
      planTitle: string
      /** created_at do manifest (ISO) — a "idade" no card do Painel. */
      createdAt: string | null
      origin: DecisionOrigin
    }
  | {
      kind: "pr"
      projectId: string
      projectName: string
      slug: string
      planTitle: string
      prUrl: string
      /** created_at do manifest (ISO) — mesma idade honesta do PRD. */
      createdAt: string | null
      origin: DecisionOrigin
    }
  | {
      kind: "proposal"
      proposalId: string
      /** Ausente = proposta do board inteiro (cross-projeto). */
      projectId?: string
      projectName?: string
      /** 1ª linha da proposta — a linha colapsada da fila/sino. */
      excerpt: string
      /** Texto completo — o "Ver proposta" expande inline no card da fila. */
      body: string
      createdAt: number
    }

/** E1 (S1.6): cards esperando o humano (review/blocked) viram Decision e
 *  entram na MESMA fila "Precisam de você". Derivação pura (sem dismiss
 *  persistido): o card sai da fila quando muda de estado. Projeto arquivado
 *  segue a regra das disputas: o card reaparece se o projeto voltar. */
export function cardDecisions(
  // aceita o CardRow do store (CardRecord + stalledSince transient do vigia)
  // sem importar o store: inbox continua derivação pura sobre dados.
  cards: (CardRecord & { stalledSince?: number })[],
  projects: Project[],
): Decision[] {
  const byId = new Map(projects.map((p) => [p.id, p]))
  const out: Decision[] = []
  for (const c of cards) {
    if (c.state !== "review" && c.state !== "blocked") continue
    const p = byId.get(c.projectId)
    if (!p) continue
    out.push({
      kind: "card",
      cardId: c.id,
      projectId: c.projectId,
      projectName: p.name,
      title: c.title,
      state: c.state,
      stalledSince: c.stalledSince,
    })
  }
  return out
}

/** S4.2: propostas do lead ainda não dispensadas viram Decision e entram na
 *  MESMA fila (derivação pura, padrão cardDecisions — o dismiss persistido
 *  fica no SQL, listOpenProposals já filtra). Proposta de projeto arquivado
 *  segue a regra dos cards: some da fila, reaparece se o projeto voltar.
 *  Proposta sem projectId (board inteiro) entra sempre. */
export function proposalDecisions(
  proposals: LeadProposalRecord[],
  projects: Project[],
): Decision[] {
  const byId = new Map(projects.map((p) => [p.id, p]))
  const out: Decision[] = []
  for (const pr of proposals) {
    const p = pr.projectId ? byId.get(pr.projectId) : undefined
    if (pr.projectId && !p) continue // projeto arquivado
    const firstLine =
      pr.body
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? ""
    out.push({
      kind: "proposal",
      proposalId: pr.id,
      projectId: pr.projectId ?? undefined,
      projectName: p?.name,
      excerpt: firstLine.length > 140 ? firstLine.slice(0, 140) + "…" : firstLine,
      body: pr.body,
      createdAt: pr.createdAt,
    })
  }
  return out
}

/** Decisão que NASCEU no app (disputa, card, proposta) ou gate do SDD já
 *  adotado: conta no badge e na fila "Precisam de você". */
export function isPending(d: Decision): boolean {
  return !("origin" in d) || (!d.origin.discovered && !d.origin.ignored)
}

/** O que realmente espera por você AGORA — a régua do badge. */
export function pendingDecisions(ds: Decision[]): Decision[] {
  return ds.filter(isPending)
}

/** Só descoberto no disco (e não ignorado): a seção "Encontrados no projeto". */
export function foundDecisions(ds: Decision[]): Decision[] {
  return ds.filter((d) => "origin" in d && d.origin.discovered && !d.origin.ignored)
}

/** Os que você mandou sumir (a linha "N ignorados", reversível). */
export function ignoredDecisions(ds: Decision[]): Decision[] {
  return ds.filter((d) => "origin" in d && d.origin.ignored)
}

const MARK_SEP = "\u0000" // nem id de projeto nem slug contêm NUL
function markKey(projectId: string, slug: string): string {
  return `${projectId}${MARK_SEP}${slug}`
}

/** Marcas por (projeto, slug). `null` = INDISPONÍVEL (sem banco ou falha de
 *  leitura) → FAIL-OPEN no chamador: todo gate volta a contar como pendência,
 *  igual antes desta regra. Esconder pendência real por erro de leitura seria o
 *  pior dos dois mundos; contar demais é só barulho. O erro não é engolido em
 *  silêncio (ADR-017): vai pro console com o motivo. */
async function loadPlanMarks(): Promise<Map<string, SddPlanMark> | null> {
  let rows: SddPlanMark[] | null
  try {
    rows = await listSddPlanMarks()
  } catch (e) {
    console.warn(
      "[inbox] falha ao ler as marcas de plano; contando todo gate como pendência",
      e,
    )
    return null
  }
  if (!rows) return null
  return new Map(rows.map((m) => [markKey(m.projectId, m.slug), m]))
}

/** Registra que o humano ENCOSTOU no plano PELO APP (criou aqui, aprovou o PRD,
 *  rodou/marcou/sincronizou etapa): daí em diante o gate conta como pendência
 *  normal, inclusive em outra sessão (persistido). Best-effort COM AVISO: a
 *  ação do usuário já aconteceu no disco, falhar em anotar não pode derrubá-la. */
export async function adoptPlan(projectId: string, slug: string): Promise<void> {
  try {
    await adoptSddPlan(projectId, slug)
  } catch (e) {
    console.warn("[inbox] falha ao marcar a adoção do plano", projectId, slug, e)
  }
}

export async function scanDecisions(
  projects: Project[],
  opts: { includeIgnored?: boolean } = {},
): Promise<Decision[]> {
  const out: Decision[] = []
  const byId = new Map(projects.map((p) => [p.id, p]))

  // 1. disputas do Fusion esperando o veredito (persistidas, cross-restart).
  const pendings = await listPendingDecisions()
  for (const f of pendings) {
    const p = byId.get(f.projectId)
    if (!p) continue // projeto arquivado: a disputa reaparece se ele voltar
    out.push({
      kind: "fusion",
      convId: f.convId,
      projectId: f.projectId,
      projectName: p.name,
      title: f.title ?? "Disputa aguardando decisão",
    })
  }

  // 2. gates do SDD por projeto (fs; projeto sem .claude/plans devolve []).
  //    Cada gate carrega sua PROCEDÊNCIA: descoberto no disco (não conta no
  //    badge) × adotado por um gesto seu aqui dentro (conta). As marcas são do
  //    app, nunca do .claude/plans do usuário.
  const marks = await loadPlanMarks()
  const scans = await Promise.all(
    projects.map(async (p) => ({ p, plans: await loadSddPlans(p.path) })),
  )
  for (const { p, plans } of scans) {
    for (const plan of plans) {
      const mark = marks?.get(markKey(p.id, plan.slug))
      // marks == null (sem banco / falha de leitura) ⇒ fail-open: tudo adotado.
      const discovered = marks != null && mark?.adoptedAt == null
      const ignored = marks != null && mark?.ignoredAt != null
      if (ignored && !opts.includeIgnored) continue
      const origin: DecisionOrigin = {
        path: `.claude/plans/${plan.slug}`,
        discovered,
        ignored,
      }
      if (plan.stage === "prd" && plan.artifacts.prd && !plan.artifacts.prd.approved) {
        out.push({
          kind: "prd",
          projectId: p.id,
          projectName: p.name,
          slug: plan.slug,
          planTitle: plan.title,
          createdAt: plan.createdAt,
          origin,
        })
      } else if (plan.links.pr_url && plan.stage !== "done" && !plan.mergedAt) {
        out.push({
          kind: "pr",
          projectId: p.id,
          projectName: p.name,
          slug: plan.slug,
          planTitle: plan.title,
          prUrl: plan.links.pr_url,
          createdAt: plan.createdAt,
          origin,
        })
      }
    }
  }

  // 3. propostas do lead esperando leitura/dispensa (S4.2, persistidas).
  out.push(...proposalDecisions(await listOpenProposals(), projects))
  return out
}
