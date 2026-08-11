import { describe, expect, it } from "vitest"
import { inputDirToWorld, tileAt, toScreen, toWorld } from "./iso"
import { TILE_H, TILE_W } from "@/lib/fleet/types"

describe("projeção diamond 2:1", () => {
  it("round-trip toScreen → toWorld devolve o ponto original", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 3.5, y: 7.25 },
      { x: -2.75, y: 4.125 },
      { x: 123.456, y: 0.001 },
    ]
    for (const p of pts) {
      const s = toScreen(p.x, p.y)
      const w = toWorld(s.x, s.y)
      expect(w.x).toBeCloseTo(p.x, 9)
      expect(w.y).toBeCloseTo(p.y, 9)
    }
  })

  it("round-trip toWorld → toScreen devolve o px original", () => {
    const s0 = { x: 137, y: -42.5 }
    const w = toWorld(s0.x, s0.y)
    const s1 = toScreen(w.x, w.y)
    expect(s1.x).toBeCloseTo(s0.x, 9)
    expect(s1.y).toBeCloseTo(s0.y, 9)
  })

  it("usa as fórmulas fechadas do contrato", () => {
    const s = toScreen(3, 1)
    expect(s.x).toBe((3 - 1) * (TILE_W / 2))
    expect(s.y).toBe((3 + 1) * (TILE_H / 2))
  })

  it("tileAt devolve o tile inteiro sob o ponto de tela", () => {
    // Centro do tile (2, 3) em mundo contínuo é (2.5, 3.5).
    const s = toScreen(2.5, 3.5)
    expect(tileAt(s.x, s.y)).toEqual({ x: 2, y: 3 })
  })
})

describe("inputDirToWorld (tela → mundo)", () => {
  const DIRS: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]

  it("|wdir| = 1 nas 8 direções (mesma velocidade em todas)", () => {
    for (const [ix, iy] of DIRS) {
      const d = inputDirToWorld(ix, iy)
      expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 12)
    }
  })

  it("sem input devolve vetor nulo", () => {
    expect(inputDirToWorld(0, 0)).toEqual({ x: 0, y: 0 })
  })

  it("direita de TELA (ix=1) anda para a direita da tela, sem subir/descer", () => {
    const d = inputDirToWorld(1, 0)
    const s = toScreen(d.x, d.y)
    expect(s.x).toBeGreaterThan(0)
    expect(s.y).toBeCloseTo(0, 12)
  })

  it("cima de TELA (iy=-1) sobe na tela, sem andar de lado", () => {
    const d = inputDirToWorld(0, -1)
    const s = toScreen(d.x, d.y)
    expect(s.y).toBeLessThan(0)
    expect(s.x).toBeCloseTo(0, 12)
  })
})
