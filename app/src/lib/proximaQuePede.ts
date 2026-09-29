// "Próxima que pede você": o atalho que leva à conversa com pedido pendente
// (permissão, pergunta, plano, recurso) e, repetido, passa à seguinte. A
// régua de quem pede é a do sino e da sidebar (`ownerByRunId`); a ordem é a
// de chegada na fila, então a primeira é a que espera há mais tempo.

import type { InteractionRequest } from "@/lib/interaction"
import { ehApple, type TeclaDoAtalho } from "@/components/layout/atalhosDasAbas"
import { ownerByRunId } from "@/store/interactions"

export interface ConversaQuePede {
  convId: string
  projectId: string
}

/** As conversas que pedem você, da que espera há mais tempo para a mais
 *  nova, uma vez cada. Pedido sem dono ou de conversa sem projeto fica de
 *  fora: não há para onde ir. Pura. */
export function conversasQuePedem(
  fila: readonly InteractionRequest[],
  chat: { byId: Record<string, { runId: string | null; projectId?: string | null }> },
  missoes: Parameters<typeof ownerByRunId>[2],
): ConversaQuePede[] {
  const vistas = new Set<string>()
  const out: ConversaQuePede[] = []
  for (const req of fila) {
    const dono = ownerByRunId(req, chat, missoes)
    if (!dono || vistas.has(dono.convId)) continue
    const projectId = chat.byId[dono.convId]?.projectId
    if (!projectId) continue
    vistas.add(dono.convId)
    out.push({ convId: dono.convId, projectId })
  }
  return out
}

/** Para onde o atalho leva: estando numa que pede, a seguinte (volta ao
 *  começo no fim); fora delas, a que espera há mais tempo. Pura. */
export function proximaQuePede(
  conversas: readonly ConversaQuePede[],
  atual: string | null,
): ConversaQuePede | null {
  if (conversas.length === 0) return null
  const i = conversas.findIndex((c) => c.convId === atual)
  return conversas[i < 0 ? 0 : (i + 1) % conversas.length]
}

/** ⌘⇧A no Mac, Ctrl+Shift+A no Linux. Pura. */
export function ehAtalhoDaProxima(e: TeclaDoAtalho, plataforma: string): boolean {
  if (e.altKey || !e.shiftKey || e.code !== "KeyA") return false
  return ehApple(plataforma) ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
}
