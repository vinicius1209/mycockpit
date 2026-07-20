import { describe, expect, it } from "vitest"
import { findPath, segmentFree, stringPull } from "./astar"
import { aabbFree } from "./grid"
import { BODY_HALF, T_WALK } from "./types"
import type { FloorPlan, Vec2 } from "./types"

/** Planta de teste: tudo caminhável, menos os tiles em `blocked`. */
function makePlan(w: number, h: number, blocked: Vec2[] = []): FloorPlan {
  const grid = new Uint8Array(w * h).fill(T_WALK)
  for (const b of blocked) grid[b.y * w + b.x] = 0
  return { w, h, grid, rooms: [], spawn: { x: w / 2, y: h / 2 } }
}

/** O polilinha from→path passa só por área livre (amostragem fina da AABB)? */
function pathClear(plan: FloorPlan, from: Vec2, path: Vec2[]): boolean {
  let prev = from
  for (const wp of path) {
    const steps = Math.max(1, Math.ceil(Math.hypot(wp.x - prev.x, wp.y - prev.y) / 0.02))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const x = prev.x + (wp.x - prev.x) * t
      const y = prev.y + (wp.y - prev.y) * t
      if (!aabbFree(plan, x, y, BODY_HALF)) return false
    }
    prev = wp
  }
  return true
}

function pathLength(from: Vec2, path: Vec2[]): number {
  let len = 0
  let prev = from
  for (const wp of path) {
    len += Math.hypot(wp.x - prev.x, wp.y - prev.y)
    prev = wp
  }
  return len
}

describe("findPath (A* 8-direções)", () => {
  it("linha reta livre vira um único waypoint (string-pulling)", () => {
    const plan = makePlan(12, 5)
    const path = findPath(plan, { x: 1.5, y: 2.5 }, { x: 10.5, y: 2.5 })
    expect(path).not.toBeNull()
    expect(path!.length).toBe(1)
    expect(path![0].x).toBeCloseTo(10.5, 9)
    expect(path![0].y).toBeCloseTo(2.5, 9)
  })

  it("NÃO corta canto: diagonal com os dois ortogonais bloqueados contorna", () => {
    // . . . . .        b = bloqueado; ir de (1,1) a (2,2) na diagonal é proibido
    // . A b . .        porque (2,1) e (1,2) estão bloqueados.
    // . b B . .
    const plan = makePlan(5, 5, [
      { x: 2, y: 1 },
      { x: 1, y: 2 },
    ])
    const from = { x: 1.5, y: 1.5 }
    const path = findPath(plan, from, { x: 2.5, y: 2.5 })
    expect(path).not.toBeNull()
    // Contorno real: bem mais longo que a diagonal direta (~1.41).
    expect(pathLength(from, path!)).toBeGreaterThan(3)
    expect(pathClear(plan, from, path!)).toBe(true)
  })

  it("passagem diagonal selada (2×2) é inalcançável ⇒ null", () => {
    const plan = makePlan(2, 2, [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ])
    expect(findPath(plan, { x: 0.5, y: 0.5 }, { x: 1.5, y: 1.5 })).toBeNull()
  })

  it("clique em tile bloqueado clampa para o caminhável mais próximo", () => {
    const wall: Vec2[] = []
    for (let y = 0; y < 6; y++) wall.push({ x: 3, y })
    const plan = makePlan(6, 6, wall)
    const path = findPath(plan, { x: 1.5, y: 2.5 }, { x: 3.4, y: 2.5 })
    expect(path).not.toBeNull()
    const last = path![path!.length - 1]
    expect(last).toEqual({ x: 2.5, y: 2.5 }) // centro do tile vizinho à parede
  })

  it("desvio por porta de 1 tile: caminho existe e nunca atravessa a parede", () => {
    // Parede vertical na coluna 5, com vão só em y=1.
    const wall: Vec2[] = []
    for (let y = 0; y < 7; y++) if (y !== 1) wall.push({ x: 5, y })
    const plan = makePlan(12, 7, wall)
    const from = { x: 2.5, y: 4.5 }
    const path = findPath(plan, from, { x: 8.5, y: 4.5 })
    expect(path).not.toBeNull()
    expect(pathClear(plan, from, path!)).toBe(true)
    // Passou pelo vão: alguma amostra do caminho cruza a coluna 5 em y ∈ [1, 2).
    const crossesGap = path!.some((wp) => wp.x > 4 && wp.x < 7 && wp.y < 2.6)
    expect(crossesGap).toBe(true)
  })
})

describe("stringPull", () => {
  it("reduz waypoints de um caminho em escada sem atravessar parede", () => {
    const plan = makePlan(10, 10)
    // Caminho cru em escada (como um A* devolveria), tudo em área livre.
    const raw: Vec2[] = [
      { x: 1.5, y: 1.5 },
      { x: 2.5, y: 2.5 },
      { x: 3.5, y: 3.5 },
      { x: 4.5, y: 4.5 },
      { x: 5.5, y: 5.5 },
      { x: 6.5, y: 6.5 },
    ]
    const pulled = stringPull(plan, raw, BODY_HALF)
    expect(pulled.length).toBeLessThan(raw.length)
    expect(pulled.length).toBe(2) // reta livre: âncora + destino
    expect(pathClear(plan, pulled[0], pulled.slice(1))).toBe(true)
  })

  it("mantém o desvio quando há parede entre os waypoints", () => {
    const wall: Vec2[] = []
    for (let y = 2; y < 8; y++) wall.push({ x: 4, y })
    const plan = makePlan(10, 10, wall)
    const raw: Vec2[] = [
      { x: 2.5, y: 5.5 },
      { x: 3.5, y: 4.5 },
      { x: 3.5, y: 3.5 },
      { x: 3.5, y: 2.5 },
      { x: 3.5, y: 1.5 },
      { x: 4.5, y: 1.5 }, // contorna por cima da parede (linha y=1 livre)
      { x: 5.5, y: 1.5 },
      { x: 5.5, y: 2.5 },
      { x: 6.5, y: 3.5 },
      { x: 6.5, y: 4.5 },
      { x: 6.5, y: 5.5 },
    ]
    const pulled = stringPull(plan, raw, BODY_HALF)
    expect(pulled.length).toBeLessThan(raw.length)
    expect(pathClear(plan, pulled[0], pulled.slice(1))).toBe(true)
  })
})

describe("segmentFree", () => {
  it("segmento rente à parede respeita a folga dos pés", () => {
    const plan = makePlan(8, 4, [
      { x: 3, y: 1 },
      { x: 4, y: 1 },
    ])
    // Passa longe da parede: livre.
    expect(segmentFree(plan, { x: 1.5, y: 2.9 }, { x: 6.5, y: 2.9 }, BODY_HALF)).toBe(true)
    // Centro a 0.2 da parede (< BODY_HALF): a caixa invade ⇒ bloqueado.
    expect(segmentFree(plan, { x: 1.5, y: 2.2 }, { x: 6.5, y: 2.2 }, BODY_HALF)).toBe(false)
  })
})
