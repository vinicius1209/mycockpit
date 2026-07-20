// Planta do escritório (docs/agent-office.md §3): geometria PURA derivada da
// lista de projetos + DECORAÇÃO PROCEDURAL determinística. Corredor horizontal
// central (3 tiles de altura), salas 10×8 em DUAS fileiras (row 0 acima, row 1
// abaixo, alternando), porta de 2 tiles para o corredor, 3 mesas por sala (uma
// por agent do registry) e uma SALA COMUM 12×9 no fim do corredor (mesa de
// reunião, lounge, cozinha).
//
// Decoração: PRNG mulberry32 semeado por hash(projectId) — NUNCA Math.random.
// A sala de um projeto é SEMPRE a mesma entre sessões; projetos diferentes
// ganham salas diferentes. Props de CHÃO bloqueiam o footprint na grid; tapete
// e decoração de parede são só visuais. Nenhum prop pode selar o caminho
// porta→interactTiles — cada colocação é verificada com o A* do engine e
// revertida se fechar passagem.

import { deskDisplayName } from "./hooks"
import { findPath } from "@/office/engine/astar"
import {
  OFFICE_AGENTS,
  T_DOOR,
  T_INTERACT,
  T_WALK,
  MISSION_TABLE_ID,
  type CommonRoomPlacement,
  type DeskPlacement,
  type FloorPlan,
  type OfficeInteractable,
  type RoomDecorItem,
  type RoomPlacement,
  type Vec2,
} from "@/office/engine/types"

/** Referência mínima de projeto que a planta precisa (ordem = listProjects). */
export type OfficeProjectRef = {
  id: string
  name: string
  color?: string | null
}

/** Interior da sala, em tiles. */
export const ROOM_W = 10
export const ROOM_H = 8
/** Altura do corredor central, em tiles. */
export const CORRIDOR_H = 3
/** Interior da sala comum, em tiles. */
export const COMMONS_W = 12
export const COMMONS_H = 9
export const COMMONS_ID = "commons" as const
/** Espessura de parede (tiles não-caminháveis entre/around as salas). */
const WALL = 1
/** Offset x (dentro da sala) do canto esquerdo de cada mesa (2×1 tiles).
 *  Row 0: ritmo regular. Row 1: a parede NORTE é a do corredor e tem a porta
 *  nas colunas 4–5 — as mesas se afastam para não bloquear a entrada (o tile
 *  ao sul de cada tile de porta precisa continuar caminhável). */
const DESK_XS_ROW0 = [1, 4, 7]
const DESK_XS_ROW1 = [1, 6, 8]
/** Alvo O-1 do design doc: até 8 projetos (o excedente fica fora da planta). */
export const MAX_ROOMS = 8

// ---------------------------------------------------------------------------
// PRNG determinístico (decoração)
// ---------------------------------------------------------------------------

/** Hash 32-bit de string (FNV-1a) → seed pro mulberry32. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** PRNG mulberry32 — determinístico dado o seed. Única fonte de aleatório da
 *  decoração (a sala de um projeto deve ser a mesma entre sessões). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher–Yates com rng injetado (devolve cópia). */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

// ---------------------------------------------------------------------------
// Vocabulário de decoração (contrato com a cena)
// ---------------------------------------------------------------------------

export const PLANT_KINDS = ["plant-a", "plant-b", "plant-c"] as const
export const WALL_PROP_KINDS = ["wall-art", "whiteboard", "shelf"] as const
export const FLOOR_PROP_KINDS = [
  "filing-cabinet",
  "bookshelf",
  "water-cooler",
  "sofa-small",
] as const

/** Footprint em tiles por kind (ausente ⇒ 1×1). `tile` do item = canto NW. */
export const DECOR_FOOTPRINTS: Record<string, { w: number; h: number }> = {
  rug: { w: 3, h: 2 },
  "rug-large": { w: 4, h: 3 },
  "meeting-table": { w: 4, h: 2 },
  sofa: { w: 2, h: 1 },
  "kitchen-counter": { w: 1, h: 2 },
}

/** Decoração que NÃO bloqueia: tapetes (chão visual) e itens de parede. */
const NON_BLOCKING_KINDS = new Set<string>([
  "rug",
  "rug-large",
  "wall-art",
  "whiteboard",
  "shelf",
  "notice-board",
  "tv",
])

/** Item de chão (bloqueia o footprint na grid)? Parede/tapete ⇒ false. */
export function isBlockingDecor(kind: string): boolean {
  return !NON_BLOCKING_KINDS.has(kind)
}

// ---------------------------------------------------------------------------
// Planta
// ---------------------------------------------------------------------------

/** Planta mínima quando NÃO há projetos: só um corredor curto (a cena mostra o
 *  CTA de adicionar projeto). Mantém o boss com chão pra pisar. */
function emptyPlan(): FloorPlan {
  const w = ROOM_W + 2 * WALL
  const h = CORRIDOR_H + 2 * WALL
  const grid = new Uint8Array(w * h)
  for (let y = WALL; y < WALL + CORRIDOR_H; y++) {
    for (let x = WALL; x < w - WALL; x++) grid[y * w + x] = T_WALK
  }
  return { w, h, grid, rooms: [], spawn: { x: w / 2, y: h / 2 }, corridorDecor: [] }
}

/** Porta(s)→interactTiles da sala continuam alcançáveis? (A* real do engine —
 *  mesma métrica do boss.) */
function roomPathsOpen(plan: FloorPlan, room: RoomPlacement): boolean {
  for (const door of room.doorTiles) {
    const from = { x: door.x + 0.5, y: door.y + 0.5 }
    for (const desk of room.desks) {
      const to = { x: desk.interactTile.x + 0.5, y: desk.interactTile.y + 0.5 }
      if (findPath(plan, from, to) === null) return false
    }
  }
  return true
}

/** Decoração procedural de UMA sala. Consome o rng numa ordem FIXA (tapete →
 *  parede → plantas → props de chão) — mudar a ordem muda todas as salas. */
function decorateRoom(plan: FloorPlan, room: RoomPlacement, rng: () => number): RoomDecorItem[] {
  const { x: ox, y: oy } = room.origin
  const decor: RoomDecorItem[] = []

  // 1) Tapete: 1 por sala, 2 tamanhos, posição central variada. Não bloqueia.
  const large = rng() < 0.5
  const rugX = ox + 3 + Math.floor(rng() * 2)
  const rugY = oy + 3 + Math.floor(rng() * 2)
  decor.push({ kind: large ? "rug-large" : "rug", tile: { x: rugX, y: rugY } })

  // 2) Parede norte: 1–2 props nos tiles de parede livres entre mesas (e fora
  //    da porta, que na row 1 divide a parede norte com as mesas). Não bloqueia.
  const deskCols = new Set<number>()
  for (const d of room.desks) {
    deskCols.add(d.tile.x - ox)
    deskCols.add(d.tile.x + 1 - ox)
  }
  const doorCols = new Set(room.row === 1 ? room.doorTiles.map((d) => d.x - ox) : [])
  const freeWallXs: number[] = []
  for (let rx = 0; rx < room.w; rx++) {
    if (!deskCols.has(rx) && !doorCols.has(rx)) freeWallXs.push(rx)
  }
  const wallCount = Math.min(1 + (rng() < 0.5 ? 1 : 0), freeWallXs.length)
  const wallXs = shuffle(freeWallXs, rng).slice(0, wallCount)
  const wallKinds = shuffle(WALL_PROP_KINDS, rng)
  for (let i = 0; i < wallCount; i++) {
    decor.push({ kind: wallKinds[i], tile: { x: ox + wallXs[i], y: oy - 1 } })
  }

  // Pool de tiles SEGUROS para props de chão: bordas oeste/leste/sul do
  // interior (longe da fileira de mesas ry=0 e da fileira de interação ry=1),
  // menos os tiles de entrada da porta. Shuffle uma vez; plantas e props
  // consomem da mesma fila.
  const entry = new Set(
    room.doorTiles.map((d) => `${d.x - ox},${room.row === 0 ? room.h - 1 : 0}`),
  )
  const pool: Vec2[] = []
  for (let ry = 2; ry < room.h; ry++) {
    pool.push({ x: 0, y: ry })
    pool.push({ x: room.w - 1, y: ry })
  }
  for (let rx = 1; rx < room.w - 1; rx++) pool.push({ x: rx, y: room.h - 1 })
  const candidates = shuffle(
    pool.filter((t) => !entry.has(`${t.x},${t.y}`)),
    rng,
  )

  /** Bloqueia o próximo candidato que não sela porta→mesas; reverte se selar. */
  const placeBlocking = (kind: string, flip: boolean): boolean => {
    while (candidates.length > 0) {
      const rel = candidates.shift()!
      const x = ox + rel.x
      const y = oy + rel.y
      const idx = y * plan.w + x
      const saved = plan.grid[idx]
      // nunca em cima de porta/interação/mesa (mesa já é 0 — cai no !T_WALK)
      if ((saved & T_WALK) === 0 || (saved & (T_DOOR | T_INTERACT)) !== 0) continue
      plan.grid[idx] = 0
      if (roomPathsOpen(plan, room)) {
        decor.push({ kind, tile: { x, y }, flip })
        return true
      }
      plan.grid[idx] = saved
    }
    return false
  }

  // 3) Plantas: 2–4, de pelo menos 2 espécies (a 2ª é forçada ≠ da 1ª).
  const plantCount = 2 + Math.floor(rng() * 3)
  const firstSpecies = Math.floor(rng() * PLANT_KINDS.length)
  for (let i = 0; i < plantCount; i++) {
    const species =
      i === 0
        ? firstSpecies
        : i === 1
          ? (firstSpecies + 1 + Math.floor(rng() * 2)) % PLANT_KINDS.length
          : Math.floor(rng() * PLANT_KINDS.length)
    placeBlocking(PLANT_KINDS[species], rng() < 0.5)
  }

  // 4) Props de chão: 0–2, kinds sem repetição.
  const floorCount = Math.floor(rng() * 3)
  const floorKinds = shuffle(FLOOR_PROP_KINDS, rng)
  for (let i = 0; i < floorCount; i++) {
    placeBlocking(floorKinds[i], rng() < 0.5)
  }

  return decor
}

/** Sala comum 12×9 no fim (leste) do corredor, arrumada em TRÊS CONJUNTOS de
 *  offsets relativos FIXOS (nada de tile solto — mesmo espírito da unidade
 *  mesa+cadeira das salas de projeto):
 *  - REUNIÃO: mesão 4×2 com cadeiras ENCAIXADAS nas laterais longas (norte de
 *    frente pro viewer, sul de costas, meio tile sob o tampo) + cabeceira
 *    leste; a ponta oeste (lado da porta) fica livre. A FAIXA ry=6, ao sul do
 *    mesão, fica 100% caminhável — é o interactTile da fase 2.
 *  - LOUNGE no canto SE: sofá olhando o SUL direto pra mesinha (lado do
 *    viewer), tapete por baixo do conjunto, planta fechando na parede leste.
 *  - COZINHA na parede oeste, ao norte da porta: cafeteira EM CIMA da bancada
 *    (rooms.ts pousa no tampo) e bebedouro fechando a linha até a porta.
 *  Layout FIXO (determinístico por construção); móveis bloqueiam na grid,
 *  resto caminhável, porta de 2 tiles na parede oeste dá pro corredor. */
function buildCommons(plan: FloorPlan, origin: Vec2, corridorTop: number): CommonRoomPlacement {
  const { x: cox, y: coy } = origin
  const set = (x: number, y: number, flags: number) => {
    plan.grid[y * plan.w + x] = flags
  }

  for (let y = coy; y < coy + COMMONS_H; y++) {
    for (let x = cox; x < cox + COMMONS_W; x++) set(x, y, T_WALK)
  }
  const doorTiles: Vec2[] = [
    { x: cox - 1, y: corridorTop },
    { x: cox - 1, y: corridorTop + 1 },
  ]
  for (const d of doorTiles) set(d.x, d.y, T_WALK | T_DOOR)

  const decor: RoomDecorItem[] = []
  const place = (
    kind: string,
    rx: number,
    ry: number,
    opts?: { flip?: boolean; offset?: Vec2 },
  ) => {
    const tile = { x: cox + rx, y: coy + ry }
    const item: RoomDecorItem = { kind, tile }
    if (opts?.flip !== undefined) item.flip = opts.flip
    if (opts?.offset !== undefined) item.offset = opts.offset
    decor.push(item)
    if (isBlockingDecor(kind)) {
      const fp = DECOR_FOOTPRINTS[kind] ?? { w: 1, h: 1 }
      for (let by = 0; by < fp.h; by++) {
        for (let bx = 0; bx < fp.w; bx++) set(tile.x + bx, tile.y + by, 0)
      }
    }
  }
  /** Bloqueio extra de conjunto (meia-cadeira/overhang fora do tile-base). */
  const block = (rx: number, ry: number) => set(cox + rx, coy + ry, 0)

  // --- CONJUNTO REUNIÃO (base = canto NW do mesão; rx 4–7, ry 3–4) ---------
  const MEET = { x: 4, y: 3 }
  /** Meia-entrada da cadeira sob o tampo (offset visual, em tiles). */
  const TUCK = 0.36
  place("meeting-table", MEET.x, MEET.y)
  // lado norte (atrás do mesão): FRENTE visível, pares simétricos ao eixo;
  // levemente afastadas (o tampo erguido esconderia a cadeira colada)
  place("meeting-chair", MEET.x, MEET.y - 1, { offset: { x: 0.5, y: -0.12 } })
  place("meeting-chair", MEET.x + 2, MEET.y - 1, { offset: { x: 0.5, y: -0.12 } })
  // lado sul (perto da câmera): COSTAS pro viewer, enfiadas sob o tampo
  place("meeting-chair-back", MEET.x, MEET.y + 2, { offset: { x: 0.5, y: -TUCK } })
  place("meeting-chair-back", MEET.x + 2, MEET.y + 2, { offset: { x: 0.5, y: -TUCK } })
  // cabeceira LESTE (espelhada ⇒ olha pro oeste); a ponta oeste fica livre
  place("meeting-chair-back", MEET.x + 4, MEET.y, { flip: true, offset: { x: -TUCK, y: 0.5 } })
  block(MEET.x + 4, MEET.y + 1) // a cadeira da cabeceira senta entre ry 3–4
  // faixas das cadeiras bloqueiam INTEIRAS (cada cadeira invade meio tile);
  // a faixa ry 6 ao sul NÃO entra aqui — fica livre pra fase 2
  for (let rx = MEET.x; rx < MEET.x + 4; rx++) {
    block(rx, MEET.y - 1)
    block(rx, MEET.y + 2)
  }
  // TV na parede norte, centrada no eixo do mesão (parede — não bloqueia)
  place("tv", 5, -1, { offset: { x: 0.5, y: 0 } })

  // interactTile da mesa de reunião: centro da faixa LIVRE ry 6 ao sul do
  // mesão (rel 6,6 — a faixa inteira rx 3–8 é caminhável, teste no layout.test)
  set(cox + 6, coy + 6, T_WALK | T_INTERACT)

  // --- CONJUNTO LOUNGE (canto SE; base = canto NW do sofá 2×1) -------------
  const LOUNGE = { x: 9, y: 6 }
  // tapete grande: moldura visível em volta do conjunto (o pequeno somia
  // inteiro debaixo de sofá+mesinha)
  place("rug-large", LOUNGE.x - 1, LOUNGE.y - 1, { offset: { x: 0, y: 0.6 } })
  place("sofa", LOUNGE.x, LOUNGE.y) // encosto ao norte — olha a mesinha
  place("coffee-table", LOUNGE.x, LOUNGE.y + 1, { offset: { x: 0.5, y: 0 } }) // eixo do sofá
  block(LOUNGE.x + 1, LOUNGE.y + 1) // metade leste da mesinha (offset +0.5)
  place("plant-b", LOUNGE.x + 2, LOUNGE.y) // fecha o conjunto na parede leste

  // --- CONJUNTO COZINHA (parede oeste, ao norte da porta) ------------------
  place("kitchen-counter", 0, 0) // bancada 1×2, pia na metade sul
  place("coffee-machine", 0, 0) // EM CIMA da bancada (metade norte do tampo)
  place("water-cooler", 0, 2, { offset: { x: -0.18, y: 0 } }) // colado na parede, fecha a linha

  return {
    id: COMMONS_ID,
    origin: { x: cox, y: coy },
    w: COMMONS_W,
    h: COMMONS_H,
    doorTiles,
    decor,
  }
}

/** Decoração do corredor: bebedouro + plantas espaçadas deterministicamente
 *  nas fileiras ENCOSTADAS nas paredes (o meio do corredor nunca é bloqueado,
 *  nem os tiles em frente às portas) + 1 quadro de avisos na parede norte. */
function decorateCorridor(
  plan: FloorPlan,
  rooms: RoomPlacement[],
  corridorTop: number,
  roomsW: number,
  rng: () => number,
): RoomDecorItem[] {
  const topY = corridorTop
  const botY = corridorTop + CORRIDOR_H - 1
  // Tiles em frente às portas (lado do corredor) ficam livres — inclui o tile
  // de spawn (frente da porta da sala 0) e a frente da porta da sala comum.
  const blockedTop = new Set<number>([roomsW - 2])
  const blockedBot = new Set<number>([roomsW - 2])
  for (const r of rooms) {
    for (const d of r.doorTiles) (r.row === 0 ? blockedTop : blockedBot).add(d.x)
  }

  const decor: RoomDecorItem[] = []
  let placedCooler = false
  let x = WALL + 1 + Math.floor(rng() * 2)
  while (x < roomsW - 2) {
    const preferTop = rng() < 0.5
    const tryRows: Array<[number, Set<number>]> = preferTop
      ? [
          [topY, blockedTop],
          [botY, blockedBot],
        ]
      : [
          [botY, blockedBot],
          [topY, blockedTop],
        ]
    for (const [y, blocked] of tryRows) {
      if (blocked.has(x)) continue
      const idx = y * plan.w + x
      if (plan.grid[idx] !== T_WALK) continue // exige chão puro (sem porta/interact)
      plan.grid[idx] = 0
      const kind = placedCooler
        ? PLANT_KINDS[Math.floor(rng() * PLANT_KINDS.length)]
        : "water-cooler"
      placedCooler = true
      decor.push({ kind, tile: { x, y } })
      break
    }
    x += 4 + Math.floor(rng() * 3)
  }

  // Quadro de avisos: parede norte do corredor, num tile de parede sem porta.
  const wallY = corridorTop - 1
  const wallXs: number[] = []
  for (let wx = WALL; wx < roomsW - 1; wx++) {
    if ((plan.grid[wallY * plan.w + wx] & T_DOOR) === 0) wallXs.push(wx)
  }
  if (wallXs.length > 0) {
    decor.push({
      kind: "notice-board",
      tile: { x: wallXs[Math.floor(rng() * wallXs.length)], y: wallY },
    })
  }
  return decor
}

/** Constrói a planta global a partir dos projetos (ordem de listProjects).
 *  Com 1 projeto a ala de salas encolhe à única coluna; a sala comum fica
 *  sempre no fim (leste) do corredor. */
export function buildFloorPlan(projects: OfficeProjectRef[]): FloorPlan {
  const list = projects.slice(0, MAX_ROOMS)
  if (list.length === 0) return emptyPlan()

  // Salas alternam fileira: projeto 0 → row 0 (acima), 1 → row 1 (abaixo), …
  const nCols = Math.ceil(list.length / 2)
  const hasBottom = list.length >= 2

  /** Largura da ala de salas (termina na parede oeste da sala comum). */
  const roomsW = WALL + nCols * (ROOM_W + WALL)
  const w = roomsW + COMMONS_W + WALL
  /** Primeira linha (y) do corredor: parede externa + sala de cima + parede
   *  com porta. */
  const corridorTop = WALL + ROOM_H + WALL
  /** Sala comum centrada verticalmente no corredor. */
  const commonsOrigin: Vec2 = {
    x: roomsW,
    y: corridorTop - Math.floor((COMMONS_H - CORRIDOR_H) / 2),
  }
  const hBase = hasBottom
    ? corridorTop + CORRIDOR_H + WALL + ROOM_H + WALL
    : corridorTop + CORRIDOR_H + WALL
  const h = Math.max(hBase, commonsOrigin.y + COMMONS_H + WALL)

  const grid = new Uint8Array(w * h)
  const set = (x: number, y: number, flags: number) => {
    grid[y * w + x] = flags
  }

  // Corredor: caminhável de parede a parede da ALA DE SALAS (a sala comum tem
  // interior próprio do outro lado da porta).
  for (let y = corridorTop; y < corridorTop + CORRIDOR_H; y++) {
    for (let x = WALL; x < roomsW - WALL; x++) set(x, y, T_WALK)
  }

  const rooms: RoomPlacement[] = []
  for (let i = 0; i < list.length; i++) {
    const p = list[i]
    const row = (i % 2) as 0 | 1
    const col = Math.floor(i / 2)
    const ox = WALL + col * (ROOM_W + WALL)
    const oy = row === 0 ? WALL : corridorTop + CORRIDOR_H + WALL

    // Interior caminhável.
    for (let y = oy; y < oy + ROOM_H; y++) {
      for (let x = ox; x < ox + ROOM_W; x++) set(x, y, T_WALK)
    }

    // Porta de 2 tiles, centralizada na parede que dá pro corredor.
    const doorY = row === 0 ? oy + ROOM_H : oy - 1
    const doorTiles: Vec2[] = [
      { x: ox + ROOM_W / 2 - 1, y: doorY },
      { x: ox + ROOM_W / 2, y: doorY },
    ]
    for (const d of doorTiles) set(d.x, d.y, T_WALK | T_DOOR)

    // Mesas (2×1 tiles, NÃO caminháveis) SEMPRE encostadas na parede NORTE da
    // sala (a parede alta de fundo do isométrico — nas duas fileiras), com o
    // tile de interação ao SUL, no interior da sala. Assim o agent sentado
    // fica de frente pro viewer nas duas fileiras (nada de agent de costas).
    const deskY = oy
    const frontY = deskY + 1
    const deskXs = row === 0 ? DESK_XS_ROW0 : DESK_XS_ROW1
    const desks: DeskPlacement[] = OFFICE_AGENTS.map((agent, k) => {
      const dx = ox + deskXs[k]
      // Flip variado mas determinístico (função do índice do projeto + mesa).
      const flip = (i + k) % 2 === 1
      set(dx, deskY, 0) // mesa bloqueia os 2 tiles do footprint
      set(dx + 1, deskY, 0)
      return {
        id: `${p.id}::${agent}`,
        projectId: p.id,
        agent,
        agentName: deskDisplayName(agent),
        tile: { x: dx, y: deskY },
        // na frente da metade pra onde a cadeira "olha" (varia com o flip)
        interactTile: { x: dx + (flip ? 1 : 0), y: frontY },
        flip,
      }
    })
    for (const d of desks) {
      set(d.interactTile.x, d.interactTile.y, T_WALK | T_INTERACT)
    }

    rooms.push({
      projectId: p.id,
      row,
      origin: { x: ox, y: oy },
      w: ROOM_W,
      h: ROOM_H,
      doorTiles,
      desks,
      decor: [],
    })
  }

  // Spawn: no corredor, em frente à porta da PRIMEIRA sala (projeto 0 é sempre
  // row 0, então a porta dá na primeira linha do corredor).
  const first = rooms[0]
  const spawn: Vec2 = {
    x: first.doorTiles[0].x + 1, // ponto médio da porta de 2 tiles
    y: corridorTop + 0.5,
  }

  const plan: FloorPlan = { w, h, grid, rooms, spawn, corridorDecor: [] }

  // Decoração — ordem fixa: sala comum (layout fixo) → salas (seed por
  // projectId) → corredor (seed pela lista de projetos).
  plan.commonRoom = buildCommons(plan, commonsOrigin, corridorTop)
  // Mesa de reunião = ponto de interação SEM agent (O-2 — lançar missão):
  // entra na proximidade do boss; âncora do balão no centro do mesão 4×2
  // (rx 4–7, ry 3–4 ⇒ centro rel 6,4; tile-âncora em float, só projeção).
  const missionTable: OfficeInteractable = {
    id: MISSION_TABLE_ID,
    tile: { x: commonsOrigin.x + 5.5, y: commonsOrigin.y + 3.5 },
    interactTile: { x: commonsOrigin.x + 6, y: commonsOrigin.y + 6 },
  }
  plan.interactables = [missionTable]
  for (const room of rooms) {
    room.decor = decorateRoom(plan, room, mulberry32(hashSeed(room.projectId)))
  }
  plan.corridorDecor = decorateCorridor(
    plan,
    rooms,
    corridorTop,
    roomsW,
    mulberry32(hashSeed(`corridor|${list.map((p) => p.id).join("|")}`)),
  )

  return plan
}
