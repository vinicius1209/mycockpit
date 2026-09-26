// Uma conversa está TRABALHANDO quando roda um turno do executor ou quando um
// especialista está dando um parecer nela (ADR-267).
//
// Visto em 26/09/2026: a Íris "lendo o contexto" no fio, e a linha da conversa
// na barra lateral dizendo "agora", sem o sinal de rodando. O parecer é uma
// consulta à parte: marca `advising` e não mexe em `running`, de propósito
// (não trava o composer nem finge turno do executor). A barra só olhava o
// `running`. Esta é a régua única de "tem alguém trabalhando aqui".

export interface ConversaViva {
  running: boolean
  advising?: { id: string; name: string } | null
}

/** Alguém trabalha nesta conversa agora? Puro. */
export function conversaTrabalhando(c: ConversaViva): boolean {
  return c.running || c.advising != null
}

/** O especialista que está dando parecer, para o hover dizer quem. Puro. */
export function especialistaTrabalhando(c: ConversaViva): string | null {
  return c.running ? null : (c.advising?.name ?? null)
}
