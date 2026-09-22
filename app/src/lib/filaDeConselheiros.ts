// A FILA DE CONSELHEIROS de uma consulta com mais de um chamado.
//
// Chamar duas personas na mesma mensagem já consultava as duas, em sequência
// (a segunda enxerga o parecer da primeira). O que faltava era a tela: durante
// o parecer da primeira, a segunda não existia em lugar nenhum, e quem chamou
// duas via uma só trabalhando e concluía que a outra tinha sido engolida.
//
// A fila é estado EFÊMERO da conversa, como `advising`: não persiste, não trava
// envio, não finge turno. Só diz quem ainda vai ser ouvido.

export interface ConselheiroNaFila {
  id: string
  name: string
}

/** Quem ainda não começou, na ordem. Quem está lendo agora NÃO está na fila:
 *  ele já tem a linha de chegada própria. */
export function aindaNaFila(
  fila: readonly ConselheiroNaFila[] | undefined,
  personaId: string,
): boolean {
  return (fila ?? []).some((c) => c.id === personaId)
}

/** "para Aline · na fila" / "para Aline". O endereçamento da bolha diz em UMA
 *  linha o que está acontecendo com aquele pedido. */
export function rotuloDoDestinatario(
  destinatario: { id: string; name: string },
  fila: readonly ConselheiroNaFila[] | undefined,
): string {
  return aindaNaFila(fila, destinatario.id)
    ? `para ${destinatario.name} · na fila`
    : `para ${destinatario.name}`
}

/** "Aline é a próxima" para a linha de chegada de quem está lendo agora.
 *  `null` quando não há ninguém depois (o caso comum, de um chamado só). */
export function quemVemDepois(
  fila: readonly ConselheiroNaFila[] | undefined,
): string | null {
  const proxima = (fila ?? [])[0]
  return proxima ? `${proxima.name} é a próxima` : null
}

/** A fila sem quem acabou de começar (ou de falhar): some da espera e vai para
 *  a linha de chegada, ou para a linha honesta de falha. */
export function semEsse(
  fila: readonly ConselheiroNaFila[] | undefined,
  personaId: string,
): ConselheiroNaFila[] {
  return (fila ?? []).filter((c) => c.id !== personaId)
}
