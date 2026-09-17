// O envelope de um bloco do rascunho dentro do texto enviado.
//
// Colagem grande (capricho R7) e marcação de região (navegador R4) viajam do
// mesmo jeito: DEPOIS do que a pessoa escreveu, num envelope com a contagem de
// linhas no cabeçalho. A contagem é o que torna o formato à prova do conteúdo:
// a leitura conta linhas em vez de procurar o fechamento, então um texto que
// contenha o próprio fechamento não quebra nada.
//
//   ⟦colado · 500 linhas⟧
//   (as 500 linhas, intactas)
//   ⟦/colado⟧
//
// Um só lugar porque são o MESMO gesto: material que a pessoa junta ao pedido,
// grande demais para ficar no editor, e que o motor tem que receber como dado.

export function linhasDe(texto: string): number {
  return texto.split("\n").length
}

function cabeca(marca: string, n: number): string {
  return `⟦${marca} · ${n} ${n === 1 ? "linha" : "linhas"}⟧`
}

function fecho(marca: string): string {
  return `⟦/${marca}⟧`
}

function padraoDaCabeca(marca: string): RegExp {
  return new RegExp(`^⟦${marca} · (\\d+) linhas?⟧$`)
}

/** Os envelopes no fim do texto. Sem texto escrito, nada muda: bloco sozinho
 *  não vira mensagem (mesma regra da citação). */
export function comEnvelopes(marca: string, texto: string, itens: readonly string[]): string {
  if (!texto.trim() || itens.length === 0) return texto
  const partes = itens.map(
    (item) => `${cabeca(marca, linhasDe(item))}\n${item}\n${fecho(marca)}`,
  )
  return `${texto}\n\n${partes.join("\n\n")}`
}

/** O inverso: separa os envelopes do fim do texto. Formato quebrado (contagem
 *  que não fecha) fica inteiro no corpo. */
export function separarEnvelopes(
  marca: string,
  texto: string,
): { corpo: string; itens: string[] } {
  const padrao = padraoDaCabeca(marca)
  const linhas = texto.split("\n")
  let inicio = -1
  for (let i = 0; i < linhas.length; i++) {
    if (padrao.test(linhas[i]) && (i === 0 || linhas[i - 1] === "")) {
      inicio = i
      break
    }
  }
  if (inicio < 0) return { corpo: texto, itens: [] }
  const itens: string[] = []
  let i = inicio
  while (i < linhas.length) {
    const achado = padrao.exec(linhas[i])
    if (!achado) return { corpo: texto, itens: [] }
    const fim = i + 1 + Number(achado[1])
    if (linhas[fim] !== fecho(marca)) return { corpo: texto, itens: [] }
    itens.push(linhas.slice(i + 1, fim).join("\n"))
    i = fim + 1
    if (i < linhas.length && linhas[i] === "") i++
  }
  const corpo = linhas.slice(0, inicio).join("\n").replace(/\n+$/, "")
  return { corpo, itens }
}
