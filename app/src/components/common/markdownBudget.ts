// Quanto trabalho o parser de Markdown pode receber de UMA mensagem.
//
// ADR-184 (12/09/2026): a saída real do Maclan tem uma linha de 142.976 pontos
// de progresso do Vitest, e `remark-gfm` levou 32 s nela, porque o tokenizer de
// autolink tenta achar email a partir de cada ponto e refaz a varredura do
// sufixo. O custo cresce com o QUADRADO do tamanho DA LINHA.
//
// ADR-210 (17/09/2026): a primeira defesa mandou a mensagem INTEIRA para texto
// cru paginado acima de 16 KB, e isso pegou mensagem normal, que é o que a
// pessoa mais precisa ler. Medido nesta máquina: conteúdo normal é linear
// (18 KB = 72 ms, 145 KB = 146 ms, 290 KB = 234 ms, parse + highlight + render),
// enquanto a linha patológica é quadrática (2.048 pontos = 11 ms, 8.192 = 108 ms,
// 65.536 = 6,8 s). Logo o teto que importa é o DA LINHA, e a degradação tem que
// ser LOCAL: só o trecho pesado vira texto cru, o resto continua formatado, na
// ordem, na mesma mensagem.
export const MAX_RICH_TEXT = 262_144
export const MAX_RICH_LINE = 2_048

/** Um pedaço da mensagem na ordem em que a pessoa lê. `cru` é o trecho que não
 *  pode passar pelo parser; `rico` é Markdown de verdade. */
export interface FatiaDaMensagem {
  tipo: "rico" | "cru"
  texto: string
}

/** Varredura sem regex nem cópia, para o caminho comum (nenhuma linha pesada)
 *  não pagar nada além de um passo por caractere. */
function temLinhaPesada(texto: string): boolean {
  let linha = 0
  for (let i = 0; i < texto.length; i++) {
    const code = texto.charCodeAt(i)
    linha = code === 10 || code === 13 ? 0 : linha + 1
    if (linha > MAX_RICH_LINE) return true
  }
  return false
}

/** Abertura de cerca (``` ou ~~~, até 3 espaços de recuo), devolvendo o
 *  marcador para o fecho ter que ser do mesmo tipo e do mesmo tamanho ou maior. */
function aberturaDeCerca(linha: string): string | null {
  const achado = /^ {0,3}(`{3,}|~{3,})/.exec(linha)
  return achado ? achado[1] : null
}

function fechaCerca(linha: string, abertura: string): boolean {
  const achado = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(linha)
  return (
    achado != null &&
    achado[1][0] === abertura[0] &&
    achado[1].length >= abertura.length
  )
}

/** Divide a mensagem em fatias na ORDEM original, cada uma inteira.
 *  `fatias.map(f => f.texto).join("\n")` reconstrói o texto recebido: nada
 *  é reescrito, resumido ou escondido. */
export function fatiasDaMensagem(texto: string): FatiaDaMensagem[] {
  if (texto.length > MAX_RICH_TEXT) return [{ tipo: "cru", texto }]
  if (!temLinhaPesada(texto)) return [{ tipo: "rico", texto }]

  const linhas = texto.split("\n")
  const fatias: { tipo: "rico" | "cru"; linhas: string[] }[] = []
  const empurrar = (tipo: "rico" | "cru", bloco: string[]) => {
    const ultima = fatias[fatias.length - 1]
    if (ultima && ultima.tipo === tipo) ultima.linhas.push(...bloco)
    else fatias.push({ tipo, linhas: bloco })
  }

  let i = 0
  while (i < linhas.length) {
    // A unidade é o bloco de cerca inteiro (senão a marcação de abertura ficaria
    // numa fatia e a de fecho em outra) ou, fora de cerca, a linha sozinha.
    const abertura = aberturaDeCerca(linhas[i])
    let fim = i
    if (abertura) {
      fim = i + 1
      while (fim < linhas.length && !fechaCerca(linhas[fim], abertura)) fim++
      // Cerca sem fecho (resposta ainda chegando) vai até o fim da mensagem.
      if (fim >= linhas.length) fim = linhas.length - 1
    }
    const bloco = linhas.slice(i, fim + 1)
    empurrar(
      bloco.some((linha) => linha.length > MAX_RICH_LINE) ? "cru" : "rico",
      bloco,
    )
    i = fim + 1
  }
  return fatias.map((fatia) => ({ tipo: fatia.tipo, texto: fatia.linhas.join("\n") }))
}
