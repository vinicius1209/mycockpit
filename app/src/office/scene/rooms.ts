/** Planta visual a partir do FloorPlan (§3): piso por sala no tom do spike,
 *  corredor, paredes norte/oeste ALTAS (fundo), sul/leste BAIXAS, placa com o
 *  nome/cor do projeto, luz da porta (agregado da sala) — e agora a DECORAÇÃO
 *  PROCEDURAL do layout (tapete na cor do projeto, plantas variadas, props de
 *  chão/parede), a SALA COMUM (reunião+lounge+cozinha), o corredor decorado,
 *  relógio de parede na hora real, vapor da cafeteira, poeira na luminária e o
 *  DECALQUE do nome do projeto pintado no piso da entrada.
 *
 *  Cenário estático = Graphics batchado SEM cacheAsTexture (O6/§7). Estados
 *  dinâmicos (placa, luz da porta) são objetos próprios fora de qualquer cache.
 *  Segmentos que podem ocluir atores (parede norte das salas da fileira de
 *  baixo, rodapés sul/leste, móveis) vão para a camada dinâmica com zIndex
 *  próprio — o stage os insere. Animação SÓ transform/alpha; decoração 100%
 *  determinística (posições vêm prontas do layout; fases locais por hashSeed).
 */
import { Container, Graphics, Matrix, Text } from "pixi.js"
import {
  T_WALK,
  TILE_H,
  TILE_W,
  type FloorPlan,
  type OfficeSnapshot,
  type RoomAggregate,
  type RoomDecorItem,
  type RoomMission,
  type RoomPlacement,
  type Vec2,
} from "@/lib/fleet/types"
import { toScreen } from "../engine/iso"
import {
  deskAnchorWorld,
  doorLightColor,
  doorLightPulses,
  LABEL_LOD_MIN_ZOOM,
  quantizeZIndex,
  type ThemeTokens,
} from "./logic"
import {
  KITCHEN_COUNTER_TOP,
  SPIKE_SCALE,
  createBookshelf,
  createChairBack,
  createChairSeat,
  createCoffeeMachine,
  createCoffeeTable,
  createDeliveryPile,
  createExecutiveChair,
  createExecutiveDeskBase,
  createExecutiveDeskTop,
  createExecutiveSideboard,
  createExecutiveVisitorChair,
  createFilingCabinet,
  createKitchenCounter,
  createMeetingChair,
  createMeetingChairBack,
  createMeetingTableBase,
  createMeetingTableTop,
  createMovingBoxes,
  createNoticeBoard,
  createPlantVariant,
  createRug,
  createSofa,
  createSofaSmall,
  createTv,
  createWallArt,
  createWallClock,
  createWallShelf,
  createWaterCooler,
  createWhiteboard,
  hashSeed,
  mulberry32,
  type CoffeeMachine,
  type DeliveryPile,
  type WallClock,
} from "./props"
import { createAmbientMotes, type AmbientFx } from "./effects"
import {
  DAYLIGHT,
  KANBAN_COLORS,
  MOVING_BOX_MS,
  dayPhase,
  deliveryPileCount,
  formatTvUsd,
  kanbanCardRects,
  movingBoxAlpha,
  tvStats,
  type DayPhase,
} from "./environment"

/** Multiplica cada canal de um hex por `f` (clampado) — luz global barata. */
function mulHex(hex: number, f: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * f))
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * f))
  const b = Math.min(255, Math.round((hex & 0xff) * f))
  return (r << 16) | (g << 8) | b
}

// ---------------------------------------------------------------------------
// Paleta do cenário — HIERARQUIA DE VALORES (§3): o CHÃO é o plano mais claro
// (a sala é o palco), as PAREDES são mais frias/escuras que o chão (recuam) e
// os móveis ganham contraste contra o piso. Luz única do topo-esquerda.
// ---------------------------------------------------------------------------
const C_SLAB = 0x394946
const C_ROOM_FLOOR = 0xb3c19e // sage claro: área produtiva
const C_BOSS_FLOOR = 0xb9b7a2 // pedra oliva neutra: diretoria
const C_COMMONS_FLOOR = 0xc5bfa4 // pedra quente: área social, leitura imediata
const C_ROOM_EDGE = 0x65766d
const C_CORRIDOR = 0x71827b // circulação deliberadamente mais escura que salas
const C_GRID_LINE = 0x7c8d7f
const C_WALL_WEST = 0xa5b0ac // paredes neutras/frias, separadas do piso verde
const C_WALL_NORTH = 0xb4beb9
const C_WALL_EDGE = 0x4b5956
const C_WALL_TOP = 0x263532
const C_SKIRT = 0x44534f
/** Sombra de contato/encosto pintada no piso (base das paredes norte/oeste). */
const C_CONTACT = 0x2a332f
const C_LAMP = 0xffe79b
/** Tint neutro do tapete até o snapshot trazer a cor do projeto. */
const C_RUG_NEUTRAL = 0x86937f

const WALL_H = 96 // px de cena (parede alta)
const SKIRT_H = 12 // px de cena (parede baixa)
/** Parede cruza o ponto de ordenação nos pés, não no centro do sprite. */
const WALL_OCCLUSION_BIAS = TILE_H / 2 - 1

const FONT_SANS = "Geist Variable, ui-sans-serif, system-ui, sans-serif"

/** Espelhos LOCAIS de stage.ts (scene/rooms não importa stage — ciclo):
 *  assento do agent = âncora da mesa 50px de tela acima (AGENT_BEHIND_DY) e
 *  zIndex do avatar = âncora + 6 (AGENT_ZBIAS). A cadeira vazia da mesa "off"
 *  ocupa exatamente o lugar/sanduíche do sentado que o pack esconde. */
const SEAT_DY = 50
const SEAT_ZBIAS = 6

// ---------------------------------------------------------------------------
// Memória de MÓDULO das salas já vistas (caixas de mudança): sobrevive à
// recriação do stage (troca de modo/HMR). 1ª criação = boot (sem caixas);
// sala que aparece DEPOIS ganha caixas por ~2min (MOVING_BOX_MS).
// ---------------------------------------------------------------------------
const roomsEverSeen = new Set<string>()
const movingBoxSince = new Map<string, number>()

/** Reset p/ testes (mesmo padrão do _resetDeriveState do bridge). */
export function _resetRoomsAmbientState(): void {
  roomsEverSeen.clear()
  movingBoxSince.clear()
}

/** Footprints em tiles da decoração — espelho LOCAL do contrato do layout
 *  (scene/ não importa bridge/; ver DECOR_FOOTPRINTS em bridge/layout.ts).
 *  `tile` do item = canto NW; ausente ⇒ 1×1. */
const DECOR_FP: Record<string, { w: number; h: number }> = {
  rug: { w: 3, h: 2 },
  "rug-large": { w: 4, h: 3 },
  "meeting-table": { w: 4, h: 2 },
  "executive-chair": { w: 2, h: 1 },
  "executive-sideboard": { w: 1, h: 2 },
  "executive-visitor-chair": { w: 1, h: 1 },
  sofa: { w: 2, h: 1 },
  "kitchen-counter": { w: 2, h: 1 },
}
/** Kinds pendurados na parede: tile na LINHA DE PAREDE; âncora na base. */
const WALL_KINDS = new Set(["wall-art", "whiteboard", "shelf", "tv", "notice-board"])
const RUG_KINDS = new Set(["rug", "rug-large"])

function textResolution(): number {
  return typeof devicePixelRatio === "number" ? Math.min(devicePixelRatio, 2) : 1
}

type Iv = { a: number; b: number }

/** Subtrai os vãos de porta [x, x+1) do intervalo [a, b) — puro e simples. */
function splitIntervals(a: number, b: number, doors: number[]): Iv[] {
  const sorted = [...doors].sort((p, q) => p - q)
  const out: Iv[] = []
  let cur = a
  for (const d of sorted) {
    if (d >= b || d + 1 <= a) continue
    if (d > cur) out.push({ a: cur, b: d })
    cur = Math.max(cur, d + 1)
  }
  if (cur < b) out.push({ a: cur, b })
  return out
}

function tileDiamond(g: Graphics, x: number, y: number, color: number, alpha = 1): void {
  const p0 = toScreen(x, y)
  const p1 = toScreen(x + 1, y)
  const p2 = toScreen(x + 1, y + 1)
  const p3 = toScreen(x, y + 1)
  g.poly([p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y]).fill({ color, alpha })
}

/** Parede vertical entre dois pontos de MUNDO, erguida `h` px de cena.
 *  `baseboard` pinta um RODAPÉ fino (faixa levemente mais clara na base) —
 *  só nas paredes altas (§4). */
function wallQuad(g: Graphics, a: Vec2, b: Vec2, h: number, color: number, baseboard = false): void {
  const p1 = toScreen(a.x, a.y)
  const p2 = toScreen(b.x, b.y)
  g.poly([p1.x, p1.y, p2.x, p2.y, p2.x, p2.y - h, p1.x, p1.y - h]).fill({ color })
  if (baseboard) {
    const bh = 7 // altura do rodapé (px de cena)
    g.poly([p1.x, p1.y, p2.x, p2.y, p2.x, p2.y - bh, p1.x, p1.y - bh]).fill({
      color: mulHex(color, 1.1),
    })
  }
  g.moveTo(p1.x, p1.y - h)
    .lineTo(p2.x, p2.y - h)
    .stroke({ width: 5, color: C_WALL_TOP, cap: "round" })
  g.moveTo(p1.x, p1.y).lineTo(p2.x, p2.y).stroke({ width: 2, color: C_WALL_EDGE })
}

/** Glow falso: elipses alpha empilhadas (O6 — sem filtros/gradientes). */
function glowStack(color: number, rx: number, ry: number): { root: Container; layers: Graphics[] } {
  const root = new Container()
  const layers: Graphics[] = []
  for (const [s, a] of [
    [1, 0.08],
    [0.66, 0.1],
    [0.36, 0.14],
  ] as const) {
    const g = new Graphics()
    g.ellipse(0, 0, rx, ry).fill({ color: 0xffffff })
    g.scale.set(s)
    g.alpha = a
    g.tint = color
    layers.push(g)
    root.addChild(g)
  }
  return { root, layers }
}

/** Piso de sala/commons: base + MICRO-TEXTURA (xadrez determinístico ±2% por
 *  tile, pré-computado uma vez) + SOMBRA DE ENCOSTO nas paredes norte/oeste +
 *  linhas de grade sutis. Tudo no mesmo Graphics estático (batchado, O6). */
function roomFloor(o: Vec2, w: number, h: number, color: number): Graphics {
  const g = new Graphics()
  const f0 = toScreen(o.x, o.y)
  const f1 = toScreen(o.x + w, o.y)
  const f2 = toScreen(o.x + w, o.y + h)
  const f3 = toScreen(o.x, o.y + h)
  g.poly([f0.x, f0.y, f1.x, f1.y, f2.x, f2.y, f3.x, f3.y])
    .fill({ color })
    .stroke({ width: 2, color: C_ROOM_EDGE })

  // micro-textura: cada tile levemente + ou − claro (xadrez), pré-desenhado —
  // dá "respiro" ao piso sem custo em runtime (é estático)
  const lite = mulHex(color, 1.02)
  const dark = mulHex(color, 0.98)
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      tileDiamond(g, o.x + tx, o.y + ty, (tx + ty) % 2 === 0 ? lite : dark)
    }
  }

  // sombra de encosto: o piso escurece num degrau de 0.5 tile junto às paredes
  // ALTAS (norte em y=o.y, oeste em x=o.x) — assenta a sala contra a parede
  const band = (pts: number[]): void => {
    g.poly(pts).fill({ color: C_CONTACT, alpha: 0.16 })
  }
  const n0 = toScreen(o.x, o.y)
  const n1 = toScreen(o.x + w, o.y)
  const nd0 = toScreen(o.x, o.y + 0.5)
  const nd1 = toScreen(o.x + w, o.y + 0.5)
  band([n0.x, n0.y, n1.x, n1.y, nd1.x, nd1.y, nd0.x, nd0.y])
  const wd0 = toScreen(o.x + 0.5, o.y)
  const wd1 = toScreen(o.x + 0.5, o.y + h)
  band([n0.x, n0.y, wd0.x, wd0.y, wd1.x, wd1.y, f3.x, f3.y])

  for (let gx = 1; gx < w; gx++) {
    const a = toScreen(o.x + gx, o.y)
    const b = toScreen(o.x + gx, o.y + h)
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: C_GRID_LINE, alpha: 0.2 })
  }
  for (let gy = 1; gy < h; gy++) {
    const a = toScreen(o.x, o.y + gy)
    const b = toScreen(o.x + w, o.y + gy)
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: C_GRID_LINE, alpha: 0.2 })
  }
  return g
}

// ---------------------------------------------------------------------------
// Decalque no chão — nome do projeto pintado no piso da entrada (identificação
// de relance). Texto deitado na projeção iso via matrix (base x→(1,.5),
// y→(-1,.5)); pill escura sutil por baixo p/ contraste no piso sage.
// ---------------------------------------------------------------------------

type FloorDecal = {
  root: Container
  setInfo(name: string, color?: string): void
}

function createFloorDecal(wx: number, wy: number, initial: string, tint?: string | number): FloorDecal {
  const root = new Container()
  const anchor = toScreen(wx, wy)
  const pill = new Graphics()
  const text = new Text({
    text: initial.toUpperCase(),
    style: {
      fontFamily: FONT_SANS,
      fontSize: 30,
      fontWeight: "700",
      fill: 0xffffff,
      letterSpacing: 2.5,
    },
    resolution: textResolution(),
  })
  text.anchor.set(0.5)
  if (tint !== undefined) text.tint = tint
  root.addChild(pill, text)
  const refit = (): void => {
    // deita o texto no plano do chão; nomes longos encolhem p/ caber na sala
    const k = Math.min(0.62, 330 / Math.max(1, text.width))
    root.setFromMatrix(new Matrix(k, k * 0.5, -k, k * 0.5, anchor.x, anchor.y))
    const w = text.width + 44
    const h = text.height + 14
    pill.clear()
    pill.roundRect(-w / 2, -h / 2, w, h, h / 2).fill({ color: 0x11161c, alpha: 0.26 })
  }
  refit()
  return {
    root,
    setInfo(name, color) {
      const up = name.toUpperCase()
      if (up === text.text && color === undefined) return
      text.text = up
      if (color !== undefined) text.tint = color
      refit()
    },
  }
}

// ---------------------------------------------------------------------------
// Fábricas por kind (contexts compartilhados de props.ts)
// ---------------------------------------------------------------------------

function createFloorProp(kind: string): Graphics | null {
  switch (kind) {
    case "plant-a":
      return createPlantVariant("a")
    case "plant-b":
      return createPlantVariant("b")
    case "plant-c":
      return createPlantVariant("c")
    case "filing-cabinet":
      return createFilingCabinet()
    case "bookshelf":
      return createBookshelf()
    case "water-cooler":
      return createWaterCooler()
    case "sofa-small":
      return createSofaSmall()
    case "sofa":
      return createSofa()
    case "coffee-table":
      return createCoffeeTable()
    case "executive-chair":
      return createExecutiveChair()
    case "executive-sideboard":
      return createExecutiveSideboard()
    case "executive-visitor-chair":
      return createExecutiveVisitorChair()
    case "meeting-chair":
      return createMeetingChair()
    case "meeting-chair-back":
      return createMeetingChairBack()
    case "kitchen-counter":
      return createKitchenCounter()
    default:
      return null
  }
}

function createWallProp(kind: string): Graphics | null {
  switch (kind) {
    case "wall-art":
      return createWallArt()
    case "whiteboard":
      return createWhiteboard()
    case "shelf":
      return createWallShelf()
    case "tv":
      return createTv()
    case "notice-board":
      return createNoticeBoard()
    default:
      return null
  }
}

type RoomBits = {
  room: RoomPlacement
  plateText: Text
  plateStrip: Graphics
  /** Placa de nome na parede norte — SÓ no zoom-out (marco de wayfinding).
   *  No zoom-in some: o decalque do piso já identifica a sala e a placa
   *  COLIDIA com os pills das mesas da fileira de trás. */
  plate: Container
  doorLight: { root: Container; layers: Graphics[] }
  agg: RoomAggregate
  /** Tapetes da sala — tint pela cor do projeto (setRoomInfo). */
  rugs: Graphics[]
  /** Decalque do nome no piso da entrada. */
  decal: FloorDecal
  /** Kanban da missão no whiteboard da sala (ausente = sala sem whiteboard).
   *  layer cobre os rabiscos baked e desenha os cartões; pulse é o véu do
   *  cartão running (alpha animado no tick). key = dif discreto. */
  kanban?: { layer: Graphics; pulse: Graphics; key: string; hasRunning: boolean }
}

export type DynamicItem = { container: Container; zIndex: number }

export type RoomsView = {
  /** Conteúdo estático — vai para o floorLayer. */
  staticRoot: Container
  /** Segmentos que ocluem atores (paredes/rodapés/móveis) — dynamicLayer. */
  dynamicItems: DynamicItem[]
  /** Nome/cor do projeto na placa (vem do snapshot; plan só tem geometria). */
  setRoomInfo(projectId: string, name: string, color?: string): void
  /** Luz da porta pelo agregado (hand=âmbar pulsando, running=azul, idle=verde). */
  setRoomAggregate(projectId: string, agg: RoomAggregate): void
  /** LOD das placas de parede: visíveis só no zoom-out (early-return por zoom). */
  setLod(zoom: number): void
  /** AMBIENTE ← snapshot (dif discreto, chamado do applySnapshot do stage —
   *  nunca por frame): TV da sala comum (custo total + top-3), kanban da
   *  missão nos whiteboards, cadeira vazia das mesas "off" e pilha de entregas
   *  na mesa do boss. `opts.bossPile` permite ao chamador passar o contador
   *  unseenDeliveries do ui/store quando o pack missão o publicar; sem ele o
   *  fallback são os bossDeliveries do snapshot (TTL 30s do derive). */
  applyAmbient(s: OfficeSnapshot, opts?: { bossPile?: number }): void
  tick(timeSec: number, reducedMotion: boolean): void
  destroy(): void
}

export function createRoomsView(plan: FloorPlan, tokens: ThemeTokens): RoomsView {
  const staticRoot = new Container()
  const dynamicItems: DynamicItem[] = []
  const bits = new Map<string, RoomBits>()

  // vida ambiente da decoração (tudo transform/alpha, fase determinística)
  const ambient: AmbientFx[] = []
  const steams: { machine: CoffeeMachine; phase: number }[] = []
  const clocks: { clock: WallClock; mirrored: boolean }[] = []
  let clockSec = -1
  const setClocks = (): void => {
    const d = new Date()
    const mins = d.getMinutes() + d.getSeconds() / 60
    const hr = (((d.getHours() % 12) + mins / 60) / 12) * Math.PI * 2
    const mn = (mins / 60) * Math.PI * 2
    for (const c of clocks) {
      c.clock.hourHand.rotation = c.mirrored ? -hr : hr
      c.clock.minuteHand.rotation = c.mirrored ? -mn : mn
    }
  }

  // --- AMBIENTE: estado do prédio vivo (dia/noite, TV, kanban, caixas, off) --
  /** Quads de tint por sala (prisma piso+paredes) — só tint/alpha por fase. */
  const daylightOverlays: Graphics[] = []
  /** Luminárias (glowStacks) com os alphas BASE — boost/tint por fase. */
  const lampGlows: { layers: Graphics[]; baseAlphas: number[] }[] = []
  /** Caixas de mudança vivas (fade controlado no tick, 1×/s). */
  const movingBoxes: { g: Graphics; born: number }[] = []
  /** Cadeira vazia por mesa (visível SÓ com a mesa "off"). */
  const emptyChairs = new Map<string, Container>()
  let bossPile: DeliveryPile | null = null
  /** Tela viva da TV da sala comum (plano cisalhado na parede norte). */
  let tvScreen: { text: Text; bars: Graphics; key: string } | null = null
  let currentDayPhase: DayPhase | null = null
  let daylightMinute = -1

  // caixas de mudança: memória de módulo — sala nova DEPOIS do boot
  // (__officeDebugMovingBoxes força caixas em todas — só p/ o loop visual)
  {
    const boot = roomsEverSeen.size === 0
    const force = Boolean(
      (globalThis as { __officeDebugMovingBoxes?: unknown }).__officeDebugMovingBoxes,
    )
    const now = Date.now()
    for (const room of plan.rooms) {
      if (!roomsEverSeen.has(room.projectId)) {
        roomsEverSeen.add(room.projectId)
        if (!boot) movingBoxSince.set(room.projectId, now)
      }
      if (force) movingBoxSince.set(room.projectId, now)
    }
    for (const [id, born] of movingBoxSince) {
      if (now - born >= MOVING_BOX_MS) movingBoxSince.delete(id)
    }
  }

  /** Cisalha coords planas de parede (y += x/2) — mesmo plano do wallRect dos
   *  props; desenha um retângulo do kanban no Graphics dado. */
  const wallCard = (g: Graphics, x: number, y: number, w: number, h: number): Graphics =>
    g.poly([x, y + x / 2, x + w, y + (x + w) / 2, x + w, y + h + (x + w) / 2, x, y + h + x / 2])

  /** Overlay pousado SOBRE um prop de parede: Container irmão no mesmo parent,
   *  copiando position/scale (Graphics não aceita filhos no Pixi v8). */
  const overlayOnWallProp = (node: Graphics): Container => {
    const holder = new Container()
    holder.position.copyFrom(node.position)
    holder.scale.copyFrom(node.scale)
    // onWallProp roda DEPOIS do addWallNode ⇒ o prop sempre tem parent
    ;(node.parent ?? staticRoot).addChild(holder)
    return holder
  }

  /** Redesenho DISCRETO do kanban (só quando a key muda): cobre os rabiscos
   *  baked com a superfície branca e desenha um cartão por fase (done=verde,
   *  running=azul pulsante, queued=cinza). Sem missão ⇒ limpa (rabiscos voltam). */
  const drawKanban = (
    k: NonNullable<RoomBits["kanban"]>,
    mission: RoomMission | undefined,
  ): void => {
    k.layer.clear()
    k.pulse.clear()
    k.hasRunning = false
    k.pulse.alpha = 0
    if (!mission || mission.phases.length === 0) return
    // superfície limpa por cima dos rabiscos do context compartilhado
    wallCard(k.layer, -45, -85, 90, 44).fill({ color: 0xf4f2e8 })
    const rects = kanbanCardRects(mission.phases.length)
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]
      const status = mission.phases[i].status
      wallCard(k.layer, r.x, r.y, r.w, r.h).fill({ color: KANBAN_COLORS[status] })
      // fase corrente: risco de base (legível em zoom médio, sem texto)
      if (i === mission.current) {
        wallCard(k.layer, r.x, r.y + r.h + 2, r.w, 2).fill({ color: 0x2e3835, alpha: 0.8 })
      }
      if (status === "running") {
        k.hasRunning = true
        wallCard(k.pulse, r.x, r.y, r.w, r.h).fill({ color: 0xffffff })
      }
    }
  }

  /** Quad de tint da sala: silhueta do prisma (piso + paredes até WALL_H),
   *  fill branco UMA vez — por fase só tint/alpha (nunca re-tesselar). */
  const addDaylightOverlay = (o: Vec2, w: number, h: number): void => {
    const g = new Graphics()
    const n = toScreen(o.x, o.y)
    const e = toScreen(o.x + w, o.y)
    const s = toScreen(o.x + w, o.y + h)
    const wc = toScreen(o.x, o.y + h)
    g.poly([
      wc.x, wc.y,
      s.x, s.y,
      e.x, e.y,
      e.x, e.y - WALL_H,
      n.x, n.y - WALL_H,
      wc.x, wc.y - WALL_H,
    ]).fill({ color: 0xffffff })
    g.visible = false
    // acima de TODO o conteúdo da sala (tinta atores junto — é luz, não parede)
    dynamicItems.push({ container: g, zIndex: quantizeZIndex(s.y + TILE_H) })
    daylightOverlays.push(g)
  }

  /** Aplica a fase do dia REAL: overlays por sala, tint do corredor/laje e
   *  luminárias (boost+âmbar à noite). Chamada 1×/min no tick. */
  const applyDaylight = (phase: DayPhase): void => {
    if (phase === currentDayPhase) return
    currentDayPhase = phase
    const spec = DAYLIGHT[phase]
    for (const g of daylightOverlays) {
      g.visible = spec.overlayAlpha > 0
      g.tint = spec.overlayColor
      g.alpha = spec.overlayAlpha
    }
    ground.tint = spec.groundTint
    for (const lamp of lampGlows) {
      for (let i = 0; i < lamp.layers.length; i++) {
        lamp.layers[i].alpha = Math.min(1, lamp.baseAlphas[i] * spec.lampBoost)
        lamp.layers[i].tint = spec.lampTint
      }
    }
  }

  /** Renderiza uma lista de decor do layout. BLOQUEIO já veio aplicado na
   *  grid — aqui só desenho: chão na camada dinâmica (zIndex dos pés),
   *  parede via `addWallNode` (estático ou container oclusor por-tile). */
  const renderDecorItems = (
    items: readonly RoomDecorItem[],
    opts: {
      /** Linha de CHÃO (world-y) da parede norte dos props de parede. */
      wallFloorY: number
      addWallNode: (tileX: number, node: Container) => void
      /** Coletor de tapetes (tint da cor do projeto via setRoomInfo). */
      rugs?: Graphics[]
      /** Tint fixo dos tapetes (sala comum — sem cor de projeto). */
      rugTint?: number
      /** Coletor de props de PAREDE já posicionados (kanban no whiteboard,
       *  TV viva) — chamado após anexar o node. */
      onWallProp?: (kind: string, node: Graphics) => void
    },
  ): void => {
    for (const item of items) {
      const fp = DECOR_FP[item.kind] ?? { w: 1, h: 1 }
      // offset VISUAL em tiles (encaixe fino de conjunto) — grid não muda
      const off = item.offset ?? { x: 0, y: 0 }
      const cx = item.tile.x + fp.w / 2 + off.x
      const cy = item.tile.y + fp.h / 2 + off.y

      if (WALL_KINDS.has(item.kind)) {
        const node = createWallProp(item.kind)
        if (!node) continue
        const p = toScreen(item.tile.x + 0.5 + off.x, opts.wallFloorY)
        node.position.set(p.x, p.y)
        if (item.flip) node.scale.x = -SPIKE_SCALE
        opts.addWallNode(item.tile.x, node)
        opts.onWallProp?.(item.kind, node)
        continue
      }

      if (RUG_KINDS.has(item.kind)) {
        const g = createRug(item.kind === "rug" ? "small" : "large")
        const p = toScreen(cx, cy)
        g.position.set(p.x, p.y)
        g.alpha = 0.55
        g.tint = opts.rugTint ?? C_RUG_NEUTRAL
        staticRoot.addChild(g) // camada de chão — não oclui
        opts.rugs?.push(g)
        continue
      }

      if (item.kind === "meeting-table") {
        // fatiado como a mesa: base (pernas) atrás, tampo na frente — quem
        // circula pelo norte fica entre as fatias no y-sort
        const p = toScreen(cx, cy)
        const base = createMeetingTableBase()
        base.position.set(p.x, p.y)
        dynamicItems.push({ container: base, zIndex: quantizeZIndex(p.y - fp.h * TILE_H) })
        const top = createMeetingTableTop()
        top.position.set(p.x, p.y)
        dynamicItems.push({ container: top, zIndex: quantizeZIndex(p.y + TILE_H / 2) })
        continue
      }

      if (item.kind === "coffee-machine") {
        // âncora nos pés da máquina, POUSADA no tampo da bancada — o layout
        // garante um kitchen-counter sob este tile; zIndex logo à frente da
        // bancada (centro dela fica 1 tile ao sul), atrás de quem circula
        const p = toScreen(cx, cy)
        const machine = createCoffeeMachine()
        machine.root.position.set(p.x, p.y - KITCHEN_COUNTER_TOP * SPIKE_SCALE)
        dynamicItems.push({
          container: machine.root,
          zIndex: quantizeZIndex(p.y + TILE_H) + 1,
        })
        steams.push({
          machine,
          phase: mulberry32(hashSeed(`steam|${item.tile.x},${item.tile.y}`))() * 1.8,
        })
        continue
      }

      const g = createFloorProp(item.kind)
      if (!g) continue
      const p = toScreen(cx, cy)
      g.position.set(p.x, p.y)
      // Footprints mais altos que largos pertencem à parede oeste; o espelho
      // troca x↔y do mundo. A bancada 2×1 da copa fica sem espelho, alinhada à
      // parede norte.
      const mirror = fp.h > fp.w
      if (Boolean(item.flip) !== mirror) g.scale.x = -SPIKE_SCALE
      // cadeira de costas enfiada sob o mesão: desenha ENTRE as fatias (na
      // frente da base/pernas, atrás do tampo) — o tampo cobre o assento
      const z =
        item.kind === "meeting-chair-back"
          ? quantizeZIndex(p.y - TILE_H)
          : quantizeZIndex(p.y)
      dynamicItems.push({ container: g, zIndex: z })
    }
  }

  // --- fundação por zona + corredor (um Graphics estático batchado) --------
  const ground = new Graphics()
  const commons = plan.commonRoom
  const bossRoom = plan.bossRoom
  const insideRoom = (x: number, y: number): boolean =>
    plan.rooms.some(
      (r) => x >= r.origin.x && x < r.origin.x + r.w && y >= r.origin.y && y < r.origin.y + r.h,
    )
  const insideCommons = (x: number, y: number): boolean =>
    commons !== undefined &&
    x >= commons.origin.x &&
    x < commons.origin.x + commons.w &&
    y >= commons.origin.y &&
    y < commons.origin.y + commons.h
  const insideBoss = (x: number, y: number): boolean =>
    bossRoom !== undefined &&
    x >= bossRoom.origin.x &&
    x < bossRoom.origin.x + bossRoom.w &&
    y >= bossRoom.origin.y &&
    y < bossRoom.origin.y + bossRoom.h
  // tiles do corredor BLOQUEADOS por decoração continuam recebendo piso
  // (senão o bebedouro flutua num buraco de laje)
  const corridorPropTiles = new Set<string>()
  for (const it of plan.corridorDecor ?? []) {
    if (!WALL_KINDS.has(it.kind) && !RUG_KINDS.has(it.kind))
      corridorPropTiles.add(`${it.tile.x},${it.tile.y}`)
  }

  // A fundação antiga usava o retângulo máximo plan.w×plan.h. Em projeção
  // isométrica isso criava enormes asas escuras sem piso, lidas como salas
  // vazias. A máscara abaixo acompanha só a planta real e dilata um tile para
  // sustentar paredes/rodapés; grid 0 dentro de salas continua incluída porque
  // pode conter mobiliário.
  const floorTiles = new Set<string>()
  for (let y = 0; y < plan.h; y++) {
    for (let x = 0; x < plan.w; x++) {
      const flags = plan.grid[y * plan.w + x]
      const structural =
        insideRoom(x, y) ||
        insideCommons(x, y) ||
        insideBoss(x, y) ||
        (flags & T_WALK) !== 0 ||
        corridorPropTiles.has(`${x},${y}`)
      if (structural) floorTiles.add(`${x},${y}`)
    }
  }
  const supportTiles = new Set(floorTiles)
  for (const key of floorTiles) {
    const [x, y] = key.split(",").map(Number)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const sx = x + dx
        const sy = y + dy
        if (sx >= 0 && sx < plan.w && sy >= 0 && sy < plan.h) {
          supportTiles.add(`${sx},${sy}`)
        }
      }
    }
  }
  // Espessura deslocada para baixo e, depois, o topo contínuo. O topo fecha
  // as antigas valas pretas nos tiles de parede; pisos claros o cobrem adiante.
  for (const key of supportTiles) {
    const [x, y] = key.split(",").map(Number)
    const p0 = toScreen(x, y)
    const p1 = toScreen(x + 1, y)
    const p2 = toScreen(x + 1, y + 1)
    const p3 = toScreen(x, y + 1)
    ground
      .poly([
        p0.x,
        p0.y + 14,
        p1.x,
        p1.y + 14,
        p2.x,
        p2.y + 14,
        p3.x,
        p3.y + 14,
      ])
      .fill({ color: C_SLAB })
    tileDiamond(ground, x, y, C_SLAB)
  }

  for (let y = 0; y < plan.h; y++) {
    for (let x = 0; x < plan.w; x++) {
      const flags = plan.grid[y * plan.w + x]
      const walk = (flags & T_WALK) !== 0 || corridorPropTiles.has(`${x},${y}`)
      if (!walk) continue
      if (insideRoom(x, y) || insideCommons(x, y) || insideBoss(x, y)) continue
      // mesma micro-textura xadrez do piso das salas (respiro do corredor)
      tileDiamond(ground, x, y, (x + y) % 2 === 0 ? mulHex(C_CORRIDOR, 1.02) : mulHex(C_CORRIDOR, 0.98))
    }
  }
  staticRoot.addChild(ground)

  // --- salas ---------------------------------------------------------------
  for (const room of plan.rooms) {
    const { origin: o, w, h, row } = room

    staticRoot.addChild(roomFloor(o, w, h, C_ROOM_FLOOR))

    // luz quente da sala (elipses alpha — glow de lâmpada do spike)
    const lampCenter = toScreen(o.x + w / 2, o.y + h / 2)
    const lamp = glowStack(C_LAMP, (w * TILE_W) / 3.2, (h * TILE_H) / 2.6)
    lamp.root.position.set(lampCenter.x, lampCenter.y)
    for (const l of lamp.layers) l.alpha *= 0.6
    staticRoot.addChild(lamp.root)
    lampGlows.push({ layers: lamp.layers, baseAlphas: lamp.layers.map((l) => l.alpha) })

    const doorXs = room.doorTiles.map((d) => d.x)

    // paredes ALTAS: oeste sempre; norte estática na fileira de cima,
    // OCLUSORA (camada dinâmica) na fileira de baixo — corredor fica atrás dela
    const westWall = new Graphics()
    wallQuad(westWall, { x: o.x, y: o.y }, { x: o.x, y: o.y + h }, WALL_H, C_WALL_WEST, true)
    staticRoot.addChild(westWall)

    // Fileira de baixo: além do vão da porta, a parede oclusora é fatiada POR
    // TILE. Mesmo com as estações recuadas, um segmento longo (zIndex único no
    // meio) poderia ficar à frente de um avatar numa ponta e atrás na outra.
    // Por-tile o y-sort local permanece correto para qualquer aproximação.
    const northSegs =
      row === 1
        ? splitIntervals(o.x, o.x + w, doorXs).flatMap((iv) => {
            const tiles: Iv[] = []
            for (let x = iv.a; x < iv.b; x++) tiles.push({ a: x, b: x + 1 })
            return tiles
          })
        : [{ a: o.x, b: o.x + w }]
    const northContainers: Container[] = []
    const wallTileByX = new Map<number, Container>()
    for (const seg of northSegs) {
      const g = new Graphics()
      wallQuad(g, { x: seg.a, y: o.y }, { x: seg.b, y: o.y }, WALL_H, C_WALL_NORTH, true)
      const c = new Container()
      c.addChild(g)
      northContainers.push(c)
      if (row === 1) {
        const mid = toScreen((seg.a + seg.b) / 2, o.y)
        dynamicItems.push({ container: c, zIndex: quantizeZIndex(mid.y) })
        wallTileByX.set(seg.a, c)
      } else {
        staticRoot.addChild(c)
      }
    }

    // rodapés BAIXOS: sul (com vão de porta na fileira de cima) + leste
    const southSegs =
      row === 0 ? splitIntervals(o.x, o.x + w, doorXs) : [{ a: o.x, b: o.x + w }]
    for (const seg of southSegs) {
      const g = new Graphics()
      wallQuad(g, { x: seg.a, y: o.y + h }, { x: seg.b, y: o.y + h }, SKIRT_H, C_SKIRT)
      const mid = toScreen((seg.a + seg.b) / 2, o.y + h)
      dynamicItems.push({ container: g, zIndex: quantizeZIndex(mid.y) })
    }
    const eastSkirt = new Graphics()
    wallQuad(
      eastSkirt,
      { x: o.x + w, y: o.y },
      { x: o.x + w, y: o.y + h },
      SKIRT_H,
      C_SKIRT,
    )
    const eastMid = toScreen(o.x + w, o.y + h / 2)
    dynamicItems.push({ container: eastSkirt, zIndex: quantizeZIndex(eastMid.y) })

    // --- decoração procedural da sala (posições prontas do layout) --------
    const rugs: Graphics[] = []
    let whiteboardNode: Graphics | null = null
    renderDecorItems(room.decor ?? [], {
      wallFloorY: o.y,
      addWallNode: (x, node) => {
        // fileira de baixo: pendura no segmento oclusor do MESMO tile (o
        // y-sort da parede carrega o prop junto); fileira de cima: estático
        const holder = row === 1 ? wallTileByX.get(x) : null
        if (holder) holder.addChild(node)
        else staticRoot.addChild(node)
      },
      rugs,
      onWallProp: (kind, node) => {
        if (kind === "whiteboard" && !whiteboardNode) whiteboardNode = node
      },
    })

    // kanban da missão no whiteboard (se a sala tem um): overlay irmão em
    // coords LOCAIS do prop (mesma escala/flip) — desenho só no applyAmbient
    let kanban: RoomBits["kanban"]
    if (whiteboardNode) {
      const holder = overlayOnWallProp(whiteboardNode)
      const layer = new Graphics()
      const pulse = new Graphics()
      pulse.alpha = 0
      holder.addChild(layer, pulse)
      kanban = { layer, pulse, key: "", hasRunning: false }
    }

    // cadeira vazia por mesa (mesa "off"): ocupa o lugar exato do sentado que
    // o pack esconde — levemente girada/afastada (alguém saiu); sem caneca
    // por construção (a caneca é prop do avatar). Toggle no applyAmbient.
    for (const desk of room.desks) {
      const a = deskAnchorWorld(desk.tile)
      const as = toScreen(a.x, a.y)
      const chair = new Container()
      chair.scale.set(SPIKE_SCALE)
      if (desk.flip) chair.scale.x = -SPIKE_SCALE
      chair.addChild(createChairBack(), createChairSeat())
      chair.rotation = (desk.flip ? -1 : 1) * 0.09
      chair.position.set(as.x + (desk.flip ? -4 : 4), as.y - SEAT_DY + 3)
      chair.visible = false
      dynamicItems.push({ container: chair, zIndex: quantizeZIndex(as.y + SEAT_ZBIAS) })
      emptyChairs.set(desk.id, chair)
    }

    // caixas de mudança: sala que entrou DEPOIS do boot fica ~2min com caixas
    // de papelão perto da porta (fade no tick; memória de módulo acima)
    const boxBorn = movingBoxSince.get(room.projectId)
    if (boxBorn !== undefined) {
      const g = createMovingBoxes()
      const doorX = room.doorTiles[0]?.x ?? o.x + w / 2
      // dentro da sala, ao lado do vão (não bloqueia nada — é só visual)
      const bx = Math.max(o.x + 1, Math.min(o.x + w - 1.4, doorX + 1.6))
      const by = row === 0 ? o.y + h - 1.1 : o.y + 1.3
      const p = toScreen(bx, by)
      g.position.set(p.x, p.y)
      dynamicItems.push({ container: g, zIndex: quantizeZIndex(p.y) })
      movingBoxes.push({ g, born: boxBorn })
    }

    // poeira flutuando no facho da luminária (vida sutil determinística)
    const motes = createAmbientMotes(hashSeed(`motes|${room.projectId}`), 150, 90)
    motes.root.position.set(lampCenter.x, lampCenter.y - 104)
    staticRoot.addChild(motes.root)
    ambient.push(motes)

    // decalque do nome no piso da ENTRADA (identificação de relance; o texto
    // real chega via setRoomInfo — placeholder = projectId)
    const decal = createFloorDecal(
      o.x + w / 2,
      o.y + h - 1.6,
      room.projectId,
    )
    staticRoot.addChild(decal.root)

    // placa do projeto na parede norte (nome/cor via setRoomInfo)
    const plate = new Container()
    const plateBg = new Graphics()
    plateBg.roundRect(0, 0, 150, 34, 8).fill({ color: 0x0b1018, alpha: 0.9 })
    plateBg.roundRect(0, 0, 150, 34, 8).stroke({ width: 1.5, color: 0xffffff, alpha: 0.14 })
    const plateStrip = new Graphics()
    plateStrip.roundRect(6, 6, 5, 22, 2.5).fill({ color: 0xffffff })
    plateStrip.tint = tokens.brass
    const plateText = new Text({
      text: room.projectId,
      style: { fontFamily: FONT_SANS, fontSize: 14, fontWeight: "600", fill: 0xe7e8ea },
      resolution: textResolution(),
    })
    plateText.position.set(18, 8)
    plate.addChild(plateBg, plateStrip, plateText)
    const plateAnchor = toScreen(o.x + w / 2, o.y)
    plate.position.set(plateAnchor.x - 75, plateAnchor.y - WALL_H + 14)
    if (row === 1 && northContainers.length > 0) {
      // fileira de baixo: a placa acompanha o segmento oclusor de MAIOR zIndex
      // (o mais a leste) — senão os tiles de parede desenhados depois cobrem-na
      northContainers[northContainers.length - 1].addChild(plate)
    } else {
      staticRoot.addChild(plate)
    }

    // luz da porta (agregado da sala) — no chão, sob os atores
    const doorCenter =
      room.doorTiles.length > 0
        ? {
            x: room.doorTiles.reduce((s, d) => s + d.x + 0.5, 0) / room.doorTiles.length,
            y: room.doorTiles.reduce((s, d) => s + d.y + 0.5, 0) / room.doorTiles.length,
          }
        : { x: o.x + w / 2, y: row === 0 ? o.y + h : o.y }
    const dl = glowStack(0xffffff, TILE_W * 0.9, TILE_H * 0.9)
    const dp = toScreen(doorCenter.x, doorCenter.y)
    dl.root.position.set(dp.x, dp.y)
    staticRoot.addChild(dl.root)

    const b: RoomBits = { room, plateText, plateStrip, plate, doorLight: dl, agg: "idle", rugs, decal, kanban }
    for (const l of dl.layers) l.tint = doorLightColor("idle", tokens)
    bits.set(room.projectId, b)

    addDaylightOverlay(o, w, h)
  }

  // --- diretoria (sala física do usuário/boss) ---------------------------
  if (bossRoom) {
    const { origin: o, w, h } = bossRoom
    staticRoot.addChild(roomFloor(o, w, h, C_BOSS_FLOOR))

    const lampCenter = toScreen(o.x + w / 2, o.y + h / 2)
    const lamp = glowStack(C_LAMP, (w * TILE_W) / 3.4, (h * TILE_H) / 2.8)
    lamp.root.position.set(lampCenter.x, lampCenter.y)
    for (const l of lamp.layers) l.alpha *= 0.48
    staticRoot.addChild(lamp.root)
    lampGlows.push({ layers: lamp.layers, baseAlphas: lamp.layers.map((l) => l.alpha) })

    const north = new Graphics()
    wallQuad(north, { x: o.x, y: o.y }, { x: o.x + w, y: o.y }, WALL_H, C_WALL_NORTH, true)
    staticRoot.addChild(north)
    const west = new Graphics()
    wallQuad(west, { x: o.x, y: o.y }, { x: o.x, y: o.y + h }, WALL_H, C_WALL_WEST, true)
    staticRoot.addChild(west)

    const doorXs = bossRoom.doorTiles.map((d) => d.x)
    for (const seg of splitIntervals(o.x, o.x + w, doorXs)) {
      const south = new Graphics()
      wallQuad(south, { x: seg.a, y: o.y + h }, { x: seg.b, y: o.y + h }, SKIRT_H, C_SKIRT)
      const mid = toScreen((seg.a + seg.b) / 2, o.y + h)
      dynamicItems.push({ container: south, zIndex: quantizeZIndex(mid.y) })
    }
    const east = new Graphics()
    wallQuad(east, { x: o.x + w, y: o.y }, { x: o.x + w, y: o.y + h }, SKIRT_H, C_SKIRT)
    const eastMid = toScreen(o.x + w, o.y + h / 2)
    dynamicItems.push({ container: east, zIndex: quantizeZIndex(eastMid.y) })

    renderDecorItems(bossRoom.decor, {
      wallFloorY: o.y,
      addWallNode: (_x, node) => staticRoot.addChild(node),
      rugTint: 0xc58a42,
    })

    // Estação executiva 4×2 fatiada como as mesas dos agents. A cadeira alta
    // fica atrás da base; visitantes e boss passam à frente do tampo via y-sort.
    const anchor = {
      x: bossRoom.deskTile.x + bossRoom.deskFootprint.w / 2,
      y: bossRoom.deskTile.y + bossRoom.deskFootprint.h / 2,
    }
    const dp = toScreen(anchor.x, anchor.y)
    const base = createExecutiveDeskBase()
    base.position.set(dp.x, dp.y)
    dynamicItems.push({ container: base, zIndex: quantizeZIndex(dp.y + 2) })
    const top = createExecutiveDeskTop()
    top.position.set(dp.x, dp.y)
    dynamicItems.push({ container: top, zIndex: quantizeZIndex(dp.y + TILE_H / 2) })

    // pilha de entregas no braço OESTE livre do tampo em L (o monitor/teclado
    // vivem em x≈-0.5 e o gaveteiro embaixo em -1.25 — ver furniture spec);
    // contagem via applyAmbient (unseenDeliveries/bossDeliveries)
    const pile = createDeliveryPile()
    const pp = toScreen(anchor.x - 1.35, anchor.y - 0.3)
    pile.root.position.set(pp.x, pp.y)
    dynamicItems.push({ container: pile.root, zIndex: quantizeZIndex(dp.y + TILE_H / 2) + 1 })
    bossPile = pile

    const decal = createFloorDecal(o.x + w / 2, o.y + h - 1.55, "Sala do Boss", tokens.brass)
    staticRoot.addChild(decal.root)

    addDaylightOverlay(o, w, h)
  }

  // --- sala comum (reunião + lounge + cozinha) ----------------------------
  if (commons) {
    const { origin: o, w, h } = commons

    staticRoot.addChild(roomFloor(o, w, h, C_COMMONS_FLOOR))

    const lampCenter = toScreen(o.x + w / 2, o.y + h / 2)
    const lamp = glowStack(C_LAMP, (w * TILE_W) / 3.2, (h * TILE_H) / 2.6)
    lamp.root.position.set(lampCenter.x, lampCenter.y)
    for (const l of lamp.layers) l.alpha *= 0.6
    staticRoot.addChild(lamp.root)
    lampGlows.push({ layers: lamp.layers, baseAlphas: lamp.layers.map((l) => l.alpha) })

    // parede norte alta (estática — a sala comum é a mais a leste)
    const north = new Graphics()
    wallQuad(north, { x: o.x, y: o.y }, { x: o.x + w, y: o.y }, WALL_H, C_WALL_NORTH, true)
    staticRoot.addChild(north)

    // parede OESTE alta com o VÃO da porta (2 tiles, vertical, dá pro corredor)
    const doorYs = commons.doorTiles.map((d) => d.y).sort((a, b) => a - b)
    const gapA = doorYs[0] ?? o.y
    const gapB = (doorYs[doorYs.length - 1] ?? o.y) + 1
    for (const seg of [
      { a: o.y, b: gapA },
      { a: gapB, b: o.y + h },
    ]) {
      if (seg.b <= seg.a) continue
      // Um item por tile: o corredor fica atrás da parede e o interior à
      // frente dela conforme o personagem cruza o vão da porta.
      for (let y = seg.a; y < seg.b; y++) {
        const g = new Graphics()
        wallQuad(g, { x: o.x, y }, { x: o.x, y: y + 1 }, WALL_H, C_WALL_WEST, true)
        const mid = toScreen(o.x, y + 0.5)
        dynamicItems.push({
          container: g,
          zIndex: quantizeZIndex(mid.y + WALL_OCCLUSION_BIAS),
        })
      }
    }

    // rodapés sul + leste (dinâmicos — ocluem quem circula por fora)
    const southSkirt = new Graphics()
    wallQuad(southSkirt, { x: o.x, y: o.y + h }, { x: o.x + w, y: o.y + h }, SKIRT_H, C_SKIRT)
    const southMid = toScreen(o.x + w / 2, o.y + h)
    dynamicItems.push({ container: southSkirt, zIndex: quantizeZIndex(southMid.y) })
    const eastSkirt = new Graphics()
    wallQuad(eastSkirt, { x: o.x + w, y: o.y }, { x: o.x + w, y: o.y + h }, SKIRT_H, C_SKIRT)
    const eastMid = toScreen(o.x + w, o.y + h / 2)
    dynamicItems.push({ container: eastSkirt, zIndex: quantizeZIndex(eastMid.y) })

    // Postes finos fecham visualmente os quatro encontros de parede. Nos
    // cantos NE/SW também deixam explícita a transição parede alta→rodapé,
    // evitando o aspecto de painéis soltos.
    const addCornerPost = (wx: number, wy: number, height: number): void => {
      const p = toScreen(wx, wy)
      const post = new Graphics()
      post
        .moveTo(p.x, p.y)
        .lineTo(p.x, p.y - height)
        .stroke({ width: 4, color: C_WALL_EDGE, cap: "square" })
      dynamicItems.push({
        container: post,
        zIndex: quantizeZIndex(p.y + WALL_OCCLUSION_BIAS) + 2,
      })
    }
    addCornerPost(o.x, o.y, WALL_H)
    addCornerPost(o.x + w, o.y, WALL_H)
    addCornerPost(o.x, o.y + h, WALL_H)
    addCornerPost(o.x + w, o.y + h, SKIRT_H)

    // mobília fixa (mesa de reunião, TV, lounge, cozinha) — layout do plan;
    // tapete do lounge em terracota (paleta dos vasos) — o tint neutro some
    // no piso sage
    let tvNode: Graphics | null = null
    renderDecorItems(commons.decor, {
      wallFloorY: o.y,
      addWallNode: (_x, node) => staticRoot.addChild(node),
      rugTint: 0xa16c4f,
      onWallProp: (kind, node) => {
        if (kind === "tv" && !tvNode) tvNode = node
      },
    })

    // TV VIVA: plano cisalhado sobre a tela (mesma técnica do relógio, com
    // scale.x=√1.25 compensando a normalização do skew ⇒ x→(x, x/2) exatos).
    // Conteúdo REAL do snapshot (custo total + top-3 salas) via applyAmbient —
    // redesenho DISCRETO, nunca por frame.
    if (tvNode) {
      const holder = overlayOnWallProp(tvNode)
      const plane = new Container()
      plane.skew.y = Math.atan(0.5)
      plane.scale.x = Math.sqrt(1.25)
      const text = new Text({
        text: "",
        style: {
          fontFamily: FONT_SANS,
          fontSize: 11,
          fontWeight: "600",
          fill: 0xd9e2dc,
          letterSpacing: 0.5,
        },
        resolution: textResolution(),
      })
      text.position.set(-40, -86)
      const bars = new Graphics()
      plane.addChild(text, bars)
      holder.addChild(plane)
      tvScreen = { text, bars, key: "" }
    }

    // Um único relógio, claramente pendurado na parede NORTE alta e contínua.
    // A correção vertical mantém o mostrador inteiro dentro dos 96px de parede;
    // não há relógios em corredor/divisórias baixas.
    const clock = createWallClock()
    const cp = toScreen(o.x + 2, o.y)
    clock.root.position.set(cp.x, cp.y + 18)
    staticRoot.addChild(clock.root)
    clocks.push({ clock, mirrored: false })

    const motes = createAmbientMotes(hashSeed("motes|commons"), 170, 96)
    motes.root.position.set(lampCenter.x, lampCenter.y - 104)
    staticRoot.addChild(motes.root)
    ambient.push(motes)

    // decalque fixo na entrada
    const decal = createFloorDecal(o.x + 1.6, (gapA + gapB) / 2, "Sala comum", 0xf2ead2)
    staticRoot.addChild(decal.root)

    addDaylightOverlay(o, w, h)
  }

  // --- infraestrutura discreta do corredor (somente bebedouro) -------------
  {
    const corridorDecor = plan.corridorDecor ?? []
    // linha de chão da parede norte do corredor = 1 tile abaixo da linha de
    // parede dos itens (tile.y do quadro é a LINHA DE PAREDE, corridorTop - 1)
    const wallItem = corridorDecor.find((i) => WALL_KINDS.has(i.kind))
    renderDecorItems(corridorDecor, {
      wallFloorY: wallItem ? wallItem.tile.y + 1 : 0,
      addWallNode: (_x, node) => {
        // no corredor a "parede" norte é só rodapé — o quadro vira um item
        // dinâmico apoiado na borda (à frente do rodapé, atrás dos atores)
        dynamicItems.push({ container: node, zIndex: quantizeZIndex(node.position.y) + 1 })
      },
    })
  }

  setClocks()

  /** Hora REAL (0–23); __officeDebugHour permite forçar a fase no dev/loop
   *  visual (nunca setado em produção — o relógio de verdade manda). */
  const realHour = (): number => {
    const dbg = (globalThis as { __officeDebugHour?: unknown }).__officeDebugHour
    return typeof dbg === "number" ? ((dbg % 24) + 24) % 24 : new Date().getHours()
  }
  applyDaylight(dayPhase(realHour()))

  // LOD das placas de parede (visíveis só no zoom-out). Começa `true` porque as
  // placas nascem visíveis; o 1º setLod no zoom-in as esconde.
  let plateFar = true

  return {
    staticRoot,
    dynamicItems,
    setRoomInfo(projectId, name, color) {
      const b = bits.get(projectId)
      if (!b) return
      b.plateText.text = name
      b.decal.setInfo(name, color)
      if (color) {
        b.plateStrip.tint = color
        for (const r of b.rugs) r.tint = color
      }
    },
    setRoomAggregate(projectId, agg) {
      const b = bits.get(projectId)
      if (!b || b.agg === agg) return
      b.agg = agg
      const color = doorLightColor(agg, tokens)
      for (const l of b.doorLight.layers) l.tint = color
      b.doorLight.root.alpha = 1
    },
    /** LOD das placas de sala: visíveis só no zoom-out (wayfinding), somem no
     *  zoom-in (o decalque do piso identifica a sala sem colidir com os pills).
     *  Early-return por zoom — barato de chamar por frame. */
    setLod(zoom) {
      const far = zoom < LABEL_LOD_MIN_ZOOM
      if (far === plateFar) return
      plateFar = far
      for (const b of bits.values()) b.plate.visible = far
    },
    applyAmbient(s, opts) {
      // TV da sala comum: custo total + top-3 (redesenho só quando muda)
      if (tvScreen) {
        const stats = tvStats(s.rooms)
        const key =
          `${stats.totalUsd.toFixed(2)}|` +
          stats.bars.map((b) => `${b.frac.toFixed(2)}${b.color ?? ""}`).join(",")
        if (key !== tvScreen.key) {
          tvScreen.key = key
          tvScreen.text.text = formatTvUsd(stats.totalUsd)
          tvScreen.bars.clear()
          for (let i = 0; i < stats.bars.length; i++) {
            const bar = stats.bars[i]
            const bh = 4 + bar.frac * 20
            tvScreen.bars
              .roundRect(-38 + i * 22, -46 - bh, 14, bh, 2)
              .fill({ color: bar.color ?? 0x73aaa4, alpha: 0.9 })
          }
        }
      }
      // whiteboard = kanban da missão (dif discreto por sala)
      for (const room of s.rooms) {
        const b = bits.get(room.projectId)
        if (!b?.kanban) continue
        const key = room.mission
          ? `${room.mission.phases.map((p) => p.status).join(",")}|${room.mission.current}`
          : ""
        if (key === b.kanban.key) continue
        b.kanban.key = key
        drawKanban(b.kanban, room.mission)
      }
      // cadeira vazia: mesa "off" mostra a cadeira girada (o pack pessoal
      // esconde o avatar sentado; a caneca é prop do avatar — some junto)
      for (const room of s.rooms) {
        for (const d of room.desks) {
          const chair = emptyChairs.get(d.id)
          if (chair) chair.visible = d.state === "off"
        }
      }
      // pilha de entregas do boss (unseenDeliveries quando o chamador passar;
      // fallback = bossDeliveries do snapshot, TTL 30s do derive;
      // __officeDebugBossPile força a contagem — só p/ o loop visual)
      const dbgPile = (globalThis as { __officeDebugBossPile?: unknown }).__officeDebugBossPile
      bossPile?.setCount(
        deliveryPileCount(
          opts?.bossPile ??
            (typeof dbgPile === "number" ? dbgPile : (s.bossDeliveries?.length ?? 0)),
        ),
      )
    },
    tick(timeSec, reducedMotion) {
      for (const b of bits.values()) {
        if (doorLightPulses(b.agg) && !reducedMotion) {
          b.doorLight.root.alpha = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(timeSec * 4.2))
        } else {
          b.doorLight.root.alpha = 1
        }
        // véu do cartão "running" do kanban pulsa (transform/alpha; estático
        // com reduced motion)
        if (b.kanban?.hasRunning) {
          b.kanban.pulse.alpha = reducedMotion
            ? 0.22
            : 0.14 + 0.14 * (0.5 + 0.5 * Math.sin(timeSec * 3))
        }
      }
      // vida ambiente: poeira da luminária, vapor da cafeteira, relógio 1×/s
      for (const a of ambient) a.update(timeSec, reducedMotion)
      for (const s of steams) s.machine.steam.tick(timeSec, s.phase, reducedMotion)
      const sec = Math.floor(timeSec)
      if (sec !== clockSec) {
        clockSec = sec
        setClocks()
        // caixas de mudança: idade REAL da sala nova ⇒ fade e remoção (1×/s)
        for (let i = movingBoxes.length - 1; i >= 0; i--) {
          const box = movingBoxes[i]
          const alpha = movingBoxAlpha(Date.now() - box.born)
          if (alpha <= 0) {
            box.g.visible = false
            movingBoxes.splice(i, 1)
          } else {
            box.g.alpha = alpha
          }
        }
        // dia/noite REAL: checa a fase 1×/min (applyDaylight é no-op sem troca)
        const minute = Math.floor(Date.now() / 60_000)
        if (minute !== daylightMinute) {
          daylightMinute = minute
          applyDaylight(dayPhase(realHour()))
        }
      }
    },
    destroy() {
      staticRoot.destroy({ children: true })
      for (const d of dynamicItems) d.container.destroy({ children: true })
    },
  }
}
