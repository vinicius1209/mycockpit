// Nome de arquivo cortado NO MEIO: a extensão diz o que o arquivo é, então
// ela nunca some. O CSS só corta no fim (`truncate`), e "relatorio-cartoes-se…"
// esconde justamente o ".pdf". Conta graphemes, não unidades UTF-16: acento
// composto e emoji não partem ao meio.

const segmentador =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("pt-BR", { granularity: "grapheme" })
    : null

function graphemes(texto: string): string[] {
  return segmentador ? Array.from(segmentador.segment(texto), (s) => s.segment) : Array.from(texto)
}

/** Extensão curta (até 8 letras) conta como extensão; o resto é nome. */
function separarExtensao(nome: string): [string, string] {
  const i = nome.lastIndexOf(".")
  if (i <= 0 || nome.length - i > 9) return [nome, ""]
  return [nome.slice(0, i), nome.slice(i)]
}

/** Corta o nome no meio para caber em `max` graphemes, mantendo a extensão
 *  e um pedaço do fim do nome ("relatorio-cartoes-…-2026.pdf"). Puro. */
export function nomeCortadoNoMeio(nome: string, max = 30): string {
  const tudo = graphemes(nome)
  if (tudo.length <= max) return nome
  const [base, ext] = separarExtensao(nome)
  const b = graphemes(base)
  const espaco = max - graphemes(ext).length - 1
  if (espaco < 4) return tudo.slice(0, max - 1).join("") + "…"
  const fim = Math.min(5, Math.floor(espaco / 3))
  const inicio = espaco - fim
  return `${b.slice(0, inicio).join("")}…${b.slice(b.length - fim).join("")}${ext}`
}
