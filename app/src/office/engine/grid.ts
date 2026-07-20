/** Helpers sobre a grid global do FloorPlan (Uint8Array com bitflags — O5).
 *  Índice do tile: idx = y * plan.w + x. Fora dos limites = bloqueado.
 */
import { T_DOOR, T_WALK } from "./types"
import type { FloorPlan, Vec2 } from "./types"

/** Folga numérica: AABB encostada exatamente na borda de um tile NÃO o ocupa
 *  (permite deslizar rente à parede sem colidir). */
const AABB_EPS = 1e-6

export function inBounds(plan: FloorPlan, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < plan.w && y < plan.h
}

/** Tile (inteiro) tem TODOS os bits de `flag`? Fora dos limites ⇒ false. */
export function hasFlag(plan: FloorPlan, x: number, y: number, flag: number): boolean {
  if (!inBounds(plan, x, y)) return false
  return (plan.grid[y * plan.w + x] & flag) === flag
}

/** Liga bits de `flag` no tile (no-op fora dos limites). */
export function setFlag(plan: FloorPlan, x: number, y: number, flag: number): void {
  if (!inBounds(plan, x, y)) return
  plan.grid[y * plan.w + x] |= flag
}

/** Tile caminhável: T_WALK ou T_DOOR (porta é passagem mesmo que o layout não
 *  marque T_WALK junto — defensivo). */
export function walkable(plan: FloorPlan, x: number, y: number): boolean {
  if (!inBounds(plan, x, y)) return false
  return (plan.grid[y * plan.w + x] & (T_WALK | T_DOOR)) !== 0
}

/** AABB dos pés (centro cx,cy; meia-largura `half`, em tiles) só sobre tiles
 *  caminháveis? Usada pelo move-and-slide e pelo string-pulling. */
export function aabbFree(plan: FloorPlan, cx: number, cy: number, half: number): boolean {
  const x0 = Math.floor(cx - half + AABB_EPS)
  const x1 = Math.floor(cx + half - AABB_EPS)
  const y0 = Math.floor(cy - half + AABB_EPS)
  const y1 = Math.floor(cy + half - AABB_EPS)
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!walkable(plan, tx, ty)) return false
    }
  }
  return true
}

/** Clamp de clique bloqueado: ponto contínuo → ponto caminhável mais próximo.
 *  Se o tile sob (x, y) já é caminhável, devolve o próprio ponto (preserva a
 *  precisão do clique); senão, o CENTRO do tile caminhável mais próximo num
 *  raio Chebyshev de `maxR` tiles — ou null se não houver nenhum. */
export function nearestWalkable(plan: FloorPlan, x: number, y: number, maxR: number): Vec2 | null {
  const tx = Math.floor(x)
  const ty = Math.floor(y)
  if (walkable(plan, tx, ty)) return { x, y }
  let best: Vec2 | null = null
  let bestD = Infinity
  for (let dy = -maxR; dy <= maxR; dy++) {
    for (let dx = -maxR; dx <= maxR; dx++) {
      const nx = tx + dx
      const ny = ty + dy
      if (!walkable(plan, nx, ny)) continue
      const cx = nx + 0.5
      const cy = ny + 0.5
      const d = Math.hypot(cx - x, cy - y)
      if (d < bestD) {
        bestD = d
        best = { x: cx, y: cy }
      }
    }
  }
  return best
}
