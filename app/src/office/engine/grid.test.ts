import { describe, expect, it } from "vitest"
import { aabbFree, hasFlag, nearestWalkable, setFlag, walkable } from "./grid"
import { T_DOOR, T_INTERACT, T_WALK } from "@/lib/fleet/types"
import type { FloorPlan, Vec2 } from "@/lib/fleet/types"

/** Planta de teste: tudo caminhável, menos os tiles em `blocked`. */
function makePlan(w: number, h: number, blocked: Vec2[] = []): FloorPlan {
  const grid = new Uint8Array(w * h).fill(T_WALK)
  for (const b of blocked) grid[b.y * w + b.x] = 0
  return { w, h, grid, rooms: [], spawn: { x: w / 2, y: h / 2 } }
}

describe("flags da grid", () => {
  it("setFlag/hasFlag ligam e leem bits sem apagar os demais", () => {
    const plan = makePlan(4, 4)
    setFlag(plan, 1, 1, T_INTERACT)
    expect(hasFlag(plan, 1, 1, T_INTERACT)).toBe(true)
    expect(hasFlag(plan, 1, 1, T_WALK)).toBe(true)
    expect(hasFlag(plan, 2, 2, T_INTERACT)).toBe(false)
  })

  it("fora dos limites é bloqueado e setFlag é no-op", () => {
    const plan = makePlan(4, 4)
    expect(hasFlag(plan, -1, 0, T_WALK)).toBe(false)
    expect(walkable(plan, 4, 0)).toBe(false)
    setFlag(plan, -1, 0, T_WALK) // não explode
  })

  it("porta conta como caminhável mesmo sem T_WALK", () => {
    const plan = makePlan(4, 4, [{ x: 2, y: 2 }])
    expect(walkable(plan, 2, 2)).toBe(false)
    plan.grid[2 * 4 + 2] = T_DOOR
    expect(walkable(plan, 2, 2)).toBe(true)
  })
})

describe("aabbFree (colisão dos pés)", () => {
  it("caixa inteira dentro de tile caminhável é livre", () => {
    const plan = makePlan(4, 4, [{ x: 2, y: 1 }])
    expect(aabbFree(plan, 1.5, 1.5, 0.28)).toBe(true)
  })

  it("caixa invadindo tile bloqueado colide", () => {
    const plan = makePlan(4, 4, [{ x: 2, y: 1 }])
    expect(aabbFree(plan, 1.9, 1.5, 0.28)).toBe(false)
  })

  it("encostar exatamente na borda do tile bloqueado NÃO colide (desliza rente)", () => {
    const plan = makePlan(4, 4, [{ x: 2, y: 1 }])
    expect(aabbFree(plan, 2 - 0.28, 1.5, 0.28)).toBe(true)
  })
})

describe("nearestWalkable (clamp de clique bloqueado)", () => {
  it("ponto já caminhável volta intacto (precisão do clique)", () => {
    const plan = makePlan(6, 6)
    expect(nearestWalkable(plan, 2.3, 4.7, 3)).toEqual({ x: 2.3, y: 4.7 })
  })

  it("ponto bloqueado clampa para o centro do tile caminhável mais próximo", () => {
    const plan = makePlan(6, 6, [
      { x: 3, y: 0 },
      { x: 3, y: 1 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
      { x: 3, y: 4 },
      { x: 3, y: 5 },
    ])
    // Clique em (3.2, 2.5): parede na coluna 3 — mais perto é (2.5, 2.5).
    expect(nearestWalkable(plan, 3.2, 2.5, 4)).toEqual({ x: 2.5, y: 2.5 })
  })

  it("sem caminhável no raio devolve null", () => {
    const grid = new Uint8Array(5 * 5) // tudo bloqueado
    const plan: FloorPlan = { w: 5, h: 5, grid, rooms: [], spawn: { x: 2, y: 2 } }
    expect(nearestWalkable(plan, 2.5, 2.5, 2)).toBeNull()
  })
})
