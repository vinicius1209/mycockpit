/** A* 8-direções + string-pulling sobre a grid do FloorPlan (decisão O5).
 *
 *  - Heap binário próprio (sem dependência de pathfinding).
 *  - Heurística octile.
 *  - PROIBIDO corner-cutting: diagonal só quando AMBOS os ortogonais estão livres.
 *  - String-pulling por raycast DDA na grid respeitando a folga `half` dos pés.
 *  - Entrada/saída em coordenadas CONTÍNUAS (tiles float); o A* roda em tiles
 *    inteiros por dentro. Clique em tile bloqueado clampa via nearestWalkable.
 */
import { BODY_HALF } from "@/lib/fleet/types"
import type { FloorPlan, Vec2 } from "@/lib/fleet/types"
import { aabbFree, nearestWalkable, walkable } from "./grid"

/** Raio máximo (tiles) do clamp de clique em tile bloqueado. */
export const CLICK_CLAMP_R = 6

const SQRT2 = Math.SQRT2

// ---------------------------------------------------------------------------
// Heap binário mínimo (índices de tile + fScore, arrays paralelos)
// ---------------------------------------------------------------------------

class MinHeap {
  private items: number[] = []
  private scores: number[] = []

  get size(): number {
    return this.items.length
  }

  push(item: number, score: number): void {
    const { items, scores } = this
    let i = items.length
    items.push(item)
    scores.push(score)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (scores[p] <= scores[i]) break
      const ti = items[p]
      items[p] = items[i]
      items[i] = ti
      const ts = scores[p]
      scores[p] = scores[i]
      scores[i] = ts
      i = p
    }
  }

  pop(): number {
    const { items, scores } = this
    const top = items[0]
    const lastItem = items.pop()!
    const lastScore = scores.pop()!
    if (items.length > 0) {
      items[0] = lastItem
      scores[0] = lastScore
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < items.length && scores[l] < scores[m]) m = l
        if (r < items.length && scores[r] < scores[m]) m = r
        if (m === i) break
        const ti = items[m]
        items[m] = items[i]
        items[i] = ti
        const ts = scores[m]
        scores[m] = scores[i]
        scores[i] = ts
        i = m
      }
    }
    return top
  }
}

// ---------------------------------------------------------------------------
// A* em tiles inteiros
// ---------------------------------------------------------------------------

/** 8 vizinhos: [dx, dy, custo]. */
const DIRS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
]

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx)
  const dy = Math.abs(ay - by)
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)
}

/** A* de (sx,sy) a (gx,gy) em tiles inteiros. Devolve a sequência de tiles
 *  (inclui origem e destino) ou null se inalcançável. */
function astarTiles(plan: FloorPlan, sx: number, sy: number, gx: number, gy: number): Vec2[] | null {
  const w = plan.w
  const n = w * plan.h
  const g = new Float64Array(n).fill(Infinity)
  const came = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const heap = new MinHeap()
  const start = sy * w + sx
  const goal = gy * w + gx

  g[start] = 0
  heap.push(start, octile(sx, sy, gx, gy))

  while (heap.size > 0) {
    const cur = heap.pop()
    if (closed[cur]) continue
    closed[cur] = 1
    if (cur === goal) break
    const cx = cur % w
    const cy = (cur / w) | 0
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx
      const ny = cy + dy
      if (!walkable(plan, nx, ny)) continue
      // Sem corner-cutting: diagonal exige os DOIS ortogonais livres.
      if (dx !== 0 && dy !== 0 && (!walkable(plan, cx + dx, cy) || !walkable(plan, cx, cy + dy))) continue
      const ni = ny * w + nx
      if (closed[ni]) continue
      const ng = g[cur] + cost
      if (ng < g[ni]) {
        g[ni] = ng
        came[ni] = cur
        heap.push(ni, ng + octile(nx, ny, gx, gy))
      }
    }
  }

  if (!closed[goal]) return null
  const out: Vec2[] = []
  let i = goal
  while (i !== -1) {
    out.push({ x: i % w, y: (i / w) | 0 })
    i = came[i]
  }
  out.reverse()
  return out
}

// ---------------------------------------------------------------------------
// Raycast DDA + string-pulling com folga
// ---------------------------------------------------------------------------

/** DDA (Amanatides & Woo): todos os tiles cruzados pelo segmento são
 *  caminháveis? Cruzamento exato de quina conta os dois tiles (conservador). */
function rayFree(plan: FloorPlan, ax: number, ay: number, bx: number, by: number): boolean {
  let tx = Math.floor(ax)
  let ty = Math.floor(ay)
  const ex = Math.floor(bx)
  const ey = Math.floor(by)
  if (!walkable(plan, tx, ty)) return false

  const dx = bx - ax
  const dy = by - ay
  const stepX = dx > 0 ? 1 : -1
  const stepY = dy > 0 ? 1 : -1
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity
  let tMaxX = dx !== 0 ? (stepX > 0 ? tx + 1 - ax : ax - tx) * tDeltaX : Infinity
  let tMaxY = dy !== 0 ? (stepY > 0 ? ty + 1 - ay : ay - ty) * tDeltaY : Infinity

  let guard = Math.abs(ex - tx) + Math.abs(ey - ty) + 4
  while ((tx !== ex || ty !== ey) && guard-- > 0) {
    if (tMaxX < tMaxY) {
      tx += stepX
      tMaxX += tDeltaX
    } else {
      ty += stepY
      tMaxY += tDeltaY
    }
    if (!walkable(plan, tx, ty)) return false
  }
  // Guard esgotado (degeneração numérica) ⇒ conservador: considera bloqueado.
  return tx === ex && ty === ey
}

/** Segmento a→b é atravessável por uma AABB de meia-largura `half`?
 *  Endpoints via aabbFree + 4 raios nos cantos da caixa (metodologia válida
 *  enquanto 2*half ≤ 1 tile — vale para BODY_HALF). */
export function segmentFree(plan: FloorPlan, a: Vec2, b: Vec2, half: number): boolean {
  if (!aabbFree(plan, a.x, a.y, half) || !aabbFree(plan, b.x, b.y, half)) return false
  const h = Math.max(0, half - 1e-4) // mesma semântica de borda aberta da aabbFree
  const offsets: readonly (readonly [number, number])[] =
    h > 0
      ? [
          [-h, -h],
          [h, -h],
          [-h, h],
          [h, h],
        ]
      : [[0, 0]]
  for (const [ox, oy] of offsets) {
    if (!rayFree(plan, a.x + ox, a.y + oy, b.x + ox, b.y + oy)) return false
  }
  return true
}

/** String-pulling guloso: do waypoint-âncora, salta para o mais distante
 *  visível (segmentFree com folga `half`); reduz waypoints sem atravessar
 *  parede. Devolve um caminho novo (não muta a entrada). */
export function stringPull(plan: FloorPlan, path: Vec2[], half: number): Vec2[] {
  if (path.length <= 2) return path.slice()
  const out: Vec2[] = [path[0]]
  let anchor = 0
  while (anchor < path.length - 1) {
    let next = anchor + 1
    for (let j = path.length - 1; j > anchor + 1; j--) {
      if (segmentFree(plan, path[anchor], path[j], half)) {
        next = j
        break
      }
    }
    out.push(path[next])
    anchor = next
  }
  return out
}

// ---------------------------------------------------------------------------
// API principal
// ---------------------------------------------------------------------------

/** Caminho contínuo de `from` a `to` (waypoints SEM o ponto de partida; o boss
 *  anda direto ao primeiro). Destino em tile bloqueado clampa para o caminhável
 *  mais próximo (raio CLICK_CLAMP_R). Devolve null se inalcançável. */
export function findPath(plan: FloorPlan, from: Vec2, to: Vec2): Vec2[] | null {
  const start = nearestWalkable(plan, from.x, from.y, 2)
  if (!start) return null
  const goal = nearestWalkable(plan, to.x, to.y, CLICK_CLAMP_R)
  if (!goal) return null

  const sx = Math.floor(start.x)
  const sy = Math.floor(start.y)
  const gx = Math.floor(goal.x)
  const gy = Math.floor(goal.y)

  // Ponto final precisa caber com a folga dos pés; senão recua ao centro do tile.
  const goalPt: Vec2 = aabbFree(plan, goal.x, goal.y, BODY_HALF)
    ? { x: goal.x, y: goal.y }
    : { x: gx + 0.5, y: gy + 0.5 }

  if (sx === gx && sy === gy) return [goalPt]

  const tiles = astarTiles(plan, sx, sy, gx, gy)
  if (!tiles) return null

  // Centros contínuos; primeiro = posição real, último = ponto clampado do clique.
  const pts: Vec2[] = tiles.map((t) => ({ x: t.x + 0.5, y: t.y + 0.5 }))
  pts[0] = { x: start.x, y: start.y }
  pts[pts.length - 1] = goalPt

  const pulled = stringPull(plan, pts, BODY_HALF)
  return pulled.length > 1 ? pulled.slice(1) : pulled
}
