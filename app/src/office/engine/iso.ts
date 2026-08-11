/** Projeção isométrica diamond 2:1 (decisão O4 do design doc).
 *
 *  Mundo em unidades de TILE (contínuas, float); tela em px.
 *    sx = (wx - wy) * TILE_W/2
 *    sy = (wx + wy) * TILE_H/2
 *  Inversa (fechada — picking sem busca):
 *    wx = sx/TILE_W + sy/TILE_H
 *    wy = sy/TILE_H - sx/TILE_W
 */
import { TILE_H, TILE_W } from "@/lib/fleet/types"
import type { Vec2 } from "@/lib/fleet/types"

/** Mundo (tiles contínuos) → tela (px, origem no tile 0,0). */
export function toScreen(wx: number, wy: number): Vec2 {
  return { x: (wx - wy) * (TILE_W / 2), y: (wx + wy) * (TILE_H / 2) }
}

/** Tela (px) → mundo (tiles contínuos). */
export function toWorld(sx: number, sy: number): Vec2 {
  return { x: sx / TILE_W + sy / TILE_H, y: sy / TILE_H - sx / TILE_W }
}

/** Tile inteiro sob um ponto de tela (px). */
export function tileAt(sx: number, sy: number): Vec2 {
  const w = toWorld(sx, sy)
  return { x: Math.floor(w.x), y: Math.floor(w.y) }
}

/** Direção de input em espaço de TELA (ix, iy ∈ {-1, 0, 1}; → e ↓ positivos)
 *  convertida para direção de MUNDO normalizada: wdir = (ix + iy, iy - ix).
 *  Normalizar aqui garante |velocidade| igual nas 8 direções (teste de engine). */
export function inputDirToWorld(ix: number, iy: number): Vec2 {
  const wx = ix + iy
  const wy = iy - ix
  const len = Math.hypot(wx, wy)
  if (len === 0) return { x: 0, y: 0 }
  return { x: wx / len, y: wy / len }
}
