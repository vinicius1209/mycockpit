// Geometria da janela flutuante do navegador (navegador PRD R2): regras puras,
// testadas sem DOM. A janela mora DENTRO do cartão central e nunca sai dele;
// por padrão não cobre o composer.

export interface Geometria {
  x: number
  y: number
  w: number
  h: number
}

/** Menor janela que ainda mostra barra e quadro legíveis. */
export const MINIMO = { w: 320, h: 220 }
/** Folga até a borda do cartão. */
export const MARGEM = 12
/** Tira de abas no topo do cartão: a janela nasce abaixo dela. */
export const TOPO = 44
/** Faixa de baixo reservada ao composer na posição padrão. */
export const RESERVA_DO_COMPOSER = 190

/** Onde a janela nasce: canto superior direito, sem descer até o composer. */
export function geometriaInicial(largura: number, altura: number): Geometria {
  const w = Math.min(520, largura - 2 * MARGEM)
  const h = Math.min(340, altura - TOPO - RESERVA_DO_COMPOSER)
  return encaixarNoCartao(
    { x: largura - w - MARGEM, y: TOPO, w, h },
    largura,
    altura,
  )
}

/** Prende a janela ao cartão: tamanho entre o mínimo e o cartão, posição sem
 *  vazar. Cartão menor que o mínimo vence o mínimo (a janela encolhe junto). */
export function encaixarNoCartao(g: Geometria, largura: number, altura: number): Geometria {
  const maxW = Math.max(0, largura - 2 * MARGEM)
  const maxH = Math.max(0, altura - 2 * MARGEM)
  const w = Math.min(Math.max(g.w, Math.min(MINIMO.w, maxW)), maxW)
  const h = Math.min(Math.max(g.h, Math.min(MINIMO.h, maxH)), maxH)
  const x = Math.min(Math.max(g.x, MARGEM), largura - MARGEM - w)
  const y = Math.min(Math.max(g.y, MARGEM), altura - MARGEM - h)
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

/** De onde a pessoa puxa a janela: as quatro bordas e os quatro cantos. */
export type Borda = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"

const entre = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max))

/** Redimensiona puxando `borda` por (dx, dy). A borda oposta fica parada: puxar
 *  a esquerda não empurra a direita, e o mínimo trava a borda puxada em vez de
 *  deslizar a janela. Antes só o canto de baixo à direita redimensionava, e
 *  sem nada visível (pedido de 23/09/2026: "seria legal eu poder
 *  redimensionar"). */
export function redimensionar(
  g0: Geometria,
  borda: Borda,
  dx: number,
  dy: number,
  largura: number,
  altura: number,
): Geometria {
  const minW = Math.min(MINIMO.w, Math.max(0, largura - 2 * MARGEM))
  const minH = Math.min(MINIMO.h, Math.max(0, altura - 2 * MARGEM))
  const direita = g0.x + g0.w
  const baixo = g0.y + g0.h
  let { x, y, w, h } = g0
  if (borda.includes("e")) w = entre(g0.w + dx, minW, largura - MARGEM - g0.x)
  if (borda.includes("w")) {
    x = entre(g0.x + dx, MARGEM, direita - minW)
    w = direita - x
  }
  if (borda.includes("s")) h = entre(g0.h + dy, minH, altura - MARGEM - g0.y)
  if (borda.includes("n")) {
    y = entre(g0.y + dy, MARGEM, baixo - minH)
    h = baixo - y
  }
  return encaixarNoCartao({ x, y, w, h }, largura, altura)
}
