// Uma conversa está trabalhando quando roda um turno do executor, quando um
// especialista está dando parecer (advising, ADR-267), ou quando há processos
// vivos em segundo plano. Régua única para a barra lateral e indicadores.

import type { ChatItem } from "@/store/chat"
import { contarBastidoresVivos, temBastidorVivo } from "@/lib/bastidores"

export interface ConversaViva {
  running: boolean
  finalizing?: boolean
  advising?: { id: string; name: string } | null
  items?: ChatItem[]
}

/** Alguém ou algum processo trabalha nesta conversa agora? Puro. */
export function conversaTrabalhando(c: ConversaViva): boolean {
  return c.running || !!c.finalizing || c.advising != null || temBastidorVivo(c.items)
}

/** O especialista que está dando parecer, para o hover dizer quem. Puro. */
export function especialistaTrabalhando(c: ConversaViva): string | null {
  return c.running || c.finalizing ? null : (c.advising?.name ?? null)
}

/** O que trabalha nesta conversa (especialista ou bastidores), para o hover dizer o motivo. Puro. */
export function motivoTrabalhando(c: ConversaViva): string | null {
  if (c.running || c.finalizing) return null
  if (c.advising?.name) return `${c.advising.name} está dando um parecer`
  const n = contarBastidoresVivos(c.items)
  if (n === 1) return "Trabalho em segundo plano rodando"
  if (n > 1) return `${n} trabalhos em segundo plano rodando`
  return null
}

