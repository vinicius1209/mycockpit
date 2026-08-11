// Planta do escritório (docs/agent-office.md §3): geometria PURA derivada da
// lista de projetos + DECORAÇÃO PROCEDURAL determinística. Corredor horizontal
// central (3 tiles de altura), salas 12×8 em DUAS fileiras (row 0 acima, row 1
// abaixo, alternando), porta de 2 tiles para o corredor e 3 mesas por sala (uma
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
  EXECUTIVE_STATION_SPEC,
  furnitureRectTile,
} from "@/office/engine/furniture"
import {
  OFFICE_AGENTS,
  T_DOOR,
  T_INTERACT,
  T_WALK,
  BOSS_DESK_ID,
  MISSION_TABLE_ID,
  NOTICE_BOARD_ID,
  type CommonRoomPlacement,
  type BossRoomPlacement,
  type DeskPlacement,
  type FloorPlan,
  type OfficeInteractable,
  type RoomDecorItem,
  type RoomPlacement,
  type Vec2,
} from "@/lib/fleet/types"

/** Referência mínima de projeto que a planta precisa (ordem = listProjects). */
export type OfficeProjectRef = {
  id: string
  name: string
  color?: string | null
}

/** Interior da sala, em tiles. */
export const ROOM_W = 12
export const ROOM_H = 8
/** Altura do corredor central, em tiles. */
export const CORRIDOR_H = 3
/** Interior da sala comum, em tiles. */
export const COMMONS_W = 12
export const COMMONS_H = 9
export const COMMONS_ID = "commons" as const
/** Sala do chefe: fixa, compacta e nunca procedural. */
export const BOSS_ROOM_W = 10
export const BOSS_ROOM_H = 8
/** Espessura de parede (tiles não-caminháveis entre/around as salas). */
const WALL = 1
/** Estações em bays consistentes dentro da sala 12×8. O primeiro tile fica
 *  livre da parede oeste e o eixo da porta (5–6) mantém rota pela coluna 6. */
const DESK_XS = [1, 4, 8] as const
/** Zoneamento longitudinal da sala: parede técnica 0, cadeira 1, mesa 2,
 *  interação 3 e corredor frontal contínuo 4. */
const DESK_Y_INSET = 2
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
const STORAGE_PROP_KINDS = new Set<string>(["filing-cabinet", "bookshelf"])

/** Footprint em tiles por kind (ausente ⇒ 1×1). `tile` do item = canto NW. */
export const DECOR_FOOTPRINTS: Record<string, { w: number; h: number }> = {
  rug: { w: 3, h: 2 },
  "rug-large": { w: 4, h: 3 },
  "meeting-table": { w: 4, h: 2 },
  "executive-chair": { w: 2, h: 1 },
  "executive-sideboard": { w: 1, h: 2 },
  "executive-visitor-chair": { w: 1, h: 1 },
  sofa: { w: 2, h: 1 },
  "kitchen-counter": { w: 2, h: 1 },
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

  // 2) Parede norte: 1–2 props nos tiles livres entre os bays de trabalho e
  //    fora da porta. A zona técnica atrás das cadeiras permanece legível.
  const workstationCols = new Set<number>()
  for (const d of room.desks) {
    workstationCols.add(d.tile.x - ox)
    workstationCols.add(d.tile.x + 1 - ox)
  }
  const doorCols = new Set(room.row === 1 ? room.doorTiles.map((d) => d.x - ox) : [])
  const freeWallXs: number[] = []
  for (let rx = 0; rx < room.w; rx++) {
    if (!workstationCols.has(rx) && !doorCols.has(rx)) freeWallXs.push(rx)
  }
  const wallCount = Math.min(1 + (rng() < 0.5 ? 1 : 0), freeWallXs.length)
  const wallXs = shuffle(freeWallXs, rng).slice(0, wallCount)
  const wallKinds = shuffle(WALL_PROP_KINDS, rng)
  for (let i = 0; i < wallCount; i++) {
    decor.push({ kind: wallKinds[i], tile: { x: ox + wallXs[i], y: oy - 1 } })
  }

  // Slots arquitetônicos: estações ao norte, circulação inteiramente livre no
  // centro e apoio/verde em nichos recuados das divisórias baixas. O PRNG
  // escolhe variantes dentro desses slots; ele não inventa posições soltas.
  const entry = new Set(
    room.doorTiles.map((d) => `${d.x - ox},${room.row === 0 ? room.h - 1 : 0}`),
  )
  // Armários/arquivos têm slots próprios na parede OESTE alta e sempre são
  // virados para acompanhar esse plano. Eles nunca disputam slots de plantas
  // nem aparecem soltos junto às divisórias baixas/circulação.
  const storagePool = shuffle(
    [
      { x: 0, y: 5 },
      { x: 0, y: room.h - 2 },
    ],
    rng,
  ).filter((t) => !entry.has(`${t.x},${t.y}`))
  // Verde apenas nos dois nichos da faixa de distribuição. O eixo x=4..7 e
  // todo o corredor frontal ry=4 ficam livres em ambas as orientações.
  const plantSlots: Vec2[] = [
    { x: 0, y: room.h - 2 },
    { x: room.w - 2, y: room.h - 2 },
  ]
  const plantPool = shuffle(
    plantSlots.filter((t) => !entry.has(`${t.x},${t.y}`)),
    rng,
  )
  const supportPool = shuffle(
    [
      { x: 1, y: 5 },
      { x: room.w - 2, y: 5 },
    ].filter((t) => !entry.has(`${t.x},${t.y}`)),
    rng,
  )

  /** Bloqueia o próximo candidato que não sela porta→mesas; reverte se selar. */
  const placeBlocking = (
    kind: string,
    flip: boolean,
    source: Vec2[],
  ): boolean => {
    while (source.length > 0) {
      const rel = source.shift()!
      const x = ox + rel.x
      const y = oy + rel.y
      const fp = DECOR_FOOTPRINTS[kind] ?? { w: 1, h: 1 }
      if (rel.x < 0 || rel.y < 0 || rel.x + fp.w > room.w || rel.y + fp.h > room.h)
        continue
      const saved: Array<{ idx: number; flags: number }> = []
      let free = true
      for (let fy = 0; fy < fp.h; fy++) {
        for (let fx = 0; fx < fp.w; fx++) {
          const idx = (y + fy) * plan.w + x + fx
          const flags = plan.grid[idx]
          // Nunca sobre porta/interação/mesa ou outro móvel já reservado.
          if ((flags & T_WALK) === 0 || (flags & (T_DOOR | T_INTERACT)) !== 0) free = false
          saved.push({ idx, flags })
        }
      }
      if (!free) continue
      for (const cell of saved) plan.grid[cell.idx] = 0
      if (roomPathsOpen(plan, room)) {
        decor.push({ kind, tile: { x, y }, flip })
        return true
      }
      for (const cell of saved) plan.grid[cell.idx] = cell.flags
    }
    return false
  }

  // 3) Plantas: 1–2 por sala. Quando há duas, a segunda espécie é diferente;
  // os próprios slots garantem pelo menos 3 tiles de espaçamento.
  const plantCount = 1 + Math.floor(rng() * 2)
  const firstSpecies = Math.floor(rng() * PLANT_KINDS.length)
  for (let i = 0; i < plantCount; i++) {
    const species =
      i === 0
        ? firstSpecies
        : i === 1
          ? (firstSpecies + 1 + Math.floor(rng() * 2)) % PLANT_KINDS.length
          : Math.floor(rng() * PLANT_KINDS.length)
    placeBlocking(PLANT_KINDS[species], rng() < 0.5, plantPool)
  }

  // 4) Apoio: no máximo um item além do verde. Armários têm parede própria;
  // bebedouro/sofá pequeno usam os nichos laterais remanescentes.
  const floorCount = Math.floor(rng() * 2)
  const floorKinds = shuffle(FLOOR_PROP_KINDS, rng)
  for (let i = 0; i < floorCount; i++) {
    const kind = floorKinds[i]
    const storage = STORAGE_PROP_KINDS.has(kind)
    placeBlocking(kind, storage ? true : rng() < 0.5, storage ? storagePool : supportPool)
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
 *  - COZINHA na parede norte, recuada do canto oeste: cafeteira EM CIMA da
 *    bancada (rooms.ts pousa no tampo) e bebedouro no mesmo conjunto.
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
  // O tampo tem overhang visual além do footprint. Reserva também a lateral
  // oeste, que antes deixava o boss encostar o corpo dentro do mesão.
  block(MEET.x - 1, MEET.y)
  block(MEET.x - 1, MEET.y + 1)
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
  place("rug-large", LOUNGE.x - 2, LOUNGE.y - 1, { offset: { x: 0, y: 0.6 } })
  place("sofa", LOUNGE.x, LOUNGE.y) // encosto ao norte — olha a mesinha
  place("coffee-table", LOUNGE.x, LOUNGE.y + 1, { offset: { x: 0.5, y: 0 } }) // eixo do sofá
  block(LOUNGE.x + 1, LOUNGE.y + 1) // metade leste da mesinha (offset +0.5)
  place("plant-b", LOUNGE.x - 1, LOUNGE.y + 1) // fecha o conjunto, com respiro da parede leste

  // --- CONJUNTO COZINHA (parede norte, recuado do canto oeste) -------------
  // A antiga bancada 1×2 começava em rx=0 e era cortada pela parede oeste.
  // Agora o conjunto corre ao longo da parede norte e deixa um tile inteiro
  // de respiro em relação ao encontro das paredes.
  place("kitchen-counter", 1, 0) // bancada 2×1, pia na metade leste
  place("coffee-machine", 1, 0) // EM CIMA da metade oeste da bancada
  place("water-cooler", 3, 0) // mesma linha, sem invadir porta/circulação

  return {
    id: COMMONS_ID,
    origin: { x: cox, y: coy },
    w: COMMONS_W,
    h: COMMONS_H,
    doorTiles,
    decor,
  }
}

/** Infraestrutura do corredor. O eixo de circulação fica deliberadamente sem
 * vasos ou sinalização solta; o único marco é o QUADRO DE AVISOS na parede
 * norte (tile.y = linha de parede, corridorTop − 1) — os agendados moram nele
 * (interactable NOTICE_BOARD_ID, registrado no buildFloorPlan). */
function decorateCorridor(noticeBoardTile: Vec2): RoomDecorItem[] {
  return [{ kind: "notice-board", tile: noticeBoardTile }]
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

  /** Projetos mantêm suas coordenadas; a diretoria ocupa a última coluna. */
  const projectRoomsW = WALL + nCols * (ROOM_W + WALL)
  const roomsW = projectRoomsW + BOSS_ROOM_W + WALL
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

    // Cada estação ocupa um bay real: zona técnica junto à parede (ry=0),
    // clearance da cadeira (ry=1), mesa (ry=2) e atendimento (ry=3). A linha
    // ry=4 fica integralmente livre para o boss cruzar a sala.
    const deskY = oy + DESK_Y_INSET
    const frontY = deskY + 1
    const desks: DeskPlacement[] = OFFICE_AGENTS.map((agent, k) => {
      const dx = ox + DESK_XS[k]
      // Flip variado mas determinístico (função do índice do projeto + mesa).
      const flip = (i + k) % 2 === 1
      // A cadeira/agent não é piso atravessável. A linha de fundo (ry=0)
      // continua visualmente livre e absorve a profundidade do avatar.
      set(dx, deskY - 1, 0)
      set(dx + 1, deskY - 1, 0)
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

  // Diretoria: layout fixo. Estação em L na parede norte, atendimento no eixo
  // central e apoio na parede oeste; a circulação porta→mesa permanece livre.
  const bossOrigin = { x: projectRoomsW, y: WALL }
  for (let y = bossOrigin.y; y < bossOrigin.y + BOSS_ROOM_H; y++) {
    for (let x = bossOrigin.x; x < bossOrigin.x + BOSS_ROOM_W; x++) set(x, y, T_WALK)
  }
  const bossDoorTiles: Vec2[] = [
    { x: bossOrigin.x + BOSS_ROOM_W / 2 - 1, y: bossOrigin.y + BOSS_ROOM_H },
    { x: bossOrigin.x + BOSS_ROOM_W / 2, y: bossOrigin.y + BOSS_ROOM_H },
  ]
  for (const d of bossDoorTiles) set(d.x, d.y, T_WALK | T_DOOR)
  const bossDeskTile = { x: bossOrigin.x + 3, y: bossOrigin.y + 1 }
  const bossDeskFootprint = { ...EXECUTIVE_STATION_SPEC.footprint }
  for (let fy = 0; fy < bossDeskFootprint.h; fy++) {
    for (let fx = 0; fx < bossDeskFootprint.w; fx++) {
      set(bossDeskTile.x + fx, bossDeskTile.y + fy, 0)
    }
  }
  const bossDeskAnchor = {
    x: bossDeskTile.x + EXECUTIVE_STATION_SPEC.anchorFromTile.x,
    y: bossDeskTile.y + EXECUTIVE_STATION_SPEC.anchorFromTile.y,
  }
  const bossInteractTile = {
    x: bossDeskAnchor.x + EXECUTIVE_STATION_SPEC.interaction.x,
    y: bossDeskAnchor.y + EXECUTIVE_STATION_SPEC.interaction.y,
  }
  set(bossInteractTile.x, bossInteractTile.y, T_WALK | T_INTERACT)
  const operator = EXECUTIVE_STATION_SPEC.operator
  const chairTile = furnitureRectTile(bossDeskAnchor, operator.chairCollision)
  const chairOffset = {
    x: operator.chairVisual.x - operator.chairCollision.x,
    y: operator.chairVisual.y - operator.chairCollision.y,
  }
  const visitorItems: RoomDecorItem[] = EXECUTIVE_STATION_SPEC.visitors.map((visitor) => ({
    kind: "executive-visitor-chair",
    tile: furnitureRectTile(bossDeskAnchor, {
      ...visitor.center,
      ...visitor.footprint,
    }),
  }))
  const bossDecor: RoomDecorItem[] = [
    { kind: "rug-large", tile: { x: bossOrigin.x + 3, y: bossOrigin.y + 3 } },
    { kind: "executive-chair", tile: chairTile, offset: chairOffset },
    ...visitorItems,
    { kind: "executive-sideboard", tile: { x: bossOrigin.x, y: bossOrigin.y + 1 } },
    { kind: "plant-b", tile: { x: bossOrigin.x + 8, y: bossOrigin.y + 1 } },
    { kind: "whiteboard", tile: { x: bossOrigin.x + 7, y: bossOrigin.y - 1 } },
  ]
  for (const item of bossDecor) {
    if (!isBlockingDecor(item.kind)) continue
    const fp = DECOR_FOOTPRINTS[item.kind] ?? { w: 1, h: 1 }
    for (let fy = 0; fy < fp.h; fy++) {
      for (let fx = 0; fx < fp.w; fx++) set(item.tile.x + fx, item.tile.y + fy, 0)
    }
  }
  const bossRoom: BossRoomPlacement = {
    id: "boss",
    origin: bossOrigin,
    w: BOSS_ROOM_W,
    h: BOSS_ROOM_H,
    doorTiles: bossDoorTiles,
    deskTile: bossDeskTile,
    deskFootprint: bossDeskFootprint,
    interactTile: bossInteractTile,
    decor: bossDecor,
  }

  // O usuário começa em sua própria sala, diante da área de briefing.
  // Centro VISUAL entre as duas cadeiras na projeção (sx = x - y). O centro
  // cartesiano anterior deixava o avatar tangente à cadeira oeste.
  const spawn: Vec2 = { x: bossOrigin.x + 6, y: bossOrigin.y + 5.5 }

  const plan: FloorPlan = { w, h, grid, rooms, spawn, bossRoom, corridorDecor: [] }

  // Decoração — ordem fixa: sala comum (layout fixo) → salas (seed por
  // projectId) → corredor (seed pela lista de projetos).
  plan.commonRoom = buildCommons(plan, commonsOrigin, corridorTop)
  // Mesa de reunião = ponto de interação SEM agent (O-2 — lançar missão):
  // entra na proximidade do boss; âncora do balão no centro do mesão 4×2
  // (rx 4–7, ry 3–4 ⇒ centro rel 6,4; tile-âncora em float, só projeção).
  const missionTable: OfficeInteractable = {
    id: MISSION_TABLE_ID,
    tile: { x: commonsOrigin.x + 6, y: commonsOrigin.y + 4 },
    footprint: { w: 4, h: 2 },
    interactTile: { x: commonsOrigin.x + 6, y: commonsOrigin.y + 6 },
  }
  // Posto de comando (§8): a mesa executiva entra na MESMA disputa de
  // proximidade das mesas — chegar nela mostra o menu "Abrir Central". A
  // âncora do interactable é CENTRADA (interactableContainsWorld) e o
  // bossDeskAnchor já é o centro do footprint 4×2 da estação executiva.
  const bossDesk: OfficeInteractable = {
    id: BOSS_DESK_ID,
    tile: bossDeskAnchor,
    footprint: bossDeskFootprint,
    interactTile: bossInteractTile,
  }
  // Quadro de avisos: parede norte do corredor (linha de parede corridorTop−1),
  // a LESTE da porta da diretoria (portas em bossOrigin.x+4/5 — nunca colide) e
  // a oeste da porta da sala comum. O interactTile é o tile do corredor logo
  // abaixo; a âncora do balão/hit é o CENTRO do tile de parede
  // (interactableContainsWorld), com footprint 2×2 pra apanhar cliques no
  // quadro desenhado acima da linha de chão.
  const noticeBoardTile = { x: bossOrigin.x + 7, y: corridorTop - 1 }
  const boardInteractTile = { x: noticeBoardTile.x, y: corridorTop }
  set(boardInteractTile.x, boardInteractTile.y, T_WALK | T_INTERACT)
  const noticeBoard: OfficeInteractable = {
    id: NOTICE_BOARD_ID,
    tile: { x: noticeBoardTile.x + 0.5, y: noticeBoardTile.y + 0.5 },
    footprint: { w: 2, h: 2 },
    interactTile: boardInteractTile,
  }
  plan.interactables = [missionTable, bossDesk, noticeBoard]
  for (const room of rooms) {
    room.decor = decorateRoom(plan, room, mulberry32(hashSeed(room.projectId)))
  }
  plan.corridorDecor = decorateCorridor(noticeBoardTile)

  return plan
}
