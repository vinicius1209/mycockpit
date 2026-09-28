// Inbox de decisões: TUDO que espera o humano, num lugar só. O trabalho do
// piloto num cockpit multi-agent não é ler chats, é DECIDIR: disputa esperando
// veredito (fusion_runs pendentes no DB), card do board parado em revisão ou
// bloqueio, proposta do lead por ler. Tudo nasce no app, então tudo que entra
// aqui é pendência de verdade (não existe "descoberto no disco"). Varredura
// barata (SQL), sob demanda.

import {
  listOpenProposals,
  listPendingDecisions,
  type CardRecord,
  type LeadProposalRecord,
} from "@/lib/db"
import type { Project } from "@/lib/types"
import { orderQueue } from "@/lib/panel"

export type Decision =
  | {
      kind: "fusion"
      convId: string
      projectId: string
      projectName: string
      title: string
      /** created_at da disputa (epoch ms), quando a varredura tem a linha do
       *  banco. Ausente na disputa montada AO VIVO pelo store (a decisão
       *  acabou de nascer): a faixa só envelhece o que tem carimbo real. */
      createdAt?: number
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

export async function scanDecisions(projects: Project[]): Promise<Decision[]> {
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
      createdAt: f.createdAt,
    })
  }

  // 2. propostas do lead esperando leitura/dispensa (S4.2, persistidas).
  out.push(...proposalDecisions(await listOpenProposals(), projects))
  return out
}

/** A fila na ordem de urgência: disputa ao vivo que a varredura ainda não viu,
 *  as persistidas e os cards parados em revisão ou bloqueio. Pura. */
export function montarFila(o: {
  varridas: Decision[]
  /** Conversas com disputa em `deciding` agora. */
  decidindo: string[]
  projects: Project[]
  cards: Parameters<typeof cardDecisions>[0]
  projetoDe: (convId: string) => string | undefined
  promptDe: (convId: string) => string | undefined
}): Decision[] {
  const vistas = new Set(
    o.varridas.filter((d) => d.kind === "fusion").map((d) => d.convId),
  )
  const nomeDe = new Map(o.projects.map((p) => [p.id, p.name]))
  const aoVivo: Decision[] = []
  for (const convId of o.decidindo) {
    if (vistas.has(convId)) continue
    const projectId = o.projetoDe(convId)
    if (!projectId) continue
    aoVivo.push({
      kind: "fusion",
      convId,
      projectId,
      projectName: nomeDe.get(projectId) ?? "projeto",
      title: o.promptDe(convId) ?? "Disputa aguardando decisão",
    })
  }
  return orderQueue([...aoVivo, ...o.varridas, ...cardDecisions(o.cards, o.projects)])
}
