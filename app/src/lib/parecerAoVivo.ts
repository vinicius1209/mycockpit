// O parecer AO VIVO (ADR-267, mock `docs/mocks/especialista-na-conversa.html`):
// enquanto o especialista trabalha, o fio mostra o que ele faz de verdade, e o
// texto chega conforme o motor escreve. Antes era "está lendo o contexto" com
// três pontos, e o parecer aparecia de uma vez no fim, embora o texto já
// chegasse aos pedaços no `runAdvisor`.
//
// O estado vem dos eventos que o motor já manda, nunca de um roteiro: nada de
// "pensando…" inventado.

import { presentTool } from "@/lib/toolview"

export interface ParecerAoVivo {
  /** O que ele está fazendo agora ("lendo a conversa", "lendo oferta.ts",
   *  "escrevendo"). */
  estado: string
  /** O texto que já chegou. Vazio até o primeiro pedaço. */
  texto: string
}

/** O especialista em consulta numa conversa (`conv.advising`): quem é e,
 *  depois do primeiro evento do motor, o que ele faz e o texto que já chegou. */
export interface Consultado {
  id: string
  name: string
  aoVivo?: ParecerAoVivo
}

export const LENDO_A_CONVERSA = "lendo a conversa"
export const ESCREVENDO = "escrevendo"

/** O gerúndio do primeiro verbo ("Ler" → "lendo", "Buscar no projeto" →
 *  "buscando no projeto"). Verbo que não termina em -ar/-er/-ir fica como está.
 *  Puro. */
export function gerundio(frase: string): string {
  const [verbo, ...resto] = frase.trim().split(/\s+/)
  const baixo = (verbo ?? "").toLowerCase()
  const g = /[aei]r$/.test(baixo) ? `${baixo.slice(0, -1)}ndo` : baixo
  return [g, ...resto].join(" ").trim()
}

/** O estado de uma ferramenta que o especialista usou: o verbo no gerúndio e
 *  o objeto (o nome do arquivo, o comando). Puro. */
export function estadoDaFerramenta(nome: string, entrada: unknown): string {
  const v = presentTool(nome, entrada)
  const o = v.object
  const objeto =
    o?.kind === "file"
      ? (o.path.split("/").filter(Boolean).pop() ?? o.path)
      : o?.kind === "command"
        ? o.text.length > 40
          ? `${o.text.slice(0, 40)}…`
          : o.text
        : o?.kind === "text" && !o.frase
          ? o.text
          : ""
  return `${gerundio(v.verb)}${objeto ? ` ${objeto}` : ""}`.trim()
}
