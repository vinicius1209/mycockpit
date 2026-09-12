// ADR-184: o parser GFM tenta reconhecer email em cada ponto de uma linha
// de progresso. No incidente Maclan, 142.976 pontos prenderam o parse por 32s.
// A janela de nós do chat não limita o custo de UMA mensagem.
export const MAX_RICH_TEXT = 16_384
export const MAX_RICH_LINE = 2_048
export const TEXT_PAGE_SIZE = 4_096

/** Guarda anterior ao parser e ao highlight, sem regex nem cópia do texto. */
export function needsPlainText(text: string): boolean {
  if (text.length > MAX_RICH_TEXT) return true
  let line = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    line = code === 10 || code === 13 ? 0 : line + 1
    if (line > MAX_RICH_LINE) return true
  }
  return false
}

// Desloca a fronteira para depois do par UTF-16, sem perder nem repetir emoji.
function boundary(text: string, offset: number): number {
  const code = text.charCodeAt(offset)
  const previous = text.charCodeAt(offset - 1)
  return code >= 0xdc00 && code <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff
    ? offset + 1
    : offset
}

export function plainTextPage(text: string, requested: number) {
  const count = Math.max(1, Math.ceil(text.length / TEXT_PAGE_SIZE))
  const page = Math.max(0, Math.min(requested, count - 1))
  return {
    page,
    count,
    text: text.slice(
      boundary(text, page * TEXT_PAGE_SIZE),
      boundary(text, Math.min(text.length, (page + 1) * TEXT_PAGE_SIZE)),
    ),
  }
}
