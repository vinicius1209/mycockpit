// O fade por trecho da mensagem viva (ADR-290).
//
// Cada palavra vira um `span` próprio, e só as que nasceram depois da montagem
// ganham a classe que dissolve. Funciona porque o react-markdown dá `key` por
// posição entre irmãos da mesma tag (`span-0`, `span-1`...): com TODA palavra
// embrulhada desde o começo, a palavra velha mantém a key e o elemento, e a
// nova monta e anima. Embrulhar só a cauda deslocaria as keys e o trecho novo
// herdaria um elemento que já terminou de animar.
//
// Só a bolha viva recebe o plugin: assentada, ela volta a ser texto corrido.

import type { Element, ElementContent, Root, RootContent, Text } from "hast"

export const CLASSE_DO_TRECHO = "fio-trecho"

/** Não se desce nestes: `code` e `pre` leem os filhos como texto (menção de
 *  arquivo, detecção de bloco, Mermaid). Código inline entra inteiro, como uma
 *  palavra; bloco de código não dissolve. */
const INTEIROS = new Set(["code", "img", "input", "br", "hr"])
const INTOCADOS = new Set(["pre"])

function span(filhos: ElementContent[], novo: boolean): Element {
  return {
    type: "element",
    tagName: "span",
    properties: novo ? { className: [CLASSE_DO_TRECHO] } : {},
    children: filhos,
  }
}

function inicio(no: { position?: { start?: { offset?: number } } }): number | null {
  const o = no.position?.start?.offset
  return typeof o === "number" ? o : null
}

/** Palavra com o espaço que a segue: o espaço viaja junto e não vira irmão
 *  solto (que também mudaria a contagem de posições). */
function palavras(texto: string): { pedaco: string; em: number }[] {
  const out: { pedaco: string; em: number }[] = []
  const re = /\s*\S+\s*|\s+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(texto))) out.push({ pedaco: m[0], em: m.index })
  return out
}

function embrulhar(filhos: (ElementContent | RootContent)[], desde: number): ElementContent[] {
  const out: ElementContent[] = []
  for (const no of filhos) {
    if (no.type === "text") {
      // Espaço solto entre blocos, itens ou linhas de tabela fica texto: o
      // react-markdown o descarta dentro de `table`/`tr`, e um `span` ali
      // seria HTML inválido (célula anônima na tabela).
      if ((no as Text).value.trim() === "") {
        out.push(no as Text)
        continue
      }
      const base = inicio(no)
      for (const { pedaco, em } of palavras((no as Text).value)) {
        // Sem posição, o texto é histórico: nada inventado dissolve.
        const novo = base !== null && base + em >= desde
        out.push(span([{ type: "text", value: pedaco }], novo))
      }
    } else if (no.type === "element") {
      if (INTOCADOS.has(no.tagName)) out.push(no)
      else if (INTEIROS.has(no.tagName)) {
        const o = inicio(no)
        out.push(span([no], o !== null && o >= desde))
      } else {
        out.push({ ...no, children: embrulhar(no.children, desde) })
      }
    } else if (no.type !== "doctype") {
      out.push(no as ElementContent)
    }
  }
  return out
}

/** Puro: a árvore com cada palavra embrulhada; as de `desde` em diante
 *  (offset no texto da mensagem) levam a classe do fade. */
export function embrulharTrechos(arvore: Root, desde: number): Root {
  return { ...arvore, children: embrulhar(arvore.children, desde) as RootContent[] }
}

/** A duração do fade do trecho: a mesma do `--dur-slow` do `.fio-trecho`. */
export const DURACAO_DO_TRECHO_MS = 320

/** Os trechos que chegaram há menos de `DURACAO_DO_TRECHO_MS`, em ordem. */
export interface RegistroDeTrechos {
  tamanho: number
  jovens: readonly { de: number; ts: number }[]
}

/** Puro: anota o crescimento do texto e esquece o que já terminou de
 *  dissolver. Começa com o tamanho da montagem: o que já estava lá chega
 *  pronto (ADR-179). */
export function registrarTrechos(r: RegistroDeTrechos, tamanho: number, agora: number): RegistroDeTrechos {
  let jovens = r.jovens
  if (tamanho > r.tamanho) jovens = [...jovens, { de: r.tamanho, ts: agora }]
  else if (tamanho < r.tamanho) jovens = jovens.filter((j) => j.de < tamanho)
  jovens = jovens.filter((j) => agora - j.ts < DURACAO_DO_TRECHO_MS)
  return { tamanho, jovens }
}

/** Onde começa o texto que ainda está dissolvendo. Antes dele, nada anima:
 *  enquanto a resposta chega, o markdown muda de forma por um instante (a
 *  linha vira título até o "-" da lista completar, o código inline só fecha na
 *  segunda crase) e recria elementos; palavra que você já está lendo não pode
 *  piscar de novo por isso. */
export function inicioDosJovens(r: RegistroDeTrechos): number {
  return r.jovens.length > 0 ? r.jovens[0].de : r.tamanho
}

/** O plugin de rehype. `desde` é onde começa o texto ainda dissolvendo
 *  (`inicioDosJovens`), no offset do texto que o plugin recebe. */
export function rehypeTrechos(opcoes: { desde: number }) {
  return (arvore: Root) => embrulharTrechos(arvore, opcoes.desde)
}
