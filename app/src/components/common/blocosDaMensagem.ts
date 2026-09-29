// A mensagem viva em blocos de topo (F3 de `docs/fluidez-do-fio-plan.md`,
// ADR-291).
//
// A bolha viva reparsava o texto INTEIRO a cada token: O(n²) somado ao longo
// da resposta. Com um `MarkdownRico` memoizado por bloco, só o último reparsa;
// os de cima já têm texto final e o `memo` corta.
//
// O corte é conservador de propósito: na dúvida, não corta, e um bloco maior é
// só mais lento, nunca diferente. O DOM sai igual ao da mensagem inteira porque
// o react-markdown não embrulha a saída: os blocos viram irmãos no mesmo
// container, como já eram.

import { aberturaDeCerca, fechaCerca } from "./markdownBudget"

export interface BlocoDaMensagem {
  /** Offset do bloco no texto da mensagem: é a identidade dele. */
  inicio: number
  texto: string
}

const MARCADOR_DE_LISTA = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/
/** Definição de link e nota de rodapé são lidas de qualquer ponto da
 *  mensagem; HTML em bloco pode abrir numa linha e fechar noutra. Com
 *  qualquer um deles a mensagem fica inteira. */
const PRECISA_DA_MENSAGEM_INTEIRA = [/^ {0,3}\[[^\]]+\]:/m, /\[\^[^\]]+\]/, /^ {0,3}<[A-Za-z!/]/m]

/**
 * Corta antes de uma linha que abre bloco depois de linha em branco, fora de
 * cerca, sem recuo (recuo é continuação de item de lista ou código recuado),
 * e nunca entre itens da mesma lista (duas listas soltas não são uma lista
 * frouxa). `blocos.map(b => b.texto).join("")` devolve o texto recebido.
 */
export function blocosDaMensagem(texto: string): BlocoDaMensagem[] {
  if (PRECISA_DA_MENSAGEM_INTEIRA.some((re) => re.test(texto))) return [{ inicio: 0, texto }]
  const blocos: BlocoDaMensagem[] = []
  let inicioDoBloco = 0
  let cerca: string | null = null
  let anteriorEmBranco = false
  let blocoTemLista = false
  let em = 0
  while (em <= texto.length) {
    const fim = texto.indexOf("\n", em)
    const proxima = fim === -1 ? texto.length + 1 : fim + 1
    const linha = texto.slice(em, fim === -1 ? texto.length : fim)
    if (cerca) {
      if (fechaCerca(linha, cerca)) cerca = null
      anteriorEmBranco = false
    } else {
      const branca = linha.trim() === ""
      if (!branca) {
        const recuada = /^[ \t]/.test(linha)
        const lista = !recuada && MARCADOR_DE_LISTA.test(linha)
        if (anteriorEmBranco && !recuada && em > inicioDoBloco && !(lista && blocoTemLista)) {
          blocos.push({ inicio: inicioDoBloco, texto: texto.slice(inicioDoBloco, em) })
          inicioDoBloco = em
          blocoTemLista = false
        }
        if (lista) blocoTemLista = true
        cerca = aberturaDeCerca(linha)
      }
      anteriorEmBranco = branca
    }
    em = proxima
  }
  blocos.push({ inicio: inicioDoBloco, texto: texto.slice(inicioDoBloco) })
  return blocos
}
