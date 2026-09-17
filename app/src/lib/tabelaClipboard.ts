// Copiar tabela como tabela (capricho PRD R1). A tabela do fio vira uma matriz
// de textos e daí três formatos: TSV e HTML para planilha e documento, GFM para
// quem quer Markdown. Tudo puro, exceto `lerTabela`, que só atravessa o DOM.

export interface TabelaCopiavel {
  linhas: string[][]
  /** A primeira linha é cabeçalho (`<th>`)? */
  cabecalho: boolean
}

export type DestinoDaTabela = "planilha" | "markdown"

/** Texto de uma célula: `<br>` vira quebra, espaços de marcação somem. */
export function textoDaCelula(bruto: string): string {
  return bruto
    .split("\n")
    .map((linha) => linha.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .trim()
}

function textoComQuebras(no: Node): string {
  if (no.nodeType === 3) return no.textContent ?? ""
  if (no.nodeName === "BR") return "\n"
  return Array.from(no.childNodes).map(textoComQuebras).join("")
}

/** DOM → matriz. Linhas vazias saem; colunas são completadas depois. */
export function lerTabela(tabela: HTMLTableElement): TabelaCopiavel {
  const trs = Array.from(tabela.querySelectorAll("tr"))
  const linhas = trs
    .map((tr) => Array.from(tr.querySelectorAll("th,td")).map((c) => textoDaCelula(textoComQuebras(c))))
    .filter((cells) => cells.length > 0)
  const primeira = trs[0]
  const cabecalho = Boolean(primeira && primeira.querySelector("th") && !primeira.querySelector("td"))
  return { linhas, cabecalho }
}

function retangular(linhas: string[][]): string[][] {
  const largura = Math.max(0, ...linhas.map((l) => l.length))
  return linhas.map((l) => [...l, ...Array(largura - l.length).fill("")])
}

/** TSV no dialeto que Sheets, Numbers e Excel leem: célula com tab, quebra ou
 *  aspas vai entre aspas, com aspas dobradas. */
export function paraTsv(t: TabelaCopiavel): string {
  return retangular(t.linhas)
    .map((l) =>
      l.map((c) => (/[\t\n\r"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join("\t"),
    )
    .join("\n")
}

function escaparHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>")
}

/** HTML limpo, sem classe nem estilo: documento e planilha montam a tabela. */
export function paraHtml(t: TabelaCopiavel): string {
  const [primeira, ...resto] = retangular(t.linhas)
  if (!primeira) return ""
  const linha = (l: string[], tag: "th" | "td") =>
    `<tr>${l.map((c) => `<${tag}>${escaparHtml(c)}</${tag}>`).join("")}</tr>`
  const corpo = (t.cabecalho ? resto : [primeira, ...resto]).map((l) => linha(l, "td")).join("")
  const cabeca = t.cabecalho ? `<thead>${linha(primeira, "th")}</thead>` : ""
  return `<table>${cabeca}<tbody>${corpo}</tbody></table>`
}

/** GFM: a primeira linha é o cabeçalho (o formato exige um); `|` escapado e
 *  quebra dentro da célula vira `<br>`, senão a linha se parte. */
export function paraMarkdown(t: TabelaCopiavel): string {
  const linhas = retangular(t.linhas)
  if (linhas.length === 0) return ""
  const celula = (c: string) => c.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>")
  const linha = (l: string[]) => `| ${l.map(celula).join(" | ")} |`
  const [primeira, ...resto] = linhas
  const separador = `| ${primeira.map(() => "---").join(" | ")} |`
  return [linha(primeira), separador, ...resto.map(linha)].join("\n")
}

/** O que vai para a área de transferência em cada destino. */
export function conteudoDaTabela(
  t: TabelaCopiavel,
  destino: DestinoDaTabela,
): { plain: string; html?: string } {
  return destino === "planilha" ? { plain: paraTsv(t), html: paraHtml(t) } : { plain: paraMarkdown(t) }
}

export interface CelulaVista {
  texto: string
  /** A seleção toca esta célula (ainda que em parte). */
  selecionada: boolean
}

/** Seleção dentro de uma tabela → a sub-tabela que ela cobre (C-T2). Pega o
 *  retângulo das células tocadas: linhas e colunas entre a primeira e a última
 *  selecionadas, com o texto INTEIRO de cada célula (planilha não tem meia
 *  célula). O cabeçalho vale se a primeira linha do recorte é a de cabeçalho. */
export function recorteDaSelecao(
  linhas: readonly (readonly CelulaVista[])[],
  primeiraLinhaECabecalho: boolean,
): TabelaCopiavel | null {
  let l0 = Infinity
  let l1 = -1
  let c0 = Infinity
  let c1 = -1
  linhas.forEach((linha, i) =>
    linha.forEach((celula, j) => {
      if (!celula.selecionada) return
      l0 = Math.min(l0, i)
      l1 = Math.max(l1, i)
      c0 = Math.min(c0, j)
      c1 = Math.max(c1, j)
    }),
  )
  if (l1 < 0) return null
  const recorte = linhas
    .slice(l0, l1 + 1)
    .map((linha) => Array.from({ length: c1 - c0 + 1 }, (_, k) => linha[c0 + k]?.texto ?? ""))
  // Uma célula só não é tabela: a cópia normal do texto resolve.
  if (recorte.length === 1 && recorte[0].length === 1) return null
  return { linhas: recorte, cabecalho: primeiraLinhaECabecalho && l0 === 0 }
}
