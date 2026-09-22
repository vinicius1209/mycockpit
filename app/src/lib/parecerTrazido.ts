// O PARECER TRAZIDO PARA O EXECUTOR, como bloco do rascunho.
//
// "Trazer pro Executor" gravava o parecer num campo invisível da conversa
// (`pendingAdvice`) e mostrava um toast: a tela ficava idêntica, não dava para
// saber quantos você trouxe, não dava para tirar, clicar duas vezes levava o
// mesmo parecer duas vezes, e fechar o app perdia tudo, porque aquilo só vivia
// em memória. Relato de 21/09/2026: "clico, mostra o toast e continua tudo
// igual".
//
// Agora é BLOCO do rascunho, o mesmo modelo da citação, da colagem grande e da
// região marcada do navegador: aparece como pílula, sai pelo "×", persiste por
// conversa e conta quantos vão. Trazer material para a próxima mensagem já
// tinha vocabulário aqui; um quarto jeito de dizer isso seria a superfície
// duplicada que o guia proíbe.
//
// O que NÃO mudou: o parecer continua entrando como bloco de contexto do
// prompt (acima do pedido, pela cascata), nunca como texto da sua mensagem.

import { useComposerDrafts } from "@/store/composerDrafts"

export interface BlocoParecer {
  tipo: "parecer"
  id: string
  /** Item de parecer no fio, para o cartão saber que ESTE já foi trazido. */
  itemId: string
  personaId: string
  personaNome: string
  texto: string
}

export function rotuloDoParecer(bloco: Pick<BlocoParecer, "personaNome">): string {
  return `Parecer de ${bloco.personaNome}`
}

/** "leva 1 parecer" / "leva 2 pareceres", no rodapé do composer, no momento em
 *  que isso importa: a hora de enviar. `null` quando não há nenhum. */
export function rotuloDaCarga(quantos: number): string | null {
  if (quantos <= 0) return null
  return quantos === 1 ? "leva 1 parecer" : `leva ${quantos} pareceres`
}

/** O mesmo gesto liga e desliga: clicar de novo TIRA, em vez de acumular o
 *  mesmo parecer sem avisar (era o que acontecia). */
export function alternarParecer(
  blocos: readonly { tipo: string }[] | undefined,
  novo: BlocoParecer,
): { tipo: string }[] {
  const atuais = blocos ?? []
  const jaEsta = atuais.some(
    (b) => b.tipo === "parecer" && (b as BlocoParecer).itemId === novo.itemId,
  )
  return jaEsta
    ? atuais.filter((b) => !(b.tipo === "parecer" && (b as BlocoParecer).itemId === novo.itemId))
    : [...atuais, novo]
}

export function parecerJaTrazido(
  blocos: readonly { tipo: string }[] | undefined,
  itemId: string,
): boolean {
  return (blocos ?? []).some(
    (b) => b.tipo === "parecer" && (b as BlocoParecer).itemId === itemId,
  )
}

/** O que vai no PROMPT: os pareceres trazidos, na ordem em que você trouxe,
 *  emoldurados como opinião de conselheiro (só leitura). `null` = nada a levar,
 *  e aí o turno segue sem bloco nenhum. */
export function blocoDosPareceres(
  blocos: readonly { tipo: string }[] | undefined,
): string | null {
  const pareceres = (blocos ?? []).filter(
    (b): b is BlocoParecer => b.tipo === "parecer",
  )
  if (pareceres.length === 0) return null
  return pareceres
    .map((p) =>
      [
        `<parecer de="${p.personaNome}">`,
        `Parecer de ${p.personaNome} (conselheiro, só leitura) trazido para você considerar neste turno:`,
        "",
        p.texto.trim(),
        "</parecer>",
      ].join("\n"),
    )
    .join("\n\n")
}


/** Atalho do caminho de envio: o que o rascunho desta conversa está levando de
 *  parecer, já emoldurado para o prompt. Mora aqui para o `ChatPanel` não
 *  precisar conhecer o formato nem a store. */
export function pareceresDoRascunho(convId: string): string | null {
  return blocoDosPareceres(useComposerDrafts.getState().byConv[convId]?.blocos)
}
