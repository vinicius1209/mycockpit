// O canal do run entrega evento por evento, em ordem, e só libera o próximo
// depois que o handler do atual RETORNA: o `Channel` do Tauri 2 numera cada
// mensagem e o lado JS avança o índice depois de chamar `onmessage`. Se o
// handler lança, o índice nunca avança e todo evento seguinte do turno (o resto
// do texto, o `result`, o custo) fica na fila para sempre, sem erro visível.
//
// Foi o incidente de 14/09/2026 (ADR-190): um `React error #185` disparado
// dentro do `handleEvent` congelou duas respostas em ~480 caracteres, enquanto
// a sessão do Claude guardava as duas inteiras. Um evento que quebra o reducer
// não pode levar o turno junto: fail-open no render.

export type RelatoDeFalha<T> = (evento: T, erro: unknown) => void

function relatarNoConsole(evento: { type?: string }, erro: unknown): void {
  // console.error chega ao log do app (observabilidade do webview).
  console.error(
    `[canal do run] o evento "${evento.type ?? "?"}" falhou ao ser aplicado; os próximos seguem`,
    erro,
  )
}

/** Envolve o handler do canal: a falha de um evento é relatada e isolada, e o
 *  índice do canal continua avançando. Não re-tenta nem sintetiza nada. */
export function entregarSemTravar<T extends { type?: string }>(
  entregar: (evento: T) => void,
  relatar: RelatoDeFalha<T> = relatarNoConsole,
): (evento: T) => void {
  return (evento) => {
    try {
      entregar(evento)
    } catch (erro) {
      relatar(evento, erro)
    }
  }
}

/** O que a pessoa lê no fio quando um evento do turno falhou ao ser aplicado.
 *  Sem travessão (regra da casa). */
export const AVISO_DE_FALHA_DE_ENTREGA =
  "Um evento deste turno falhou ao ser exibido, e pode faltar conteúdo acima. O detalhe técnico ficou no log do app."

/**
 * Relato que, além do log, deixa marca VISÍVEL no fio: um aviso por run, não
 * um por evento. Foi o que faltou no incidente de 14/09/2026: o `#185` estava
 * no log desde 04/09 e ninguém soube, porque a tela só mostrava uma resposta
 * menor do que a real.
 *
 * O aviso sai numa task nova (`agendar`), fora da pilha do handler que acabou
 * de lançar: aplicar o aviso ali dentro repetiria a mesma falha. Se até o
 * aviso falhar, sobra o log, e isso também é registrado.
 */
export function relatoVisivel<T extends { type?: string }>(
  avisar: (mensagem: string) => void,
  agendar: (fn: () => void) => void = (fn) => setTimeout(fn, 0),
  registrar: RelatoDeFalha<T> = relatarNoConsole,
): RelatoDeFalha<T> {
  let avisou = false
  return (evento, erro) => {
    registrar(evento, erro)
    if (avisou) return
    avisou = true
    agendar(() => {
      try {
        avisar(AVISO_DE_FALHA_DE_ENTREGA)
      } catch (falhaDoAviso) {
        console.error("[canal do run] nem o aviso de falha pôde ser exibido", falhaDoAviso)
      }
    })
  }
}
