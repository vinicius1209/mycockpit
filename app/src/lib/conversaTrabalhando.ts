// Uma conversa está TRABALHANDO quando roda um turno do executor ou quando um
// especialista está dando um parecer nela (ADR-267).
//
// Visto em 26/09/2026: a Íris "lendo o contexto" no fio, e a linha da conversa
// na barra lateral dizendo "agora", sem o sinal de rodando. O parecer é uma
// consulta à parte: marca `advising` e não mexe em `running`, de propósito
// (não trava o composer nem finge turno do executor). A barra só olhava o
// `running`. Esta é a régua única de "tem alguém trabalhando aqui".

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

