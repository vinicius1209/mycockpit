// Projetos no snapshot do Companion: os motores utilizáveis com a conversa de
// MESA de cada um e, desde o R3 (docs/companion-chat-prd.md), as conversas
// recentes do projeto, para o celular chat-first abrir qualquer uma. Puro:
// quem chama (`buildCompanionSnapshot`) passa o que leu dos stores.

import type { ConversationMeta } from "@/lib/db/conversations"
import { turnosRecentes } from "@/lib/lastTurn"
import { fraseDoTurno } from "@/lib/turnReceipt"
import type { CompanionConversa, CompanionProject, CompanionProjectAgent } from "@/lib/companionTypes"

/** Conversas recentes por projeto. Quem roda ou pede você entra mesmo além disso. */
export const CONVERSAS_POR_PROJETO = 20

export interface EntradaDosProjetos {
  projects: { id: string; name: string }[]
  /** Motores prontos nesta máquina (a régua de prontidão fica com quem chama). */
  usableAgents: string[]
  metasByProject: Record<string, ConversationMeta[]>
  /** Prefixo do título da conversa de mesa ("Mesa · "). */
  prefixoDaMesa: string
  rodando: (convId: string) => boolean
  /** Conversas com item em `attention` (aprovação, pergunta, gate, turno parado). */
  pedeVoce: ReadonlySet<string>
  /** Frase pronta do último turno encerrado da conversa (recibo ou desfecho).
   *  Ausente ou `null` = o feed não guarda turno dela: a linha fica sem prévia,
   *  nunca com texto inventado. */
  fraseDe?: (convId: string) => string | null
  limite?: number
}

/** Prévia da linha de conversa no celular: a frase pronta do último turno
 *  ENCERRADO de cada conversa, do mesmo feed do sino que alimenta `lastTurns`
 *  (sem tabela nova). O teto é o do próprio feed; conversa fora dele fica sem. */
export function frasesDoFeed(
  feed: Parameters<typeof turnosRecentes>[0],
): (convId: string) => string | null {
  const porConversa = new Map<string, string>()
  for (const t of turnosRecentes(feed, Number.MAX_SAFE_INTEGER)) {
    if (!porConversa.has(t.convId)) porConversa.set(t.convId, fraseDoTurno(t.receipt, t.ok))
  }
  return (convId) => porConversa.get(convId) ?? null
}

function mesaDe(metas: ConversationMeta[], agent: string, prefixo: string): CompanionProjectAgent {
  let melhor: ConversationMeta | null = null
  for (const m of metas) {
    if (m.agent !== agent || !m.title?.startsWith(prefixo)) continue
    if (!melhor || m.updatedAt > melhor.updatedAt) melhor = m
  }
  return melhor ? { agent, deskConvId: melhor.id, deskTitle: melhor.title ?? undefined } : { agent }
}

/** Mais recentes primeiro; quem roda ou pede você nunca fica de fora do teto. */
export function conversasRecentes(
  metas: ConversationMeta[],
  rodando: (convId: string) => boolean,
  pedeVoce: ReadonlySet<string>,
  limite = CONVERSAS_POR_PROJETO,
  fraseDe?: (convId: string) => string | null,
): CompanionConversa[] {
  const ordenadas = [...metas].sort((a, b) => b.updatedAt - a.updatedAt)
  const escolhidas = ordenadas.filter(
    (m, i) => i < limite || rodando(m.id) || pedeVoce.has(m.id),
  )
  return escolhidas.map((m) => {
    const frase = fraseDe?.(m.id) ?? null
    return {
      convId: m.id,
      title: m.title?.trim() || "Conversa",
      agent: m.agent,
      updatedAt: m.updatedAt,
      running: rodando(m.id),
      pedeVoce: pedeVoce.has(m.id),
      ...(frase ? { frase } : {}),
    }
  })
}

export function projetosDoCompanion(e: EntradaDosProjetos): CompanionProject[] {
  return e.projects.map((p) => {
    const metas = e.metasByProject[p.id] ?? []
    return {
      id: p.id,
      name: p.name,
      agents: e.usableAgents.map((a) => mesaDe(metas, a, e.prefixoDaMesa)),
      recent: conversasRecentes(metas, e.rodando, e.pedeVoce, e.limite, e.fraseDe),
    }
  })
}
