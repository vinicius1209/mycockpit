/** GraphicsContexts compartilhados dos props (1 tesselação p/ N instâncias).
 *
 *  Geometria portada do spike `office-web/src/App.tsx` — os paths originais só
 *  usam M/m, L, h/v, c/C e Z; aqui foram normalizados para comandos explícitos
 *  (mesmos números) e desenhados via GraphicsPath/SVG string.
 *
 *  A mesa é FATIADA em base + tampo (contexts separados) para o y-sort:
 *  base atrás do avatar, tampo (com monitor/papéis) na frente.
 */
import { Container, Graphics, GraphicsContext, GraphicsPath } from "pixi.js"
import { createSteam, type Steam } from "./effects"

/** Escala do desenho do spike (mesa de 152px de largura) para o mundo em tiles
 *  (footprint 2×2 tiles = 128px de largura na projeção 64×32). */
export const SPIKE_SCALE = 128 / 152

/** Tela do monitor acesa (cor do spike) e apagada (mesa "off"). */
export const SCREEN_ON = 0x73aaa4
export const SCREEN_OFF = 0x243030

type Ctxs = {
  deskBase: GraphicsContext
  deskTop: GraphicsContext
  monitor: GraphicsContext
  /** Tela em geometria BRANCA — tint por instância (acesa/apagada). */
  monitorScreen: GraphicsContext
  mug: GraphicsContext
  plant: GraphicsContext
  /** Cadeira do agent (sentado): encosto (atrás do torso) e assento. */
  chairBack: GraphicsContext
  chairSeat: GraphicsContext
}

let ctxs: Ctxs | null = null

function path(ctx: GraphicsContext, d: string, color: number, alpha = 1): void {
  ctx.path(new GraphicsPath(d)).fill({ color, alpha })
}

function build(): Ctxs {
  // --- mesa: base (laterais + pés) --------------------------------------
  const deskBase = new GraphicsContext()
  // lateral esquerda: "M-76 0 0 39v18l-76-38Z"
  path(deskBase, "M-76 0 L0 39 L0 57 L-76 19 Z", 0x69746c)
  // lateral direita (sombra derivada da esquerda — mesma luz de todo prop)
  path(deskBase, "M76 0 L0 39 L0 57 L76 19 Z", mul(0x69746c, EAST_K))
  // pés: "M-51 27v50l13 7V34ZM51 27v50l-13 7V34Z"
  path(deskBase, "M-51 27 L-51 77 L-38 84 L-38 34 Z M51 27 L51 77 L38 84 L38 34 Z", 0x3a4541)

  // --- mesa: tampo (superfície + papéis) --------------------------------
  const deskTop = new GraphicsContext()
  // tampo: "M-76 0 0-38 76 0 0 39Z"
  path(deskTop, "M-76 0 L0 -38 L76 0 L0 39 Z", 0xd7d0b8)
  // papel 1: "m27-9 24-12 13 7-24 12Z"
  path(deskTop, "M27 -9 L51 -21 L64 -14 L40 -2 Z", 0xf2ead2)
  // papel 2: "m-3 7 29-14 12 6L9 13Z"
  path(deskTop, "M-3 7 L26 -7 L38 -1 L9 13 Z", 0xb9c1b2, 0.8)

  // --- monitor (chassis; tela é context próprio p/ tint on/off) ----------
  const monitor = new GraphicsContext()
  // topo: "m-28-30 43-21 32 16-43 22Z"
  path(monitor, "M-28 -30 L15 -51 L47 -35 L4 -13 Z", 0x1c2225)
  // frente: "m-28-30 32 17v32l-32-17Z"
  path(monitor, "M-28 -30 L4 -13 L4 19 L-28 2 Z", 0x303a3c)
  // pé do monitor: "M4 19v12l13-6V13Z"
  path(monitor, "M4 19 L4 31 L17 25 L17 13 Z", 0x22292b)

  const monitorScreen = new GraphicsContext()
  // tela: "m-22-25 21 11V9L-22-2Z" — branca, tint por instância
  path(monitorScreen, "M-22 -25 L-1 -14 L-1 9 L-22 -2 Z", 0xffffff)

  // --- caneca (prop de idle do avatar) -----------------------------------
  const mug = new GraphicsContext()
  // corpo: "M-9-5h20v18c0 9-20 9-20 0Z"
  path(mug, "M-9 -5 L11 -5 L11 13 C11 22 -9 22 -9 13 Z", 0xe9e1ca)
  // alça: "M11 0c14-2 14 14 0 12" (stroke, sem fill)
  mug
    .moveTo(11, 0)
    .bezierCurveTo(25, -2, 25, 12, 11, 12)
    .stroke({ width: 5, color: 0xe9e1ca, cap: "round" })

  // --- planta decorativa --------------------------------------------------
  const plant = new GraphicsContext()
  // vaso topo: "m-20 0 20-10L20 0 0 11Z"
  path(plant, "M-20 0 L0 -10 L20 0 L0 11 Z", 0xa16c4f)
  // vaso esq: "M-20 0 0 11v30L-20 30Z"
  path(plant, "M-20 0 L0 11 L0 41 L-20 30 Z", 0x7d4e3b)
  // vaso dir (sombra derivada — mesma luz de todo prop)
  path(plant, "M20 0 L0 11 L0 41 L20 30 Z", mul(0x7d4e3b, EAST_K))
  // folhas: "M0-4C-35-13-31-42 0-21 31-49 35-11 5-4 31-9 28 21 0 5-27 23-32-9 0-4Z"
  path(
    plant,
    "M0 -4 C-35 -13 -31 -42 0 -21 C31 -49 35 -11 5 -4 C31 -9 28 21 0 5 C-27 23 -32 -9 0 -4 Z",
    0x657d64,
  )

  // --- cadeira (agent sentado) -------------------------------------------
  // Encosto: roundRect que "espia" atrás do torso (ombros/laterais) + almofada.
  const chairBack = new GraphicsContext()
  chairBack.roundRect(-24, -50, 48, 56, 14).fill({ color: 0x30393b })
  chairBack.roundRect(-20, -46, 40, 48, 11).fill({ color: 0x404c4d })
  const chairSeat = new GraphicsContext()
  chairSeat.roundRect(-24, 3, 48, 13, 6).fill({ color: 0x28302f })
  chairSeat.roundRect(-3, 13, 6, 9, 2).fill({ color: 0x20272a })

  return { deskBase, deskTop, monitor, monitorScreen, mug, plant, chairBack, chairSeat }
}

/** Contexts compartilhados (lazy; sobrevivem ao destroy do stage — HMR-safe). */
export function sharedPropContexts(): Ctxs {
  if (!ctxs) ctxs = build()
  return ctxs
}

// ---------------------------------------------------------------------------
// Fábricas de instância (Graphics leves sobre os contexts compartilhados)
// ---------------------------------------------------------------------------

export function createDeskBase(): Graphics {
  const g = new Graphics(sharedPropContexts().deskBase)
  g.scale.set(SPIKE_SCALE)
  return g
}

export type DeskTop = {
  root: Graphics
  /** Acende/apaga a tela do monitor (mesa "off"). */
  setScreenOn(on: boolean): void
}

export function createDeskTop(): DeskTop {
  const cx = sharedPropContexts()
  const root = new Graphics(cx.deskTop)
  root.scale.set(SPIKE_SCALE)
  const monitor = new Graphics(cx.monitor)
  const screen = new Graphics(cx.monitorScreen)
  screen.tint = SCREEN_ON
  root.addChild(monitor, screen)
  return {
    root,
    setScreenOn(on: boolean) {
      screen.tint = on ? SCREEN_ON : SCREEN_OFF
    },
  }
}

export function createMug(): Graphics {
  return new Graphics(sharedPropContexts().mug)
}

export function createChairBack(): Graphics {
  return new Graphics(sharedPropContexts().chairBack)
}

export function createChairSeat(): Graphics {
  return new Graphics(sharedPropContexts().chairSeat)
}

export function createPlant(): Graphics {
  const g = new Graphics(sharedPropContexts().plant)
  g.scale.set(SPIKE_SCALE)
  return g
}

// ===========================================================================
// PRNG semeado — decoração DETERMINÍSTICA por sala (a sala de um projeto é
// sempre a mesma entre sessões; NUNCA Math.random solto para decorar).
// ===========================================================================

/** Hash FNV-1a 32-bit — semente estável a partir do projectId. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 — PRNG determinístico; retorna função que devolve [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ===========================================================================
// Biblioteca de decoração — geometria em px LOCAIS do spike (root recebe
// SPIKE_SCALE). Base isométrica local: +1 tile world-x = (38, 19),
// +1 tile world-y = (-38, 19) (38·SPIKE_SCALE = 32 = TILE_W/2).
//
// Âncora nos PÉS (padrão do y-sort): origem = centro do footprint no CHÃO
// para props de chão; para props de PAREDE (norte), origem = ponto da BASE da
// parede sob o centro do prop, com o desenho subindo em y negativo já
// cisalhado (y += x/2) para acompanhar a inclinação da parede na projeção.
// Parede oeste = espelho: instância com scale.x = -SPIKE_SCALE.
// ===========================================================================

type Pt = readonly [number, number]

/** Offset em TILES → px locais (dx·U + dy·V). */
function tileToLocal(dx: number, dy: number): Pt {
  return [(dx - dy) * 38, (dx + dy) * 19]
}

/** Cantos do footprint tx×ty tiles centrado na origem (losango no chão). */
function fpCorners(tx: number, ty: number): { n: Pt; e: Pt; s: Pt; w: Pt } {
  const hx = (tx / 2) * 38
  const hy = (tx / 2) * 19
  const kx = (ty / 2) * 38
  const ky = (ty / 2) * 19
  return {
    n: [-hx + kx, -hy - ky],
    e: [hx + kx, hy - ky],
    s: [hx - kx, hy + ky],
    w: [-hx - kx, -hy + ky],
  }
}

function poly(ctx: GraphicsContext, pts: Pt[], color: number, alpha = 1): void {
  ctx.poly(pts.flat() as number[], true).fill({ color, alpha })
}

type BoxColors = { top: number; south: number; east: number }

/** Multiplica cada canal de um hex por `f` (clampado) — luz global barata. */
export function mul(hex: number, f: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * f))
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * f))
  const b = Math.min(255, Math.round((hex & 0xff) * f))
  return (r << 16) | (g << 8) | b
}

/** LUZ ÚNICA (topo-esquerda): a face LESTE (sombra) é sempre a face SUL × este
 *  fator — mesma proporção em TODA peça (§1). ~20% mais escura. */
const EAST_K = 0.78

/** Faces de uma caixa iso a partir do topo (material lit) + face sul; a face
 *  leste é derivada — garante shading idêntico em todos os props. */
function faces(top: number, south: number): BoxColors {
  return { top, south, east: mul(south, EAST_K) }
}

/** Caixa isométrica ancorada no chão: topo + face sul (clara, luz vem de
 *  cima-esquerda) + face leste (escura). `lift` ergue a caixa (empilhar). */
function isoBox(
  ctx: GraphicsContext,
  cxT: number,
  cyT: number,
  tx: number,
  ty: number,
  h: number,
  c: BoxColors,
  lift = 0,
): void {
  const [ox, oy] = tileToLocal(cxT, cyT)
  const { n, e, s, w } = fpCorners(tx, ty)
  const at = (p: Pt, dz: number): Pt => [p[0] + ox, p[1] + oy - lift - dz]
  poly(ctx, [at(w, h), at(s, h), at(s, 0), at(w, 0)], c.south)
  poly(ctx, [at(s, h), at(e, h), at(e, 0), at(s, 0)], c.east)
  poly(ctx, [at(n, h), at(e, h), at(s, h), at(w, h)], c.top)
}

/** Sombra de contato: elipses alpha empilhadas (borda macia sem gradiente). */
function shadow(ctx: GraphicsContext, rx: number, ry: number, cy = 4, alpha = 0.16): void {
  ctx.ellipse(0, cy, rx, ry).fill({ color: 0x11161c, alpha })
  ctx.ellipse(0, cy, rx * 0.62, ry * 0.62).fill({ color: 0x11161c, alpha: alpha * 0.75 })
}

/** Retângulo colado na parede norte: cisalha y += x/2 (inclinação da parede
 *  na projeção). Coords planas: x ao longo da parede, y negativo sobe. */
function wallRect(
  ctx: GraphicsContext,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  alpha = 1,
): void {
  poly(
    ctx,
    [
      [x, y + x / 2],
      [x + w, y + (x + w) / 2],
      [x + w, y + h + (x + w) / 2],
      [x, y + h + x / 2],
    ],
    color,
    alpha,
  )
}

/** Polilinha cisalhada na parede norte (rabiscos/gráficos). */
function wallStroke(ctx: GraphicsContext, pts: Pt[], width: number, color: number, alpha = 1): void {
  const sp = pts.map(([x, y]): Pt => [x, y + x / 2])
  ctx.moveTo(sp[0][0], sp[0][1])
  for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i][0], sp[i][1])
  ctx.stroke({ width, color, alpha, cap: "round", join: "round" })
}

// --- paleta sage da decoração (2 tons por peça; luz de cima-esquerda) -------
const WOOD_TOP = 0xd7d0b8
const WOOD_S = 0x69746c
const WOOD_E = 0x4d5954
const WOOD_LEG = 0x3a4541
const CREAM = 0xf2ead2
const PAPER_SAGE = 0xb9c1b2
const TEAL = 0x73aaa4
const DARK_SCREEN = 0x1c2225
const CHASSIS = 0x303a3c
const POT_TOP = 0xa16c4f
const POT_S = 0x7d4e3b
const POT_E = mul(POT_S, EAST_K) // sombra consistente (§1) — era 0x644035
const LEAF = 0x657d64
const LEAF_DARK = 0x4f6350
const LEAF_LIGHT = 0x7d9478
const SOFA_LIGHT = 0x8db3ac
const SOFA_MID = 0x6f9d98
const METAL_L = 0x9aa39c
const METAL_M = 0x828c85
const METAL_D = 0x666f69
const FRAME_DARK = 0x59645d
const SHADOW_INK = 0x11161c

// ---------------------------------------------------------------------------
// Contexts compartilhados da decoração (1 tesselação p/ N instâncias)
// ---------------------------------------------------------------------------

type DecorCtxs = {
  /** Tapetes em geometria BRANCA — cor por tint na instância. */
  rugSmall: GraphicsContext
  rugLarge: GraphicsContext
  plantA: GraphicsContext
  plantB: GraphicsContext
  plantC: GraphicsContext
  wallArt: GraphicsContext
  whiteboard: GraphicsContext
  wallShelf: GraphicsContext
  bookshelf: GraphicsContext
  filingCabinet: GraphicsContext
  waterCooler: GraphicsContext
  sofa: GraphicsContext
  sofaSmall: GraphicsContext
  coffeeTable: GraphicsContext
  meetingTableBase: GraphicsContext
  meetingTableTop: GraphicsContext
  meetingChair: GraphicsContext
  meetingChairBack: GraphicsContext
  kitchenCounter: GraphicsContext
  coffeeMachine: GraphicsContext
  tv: GraphicsContext
  noticeBoard: GraphicsContext
  clockFace: GraphicsContext
  clockHour: GraphicsContext
  clockMinute: GraphicsContext
}

let decor: DecorCtxs | null = null

/** Tapete: losango branco (tint) com borda e medalhão internos. */
function rugCtx(tx: number, ty: number): GraphicsContext {
  const ctx = new GraphicsContext()
  const ring = (k: number): Pt[] => {
    const { n, e, s, w } = fpCorners(tx * k, ty * k)
    return [n, e, s, w]
  }
  poly(ctx, ring(1), 0xffffff, 0.9)
  ctx.poly(ring(0.82).flat() as number[], true).stroke({ width: 3, color: 0xffffff, alpha: 0.45 })
  poly(ctx, ring(0.3), 0xffffff, 0.2)
  return ctx
}

/** Vaso do spike ancorado nos pés (base em y=0; aro sobe até -51). */
function potInto(ctx: GraphicsContext): void {
  shadow(ctx, 26, 10, 2)
  poly(ctx, [[-20, -41], [0, -51], [20, -41], [0, -30]], POT_TOP)
  poly(ctx, [[-20, -41], [0, -30], [0, 0], [-20, -11]], POT_S)
  poly(ctx, [[20, -41], [0, -30], [0, 0], [20, -11]], POT_E)
}

function plantACtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  potInto(ctx)
  // folhas do spike (4 arcos bezier), erguidas p/ a boca do vaso
  path(
    ctx,
    "M0 -45 C-35 -54 -31 -83 0 -62 C31 -90 35 -52 5 -45 " +
      "C31 -50 28 -20 0 -36 C-27 -18 -32 -50 0 -45 Z",
    LEAF,
  )
  path(ctx, "M0 -46 C-14 -58 -10 -76 1 -63 C6 -55 5 -49 0 -46 Z", LEAF_DARK, 0.45)
  return ctx
}

/** Espada-de-são-jorge: folhas verticais pontudas em 3 tons. */
function plantBCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  potInto(ctx)
  path(ctx, "M-8 -44 Q-26 -56 -28 -74 Q-16 -58 -5 -45 Z", LEAF)
  path(ctx, "M8 -44 Q26 -54 30 -70 Q18 -56 6 -45 Z", LEAF)
  path(ctx, "M-3 -44 Q-18 -66 -14 -92 Q-8 -74 -1 -46 Z", LEAF_DARK)
  path(ctx, "M3 -44 Q16 -62 18 -86 Q10 -68 1 -45 Z", LEAF_DARK)
  path(ctx, "M0 -45 Q1 -75 4 -98 Q8 -72 3 -46 Z", LEAF_LIGHT)
  return ctx
}

/** Arbusto redondo: copa de círculos sobrepostos + tronco fino. */
function plantCCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  potInto(ctx)
  ctx.rect(-1.5, -62, 3, 18).fill({ color: POT_E })
  ctx.ellipse(0, -72, 21, 17).fill({ color: LEAF })
  ctx.circle(-12, -64, 9).fill({ color: LEAF_LIGHT })
  ctx.circle(12, -66, 8).fill({ color: LEAF_LIGHT })
  ctx.circle(0, -84, 10).fill({ color: LEAF_LIGHT })
  ctx.circle(6, -72, 5).fill({ color: LEAF_DARK })
  ctx.circle(-5, -79, 4).fill({ color: LEAF_DARK })
  return ctx
}

/** Quadro decorativo: moldura + passe-partout + arte abstrata simples. */
function wallArtCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  wallRect(ctx, -20, -82, 44, 36, SHADOW_INK, 0.18)
  wallRect(ctx, -22, -84, 44, 36, WOOD_E)
  wallRect(ctx, -19, -81, 38, 30, CREAM)
  // arte: sol teal + colina sage + traço de horizonte
  ctx.circle(-6, -74, 7).fill({ color: TEAL })
  wallStroke(ctx, [[-16, -60], [-4, -70], [6, -62], [16, -68]], 3, LEAF, 0.9)
  wallStroke(ctx, [[-16, -56], [16, -56]], 2, WOOD_S, 0.7)
  return ctx
}

/** Whiteboard com rabiscos: diagrama, lista e gráfico zigue-zague. */
function whiteboardCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  wallRect(ctx, -46, -86, 96, 50, SHADOW_INK, 0.18)
  wallRect(ctx, -48, -88, 96, 50, METAL_L)
  wallRect(ctx, -45, -85, 90, 44, 0xf4f2e8)
  // bandeja de canetas
  wallRect(ctx, -20, -37, 40, 4, METAL_D)
  // rabiscos: caixa+seta, lista de bullets, zigue-zague teal
  wallStroke(ctx, [[-38, -78], [-22, -78], [-22, -68], [-38, -68], [-38, -78]], 2, WOOD_E, 0.8)
  wallStroke(ctx, [[-22, -73], [-10, -73]], 2, WOOD_E, 0.8)
  wallStroke(ctx, [[-13, -75], [-10, -73], [-13, -71]], 2, WOOD_E, 0.8)
  for (const [i, wl] of [14, 10, 12].entries()) {
    ctx.circle(-36, -58 + i * 7 + -36 / 2, 1.4).fill({ color: TEAL })
    wallStroke(ctx, [[-31, -58 + i * 7], [-31 + wl, -58 + i * 7]], 2, WOOD_S, 0.7)
  }
  wallStroke(ctx, [[4, -56], [14, -66], [22, -60], [34, -74]], 2.5, TEAL, 0.9)
  wallStroke(ctx, [[4, -50], [38, -50]], 2, WOOD_S, 0.5)
  return ctx
}

/** Prateleira de parede com livros (um inclinado) + sulista de apoio. */
function wallShelfCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  const hy = -56 // linha da prateleira (coords planas)
  // tampo: linha da parede + profundidade p/ o sul (em direção ao viewer)
  const d: Pt = [-11.4, 5.7] // 0.3 tile em world-y
  poly(
    ctx,
    [
      [-40, hy - 20],
      [40, hy + 20],
      [40 + d[0], hy + 20 + d[1]],
      [-40 + d[0], hy - 20 + d[1]],
    ],
    WOOD_TOP,
  )
  // livros em pé na linha da parede (barras verticais, topo/base cisalhados)
  const books: Array<[number, number, number, number]> = [
    // [x, largura, altura, cor]
    [-36, 6, 18, TEAL],
    [-29, 5, 15, POT_TOP],
    [-23, 6, 20, LEAF],
    [-16, 5, 14, CREAM],
    [4, 6, 17, WOOD_E],
    [11, 5, 13, PAPER_SAGE],
  ]
  for (const [bx, bw, bh, color] of books) wallRect(ctx, bx, hy - bh, bw, bh, color)
  // livro inclinado apoiado na pilha da direita
  poly(
    ctx,
    [
      [18, hy - 2 + 18 / 2],
      [28, hy - 12 + 28 / 2],
      [31, hy - 10 + 31 / 2],
      [21, hy + 21 / 2],
    ],
    POT_S,
  )
  // borda frontal da prateleira (por cima da base dos livros)
  poly(
    ctx,
    [
      [-40 + d[0], hy - 20 + d[1]],
      [40 + d[0], hy + 20 + d[1]],
      [40 + d[0], hy + 24 + d[1]],
      [-40 + d[0], hy - 16 + d[1]],
    ],
    WOOD_S,
  )
  return ctx
}

/** TV de parede: moldura escura + tela apagada com brilho diagonal. */
function tvCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  wallRect(ctx, -48, -90, 100, 54, SHADOW_INK, 0.18)
  wallRect(ctx, -50, -92, 100, 54, CHASSIS)
  wallRect(ctx, -47, -89, 94, 48, DARK_SCREEN)
  // brilho sutil na tela (paralelogramo alpha; coords planas já cisalhadas)
  poly(
    ctx,
    [
      [-38, -99],
      [-20, -94],
      [-6, -81],
      [-24, -86],
    ],
    0xffffff,
    0.05,
  )
  ctx.circle(42, -40 + 42 / 2, 1.6).fill({ color: TEAL })
  return ctx
}

/** Quadro de avisos: cortiça + papéis pinados (um de cada tom). */
function noticeBoardCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  wallRect(ctx, -37, -84, 78, 52, SHADOW_INK, 0.18)
  wallRect(ctx, -39, -86, 78, 52, POT_S)
  wallRect(ctx, -35, -82, 70, 44, 0xb3a07f)
  const papers: Array<[number, number, number, number, number]> = [
    // [x, y, w, h, cor]
    [-29, -76, 12, 14, CREAM],
    [-13, -72, 10, 12, PAPER_SAGE],
    [1, -78, 9, 9, TEAL],
    [14, -70, 14, 10, CREAM],
    [-24, -56, 10, 9, CREAM],
    [8, -56, 9, 11, PAPER_SAGE],
  ]
  for (const [px, py, pw, ph, color] of papers) {
    wallRect(ctx, px, py, pw, ph, color)
    ctx.circle(px + pw / 2, py - 1 + (px + pw / 2) / 2, 1.3).fill({ color: WOOD_E })
  }
  return ctx
}

/** Estante de chão: caixa 1×0.5 tile com 2 fileiras de lombadas + portas. */
function bookshelfCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  shadow(ctx, 34, 12, 6)
  isoBox(ctx, 0, 0, 1, 0.5, 96, faces(WOOD_TOP, WOOD_S))
  // face sul detalhada (coords planas: x -28.5..9.5, chão em y'=9.5)
  wallRect(ctx, -25, -83, 31, 78, 0x333d38) // cavidade
  wallRect(ctx, -25, -57, 31, 3.5, WOOD_S) //  prateleira 1
  wallRect(ctx, -25, -31, 31, 3.5, WOOD_S) //  prateleira 2
  const rowTop: Array<[number, number, number, number]> = [
    [-23, 5, 17, TEAL],
    [-17.5, 4.5, 14, CREAM],
    [-12.5, 5, 18, POT_TOP],
    [-7, 4, 13, PAPER_SAGE],
    [-2.5, 5, 16, LEAF],
  ]
  for (const [bx, bw, bh, c] of rowTop) wallRect(ctx, bx, -57 - bh, bw, bh, c)
  const rowMid: Array<[number, number, number, number]> = [
    [-23, 5, 16, LEAF_DARK],
    [-17, 4.5, 13, PAPER_SAGE],
    [-12, 5, 18, WOOD_E],
    [-6.5, 4.5, 12, CREAM],
    [1, 5, 15, TEAL],
  ]
  for (const [bx, bw, bh, c] of rowMid) wallRect(ctx, bx, -31 - bh, bw, bh, c)
  // fileira de baixo: portas fechadas com puxadores
  wallRect(ctx, -25, -27.5, 31, 22.5, 0x76837b)
  wallStroke(ctx, [[-9.5, -27.5], [-9.5, -5]], 1.5, WOOD_E, 0.8)
  ctx.circle(-12, -22, 1.5).fill({ color: WOOD_E })
  ctx.circle(-7, -19.5, 1.5).fill({ color: WOOD_E })
  return ctx
}

/** Arquivo de escritório: caixa metálica com 3 gavetas e etiqueta. */
function filingCabinetCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  shadow(ctx, 24, 9, 4)
  isoBox(ctx, 0, 0, 0.55, 0.42, 58, faces(METAL_L, METAL_M))
  // gavetas na face sul (coords planas: x -18.4..2.5, chão em y'=8)
  for (const yTop of [-46, -30, -14]) {
    wallRect(ctx, -15.5, yTop, 15, 14, METAL_L)
    wallStroke(ctx, [[-11, yTop + 4], [-3, yTop + 4]], 2, 0x39423d, 0.9)
  }
  wallRect(ctx, -10, -43, 4.5, 3.5, CREAM) // etiqueta da gaveta de cima
  return ctx
}

/** Bebedouro: gabinete claro + garrafão azul translúcido + torneiras. */
function waterCoolerCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  shadow(ctx, 20, 8, 4)
  isoBox(ctx, 0, 0, 0.42, 0.42, 46, faces(0xdcd8c8, 0xc7c3b2))
  // torneiras (azul gelada / vermelha quente) na face sul
  ctx.circle(-9, -42.5, 1.8).fill({ color: 0x5bb8e8 })
  ctx.circle(-5, -39.5, 1.8).fill({ color: 0xc96f62 })
  // garrafão translúcido (2 tons: água + destaque)
  poly(ctx, [[-4, -46], [4, -46], [3, -51], [-3, -51]], 0x9fc9dc, 0.6)
  ctx.ellipse(0, -60, 11, 12).fill({ color: 0x9fc9dc, alpha: 0.55 })
  ctx.ellipse(0, -55, 9.5, 6.5).fill({ color: 0x7fb5cf, alpha: 0.5 })
  ctx.ellipse(-4, -63, 2.5, 5).fill({ color: 0xffffff, alpha: 0.35 })
  return ctx
}

const SOFA_COLORS: BoxColors = faces(SOFA_LIGHT, SOFA_MID)
const CUSHION_COLORS: BoxColors = faces(SOFA_LIGHT, 0x7ea69f)

/** Sofá 2 lugares: encosto + base + braços + 2 almofadas. */
function sofaCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  shadow(ctx, 80, 22, 6)
  // planos FLUSH de propósito (frente do braço = frente da base; traseira do
  // braço/almofada = frente do encosto): borda única, sem moiré de sub-pixel
  isoBox(ctx, 0, -0.3, 1.9, 0.25, 46, SOFA_COLORS) //   encosto
  isoBox(ctx, 0, 0.08, 1.9, 0.7, 18, SOFA_COLORS) //    base
  isoBox(ctx, -0.84, 0.1275, 0.22, 0.605, 34, SOFA_COLORS) // braço oeste
  isoBox(ctx, -0.4, 0.0725, 0.72, 0.495, 10, CUSHION_COLORS, 18)
  isoBox(ctx, 0.42, 0.0725, 0.72, 0.495, 10, CUSHION_COLORS, 18)
  isoBox(ctx, 0.84, 0.1275, 0.22, 0.605, 34, SOFA_COLORS) //  braço leste
  return ctx
}

/** Poltrona (sofá de 1 lugar). */
function sofaSmallCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  shadow(ctx, 48, 16, 6)
  isoBox(ctx, 0, -0.3, 1.0, 0.25, 44, SOFA_COLORS)
  isoBox(ctx, 0, 0.08, 1.0, 0.7, 18, SOFA_COLORS)
  isoBox(ctx, -0.39, 0.1275, 0.22, 0.605, 34, SOFA_COLORS)
  isoBox(ctx, 0.02, 0.0725, 0.56, 0.495, 10, CUSHION_COLORS, 18)
  isoBox(ctx, 0.39, 0.1275, 0.22, 0.605, 34, SOFA_COLORS)
  return ctx
}

/** Mesa de centro baixa com pilha de livros e caneca. */
function coffeeTableCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  shadow(ctx, 52, 15, 4)
  isoBox(ctx, 0, 0, 1.15, 0.6, 26, faces(WOOD_TOP, WOOD_S))
  isoBox(ctx, -0.18, 0.02, 0.28, 0.2, 3, faces(TEAL, 0x5b8a86), 26)
  isoBox(ctx, -0.15, 0.04, 0.2, 0.15, 2.5, faces(POT_TOP, POT_S), 29)
  const [mx, my] = tileToLocal(0.28, -0.02)
  ctx.roundRect(mx - 3, my - 26 - 7, 6, 7, 1.5).fill({ color: CREAM })
  ctx.ellipse(mx, my - 33, 2.9, 1.4).fill({ color: 0x5a4636 })
  return ctx
}

const MEET_LIFT = 74 //  altura do tampo do mesão (px locais)

/** Mesão de reunião — BASE (sombra + 4 pernas), fatia de trás do y-sort. */
function meetingTableBaseCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  shadow(ctx, 130, 36, 8)
  const legColors: BoxColors = faces(WOOD_S, WOOD_LEG)
  for (const [lx, ly] of [
    [-1.55, -0.55],
    [1.55, -0.55],
    [-1.55, 0.55],
    [1.55, 0.55],
  ] as const) {
    isoBox(ctx, lx, ly, 0.16, 0.16, MEET_LIFT - 8, legColors)
  }
  return ctx
}

/** Mesão de reunião — TAMPO (superfície + borda + papéis), fatia da frente. */
function meetingTableTopCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  const { n, e, s, w } = fpCorners(3.7, 1.7)
  const at = (p: Pt, dz: number): Pt => [p[0], p[1] - dz]
  // borda (espessura do tampo) + superfície
  poly(ctx, [at(w, MEET_LIFT), at(s, MEET_LIFT), at(s, MEET_LIFT - 8), at(w, MEET_LIFT - 8)], WOOD_S)
  poly(ctx, [at(s, MEET_LIFT), at(e, MEET_LIFT), at(e, MEET_LIFT - 8), at(s, MEET_LIFT - 8)], mul(WOOD_S, EAST_K))
  poly(ctx, [at(n, MEET_LIFT), at(e, MEET_LIFT), at(s, MEET_LIFT), at(w, MEET_LIFT)], WOOD_TOP)
  // passadeira central escura sutil
  const r = fpCorners(3.3, 0.5)
  poly(ctx, [at(r.n, 74.5), at(r.e, 74.5), at(r.s, 74.5), at(r.w, 74.5)], SHADOW_INK, 0.08)
  // papéis espalhados (2 tons)
  const paperAt = (dx: number, dy: number, sz: number, color: number, alpha = 1): void => {
    const [ox, oy] = tileToLocal(dx, dy)
    const p = fpCorners(sz, sz * 0.75)
    poly(
      ctx,
      [
        [p.n[0] + ox, p.n[1] + oy - 74.6],
        [p.e[0] + ox, p.e[1] + oy - 74.6],
        [p.s[0] + ox, p.s[1] + oy - 74.6],
        [p.w[0] + ox, p.w[1] + oy - 74.6],
      ],
      color,
      alpha,
    )
  }
  paperAt(-1.1, 0.05, 0.34, CREAM)
  paperAt(-0.95, 0.12, 0.3, PAPER_SAGE, 0.85)
  paperAt(0.25, -0.18, 0.32, CREAM)
  paperAt(1.05, 0.16, 0.3, PAPER_SAGE, 0.85)
  return ctx
}

/** Cadeira de reunião avulsa (voltada pro sul; espelhe com scale.x). */
function meetingChairCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  shadow(ctx, 22, 8, 3)
  const seatColors: BoxColors = faces(0x475354, 0x3a4547)
  // pernas visíveis (oeste, sul, leste) do assento até o chão
  for (const [px, py] of [
    [-13.5, 0],
    [0, 6.8],
    [13.5, 0],
  ] as const) {
    ctx.moveTo(px, py - 23)
      .lineTo(px, py - 1)
      .stroke({ width: 4, color: 0x232b2d, cap: "round" })
  }
  isoBox(ctx, 0, 0, 0.42, 0.42, 7, seatColors, 22)
  // encosto ALTO (crista acima do tampo do mesão — senão a fileira norte
  // desaparece atrás da mesa erguida)
  isoBox(ctx, 0, -0.16, 0.42, 0.09, 40, seatColors, 29)
  return ctx
}

/** Cadeira de reunião DE COSTAS (voltada pro norte — encosto pro viewer;
 *  lado sul do mesão. Espelhe com scale.x pra cabeceira leste). */
function meetingChairBackCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  shadow(ctx, 22, 8, 3)
  const seatColors: BoxColors = faces(0x475354, 0x3a4547)
  // pernas visíveis (oeste, norte, leste); a do sul some atrás do encosto
  for (const [px, py] of [
    [-13.5, 0],
    [0, -6.8],
    [13.5, 0],
  ] as const) {
    ctx.moveTo(px, py - 23)
      .lineTo(px, py - 1)
      .stroke({ width: 4, color: 0x232b2d, cap: "round" })
  }
  isoBox(ctx, 0, 0, 0.42, 0.42, 7, seatColors, 22)
  // encosto no lado SUL — é a face que o viewer vê; cobre parte do assento
  // (mesma crista alta da variante de frente)
  isoBox(ctx, 0, 0.16, 0.42, 0.09, 38, seatColors, 28)
  return ctx
}

/** Altura do tampo da bancada (px locais do spike) — a cafeteira POUSA nessa
 *  cota quando o layout a coloca num tile da bancada (ver rooms.ts). */
export const KITCHEN_COUNTER_TOP = 56

/** Bancada de cozinha: gabinete + tampo claro com pia e torneira na metade
 *  SUL — a metade norte do tampo fica livre pra cafeteira pousar. */
function kitchenCounterCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  shadow(ctx, 84, 22, 6)
  isoBox(ctx, 0, 0, 2, 0.8, KITCHEN_COUNTER_TOP, faces(0xe3ddc6, 0x7f8b80))
  // portas na face sul (coords planas: x -53.2..22.8, chão em y'=15.2)
  wallRect(ctx, -48, -36, 30, 32, 0x8a968b)
  wallRect(ctx, -14, -36, 30, 32, 0x8a968b)
  ctx.circle(-20.5, -30.25, 1.6).fill({ color: 0x39423d })
  ctx.circle(-11.5, -25.75, 1.6).fill({ color: 0x39423d })
  // pia rebaixada no tampo + torneira
  const [sx, sy] = tileToLocal(0.5, 0)
  const rim = fpCorners(0.55, 0.45)
  const basin = fpCorners(0.45, 0.35)
  poly(ctx, [rim.n, rim.e, rim.s, rim.w].map(([x, y]): Pt => [x + sx, y + sy - 56]), 0xb9beb0)
  poly(ctx, [basin.n, basin.e, basin.s, basin.w].map(([x, y]): Pt => [x + sx, y + sy - 55]), 0x9aa79c)
  const [fx, fy] = tileToLocal(0.5, -0.28)
  ctx.moveTo(fx, fy - 56)
    .lineTo(fx, fy - 66)
    .quadraticCurveTo(fx - 5, fy - 68, fx - 6, fy - 63)
    .stroke({ width: 2.5, color: METAL_D, cap: "round" })
  // tábua de corte pequena colada na pia (a metade norte é da cafeteira)
  isoBox(ctx, 0.16, 0.28, 0.34, 0.26, 2.5, faces(0xc9b189, 0xa98f66), KITCHEN_COUNTER_TOP)
  return ctx
}

/** Máquina de café de bancada: torre + cabeçote, bandeja e xícara. */
function coffeeMachineCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  shadow(ctx, 14, 5, 2)
  const body: BoxColors = faces(0x3a4446, CHASSIS)
  isoBox(ctx, 0, -0.06, 0.3, 0.16, 30, body) //   torre traseira
  isoBox(ctx, 0, 0, 0.3, 0.28, 9, body, 21) //    cabeçote sobre a xícara
  // bandeja + xícara
  const tray = fpCorners(0.2, 0.16)
  const [tx0, ty0] = tileToLocal(0, 0.08)
  poly(ctx, [tray.n, tray.e, tray.s, tray.w].map(([x, y]): Pt => [x + tx0, y + ty0 - 2]), 0x22292b)
  const [cxp, cyp] = tileToLocal(0, 0.09)
  ctx.roundRect(cxp - 2.5, cyp - 9, 5, 7, 1).fill({ color: CREAM })
  ctx.ellipse(cxp, cyp - 9, 2.5, 1.2).fill({ color: 0xe0d8c0 })
  // luzes do cabeçote
  ctx.circle(-6, -25, 1.5).fill({ color: TEAL })
  ctx.circle(-2.5, -23.5, 1.2).fill({ color: CREAM })
  return ctx
}

/** Mostrador do relógio de parede (plano — vive num container com skew). */
function clockFaceCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
  ctx.circle(0, 0, 15).fill({ color: CREAM })
  ctx.circle(0, 0, 15).stroke({ width: 3, color: FRAME_DARK })
  for (const [tx0, ty0, tx1, ty1] of [
    [0, -11, 0, -13],
    [11, 0, 13, 0],
    [0, 11, 0, 13],
    [-11, 0, -13, 0],
  ] as const) {
    ctx.moveTo(tx0, ty0).lineTo(tx1, ty1).stroke({ width: 1.8, color: WOOD_E })
  }
  return ctx
}

function clockHourCtx(): GraphicsContext {
  return new GraphicsContext()
    .moveTo(0, 2)
    .lineTo(0, -7)
    .stroke({ width: 3, color: 0x2e3835, cap: "round" })
}

function clockMinuteCtx(): GraphicsContext {
  const ctx = new GraphicsContext()
    .moveTo(0, 2.5)
    .lineTo(0, -11)
    .stroke({ width: 2, color: 0x2e3835, cap: "round" })
  ctx.circle(0, 0, 1.8).fill({ color: 0x2e3835 })
  return ctx
}

function buildDecor(): DecorCtxs {
  return {
    rugSmall: rugCtx(1.7, 1.7),
    rugLarge: rugCtx(3.4, 2.2),
    plantA: plantACtx(),
    plantB: plantBCtx(),
    plantC: plantCCtx(),
    wallArt: wallArtCtx(),
    whiteboard: whiteboardCtx(),
    wallShelf: wallShelfCtx(),
    bookshelf: bookshelfCtx(),
    filingCabinet: filingCabinetCtx(),
    waterCooler: waterCoolerCtx(),
    sofa: sofaCtx(),
    sofaSmall: sofaSmallCtx(),
    coffeeTable: coffeeTableCtx(),
    meetingTableBase: meetingTableBaseCtx(),
    meetingTableTop: meetingTableTopCtx(),
    meetingChair: meetingChairCtx(),
    meetingChairBack: meetingChairBackCtx(),
    kitchenCounter: kitchenCounterCtx(),
    coffeeMachine: coffeeMachineCtx(),
    tv: tvCtx(),
    noticeBoard: noticeBoardCtx(),
    clockFace: clockFaceCtx(),
    clockHour: clockHourCtx(),
    clockMinute: clockMinuteCtx(),
  }
}

/** Contexts compartilhados da decoração (lazy — HMR-safe como os da mesa). */
export function sharedDecorContexts(): DecorCtxs {
  if (!decor) decor = buildDecor()
  return decor
}

// ---------------------------------------------------------------------------
// Fábricas de instância da decoração (Graphics leves sobre contexts
// compartilhados; todas com SPIKE_SCALE e âncora nos pés). Props de parede
// são da parede NORTE; parede oeste = espelho (scale.x = -SPIKE_SCALE).
// ---------------------------------------------------------------------------

function decorGraphics(ctx: GraphicsContext): Graphics {
  const g = new Graphics(ctx)
  g.scale.set(SPIKE_SCALE)
  return g
}

export type RugSize = "small" | "large"

/** Tapete (geometria branca): passe a cor da sala via `color`/tint. */
export function createRug(size: RugSize, color?: string | number): Graphics {
  const cx = sharedDecorContexts()
  const g = decorGraphics(size === "small" ? cx.rugSmall : cx.rugLarge)
  if (color !== undefined) g.tint = color
  return g
}

export type PlantVariant = "a" | "b" | "c"
export const PLANT_VARIANTS: readonly PlantVariant[] = ["a", "b", "c"]

/** Planta decorativa: a=arcos do spike, b=espada, c=arbusto redondo. */
export function createPlantVariant(variant: PlantVariant): Graphics {
  const cx = sharedDecorContexts()
  const ctx = variant === "a" ? cx.plantA : variant === "b" ? cx.plantB : cx.plantC
  return decorGraphics(ctx)
}

export function createWallArt(): Graphics {
  return decorGraphics(sharedDecorContexts().wallArt)
}

export function createWhiteboard(): Graphics {
  return decorGraphics(sharedDecorContexts().whiteboard)
}

export function createWallShelf(): Graphics {
  return decorGraphics(sharedDecorContexts().wallShelf)
}

export function createBookshelf(): Graphics {
  return decorGraphics(sharedDecorContexts().bookshelf)
}

export function createFilingCabinet(): Graphics {
  return decorGraphics(sharedDecorContexts().filingCabinet)
}

export function createWaterCooler(): Graphics {
  return decorGraphics(sharedDecorContexts().waterCooler)
}

export function createSofa(): Graphics {
  return decorGraphics(sharedDecorContexts().sofa)
}

export function createSofaSmall(): Graphics {
  return decorGraphics(sharedDecorContexts().sofaSmall)
}

export function createCoffeeTable(): Graphics {
  return decorGraphics(sharedDecorContexts().coffeeTable)
}

/** Fatia de TRÁS do mesão (pernas + sombra) — mesma âncora do tampo. */
export function createMeetingTableBase(): Graphics {
  return decorGraphics(sharedDecorContexts().meetingTableBase)
}

/** Fatia da FRENTE do mesão (tampo + papéis) — posicione no MESMO ponto
 *  da base; o y-sort intercala avatares entre as fatias como na mesa. */
export function createMeetingTableTop(): Graphics {
  return decorGraphics(sharedDecorContexts().meetingTableTop)
}

export function createMeetingChair(): Graphics {
  return decorGraphics(sharedDecorContexts().meetingChair)
}

/** Cadeira de costas (encosto pro viewer) — lado sul/cabeceira do mesão. */
export function createMeetingChairBack(): Graphics {
  return decorGraphics(sharedDecorContexts().meetingChairBack)
}

export function createKitchenCounter(): Graphics {
  return decorGraphics(sharedDecorContexts().kitchenCounter)
}

export function createTv(): Graphics {
  return decorGraphics(sharedDecorContexts().tv)
}

export function createNoticeBoard(): Graphics {
  return decorGraphics(sharedDecorContexts().noticeBoard)
}

export type CoffeeMachine = {
  root: Container
  /** Vapor exposto (efeito compartilhado): chame steam.tick(t, fase, rm). */
  steam: Steam
}

/** Máquina de café (ancorada nos próprios pés — pouse sobre bancada/mesa). */
export function createCoffeeMachine(): CoffeeMachine {
  const root = new Container()
  root.scale.set(SPIKE_SCALE)
  const body = new Graphics(sharedDecorContexts().coffeeMachine)
  const steam = createSteam()
  steam.root.position.set(-3, -36)
  steam.root.scale.set(0.9)
  root.addChild(body, steam.root)
  return { root, steam }
}

export type WallClock = {
  root: Container
  /** Ponteiros com pivot no centro do mostrador — gire com a hora real
   *  (rotation em rad; na parede oeste espelhada, negue a rotação). */
  hourHand: Graphics
  minuteHand: Graphics
}

/** Relógio de parede: mostrador plano dentro de um container com skew que o
 *  deita no plano da parede norte — os ponteiros giram nesse plano. */
export function createWallClock(): WallClock {
  const cx = sharedDecorContexts()
  const root = new Container()
  root.scale.set(SPIKE_SCALE)
  const plane = new Container()
  plane.skew.y = Math.atan(0.5)
  plane.position.set(0, -88)
  const face = new Graphics(cx.clockFace)
  const hourHand = new Graphics(cx.clockHour)
  const minuteHand = new Graphics(cx.clockMinute)
  plane.addChild(face, hourHand, minuteHand)
  root.addChild(plane)
  return { root, hourHand, minuteHand }
}
