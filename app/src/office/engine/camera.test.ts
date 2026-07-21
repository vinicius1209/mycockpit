import { describe, expect, it } from "vitest"
import {
  DEAD_H,
  ZOOM_FREEZE_S,
  ZOOM_MAX,
  ZOOM_MIN,
  setInspect,
  snapInspect,
  updateCamera,
  zoomAt,
} from "./camera"
import { toScreen, toWorld } from "./iso"
import { createWorld } from "./sim"
import { SIM_DT, T_WALK } from "./types"
import type { FloorPlan, Vec2, World } from "./types"

function makePlan(w: number, h: number): FloorPlan {
  return { w, h, grid: new Uint8Array(w * h).fill(T_WALK), rooms: [], spawn: { x: w / 2, y: h / 2 } }
}

function makeWorld(): World {
  return createWorld(makePlan(30, 30))
}

/** Ponto de MUNDO sob o cursor (px relativos ao centro do viewport). */
function pointUnderCursor(world: World, cx: number, cy: number): Vec2 {
  const s = toScreen(world.camera.pos.x, world.camera.pos.y)
  return toWorld(s.x + cx / world.camera.zoom, s.y + cy / world.camera.zoom)
}

describe("zoomAt", () => {
  it("mantém o ponto do mundo sob o cursor invariante", () => {
    const world = makeWorld()
    const cursor = { x: 120, y: -40 }
    const before = pointUnderCursor(world, cursor.x, cursor.y)
    zoomAt(world, cursor.x, cursor.y, 1.6)
    const after = pointUnderCursor(world, cursor.x, cursor.y)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
    expect(world.camera.zoom).toBeCloseTo(1.6, 9)
  })

  it("invariante também ao afastar (zoom out)", () => {
    const world = makeWorld()
    const before = pointUnderCursor(world, -80, 60)
    zoomAt(world, -80, 60, 0.7)
    const after = pointUnderCursor(world, -80, 60)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it("clampa o zoom em 0.5–2.5", () => {
    const world = makeWorld()
    zoomAt(world, 0, 0, 100)
    expect(world.camera.zoom).toBe(ZOOM_MAX)
    zoomAt(world, 0, 0, 0.0001)
    expect(world.camera.zoom).toBe(ZOOM_MIN)
  })

  it("congela o alvo do follow durante o gesto de zoom", () => {
    const world = makeWorld()
    expect(world.camera.zoomFreezeUntil).toBe(0) // createWorld: sem congelamento
    world.boss.pos = { x: 25, y: 25 } // bem fora da deadzone
    zoomAt(world, 0, 0, 1) // gesto em andamento (fator neutro)
    // bookkeeping no próprio CameraState (sem WeakMap paralelo)
    expect(world.camera.zoomFreezeUntil).toBeCloseTo(world.time + ZOOM_FREEZE_S, 9)
    const posAntes = { ...world.camera.pos }
    updateCamera(world, SIM_DT)
    expect(world.camera.pos).toEqual(posAntes) // congelado
    world.time = 1 // janela do gesto expirou
    updateCamera(world, SIM_DT)
    expect(world.camera.pos).not.toEqual(posAntes) // voltou a seguir
  })
})

describe("follow com deadzone", () => {
  it("boss dentro da deadzone não move a câmera", () => {
    const world = makeWorld()
    world.boss.pos = { x: 15.5, y: 15.5 } // erro de tela (0, 16px) < deadzone
    const posAntes = { ...world.camera.pos }
    updateCamera(world, SIM_DT)
    expect(world.camera.pos).toEqual(posAntes)
  })

  it("boss fora da deadzone aproxima a câmera até a borda da deadzone", () => {
    const world = makeWorld()
    world.boss.pos = { x: 19, y: 19 }
    updateCamera(world, SIM_DT)
    expect(world.camera.pos.x).toBeGreaterThan(15)
    expect(world.camera.pos.y).toBeGreaterThan(15)
    for (let i = 0; i < 600; i++) updateCamera(world, SIM_DT)
    const sb = toScreen(world.boss.pos.x, world.boss.pos.y)
    const sc = toScreen(world.camera.pos.x, world.camera.pos.y)
    const errY = Math.abs((sb.y - sc.y) * world.camera.zoom)
    expect(errY).toBeLessThanOrEqual(DEAD_H / 2 + 0.5)
  })

  it("prev é gravado a cada passo (interpolação da cena)", () => {
    const world = makeWorld()
    world.boss.pos = { x: 22, y: 22 }
    updateCamera(world, SIM_DT)
    const p1 = { ...world.camera.pos }
    updateCamera(world, SIM_DT)
    expect(world.camera.prev).toEqual(p1)
  })
})

describe("inspect", () => {
  it("setInspect persegue o alvo mesmo com o boss parado longe", () => {
    const world = makeWorld()
    setInspect(world, { x: 5, y: 5 })
    expect(world.camera.mode).toBe("inspect")
    for (let i = 0; i < 600; i++) updateCamera(world, SIM_DT)
    expect(world.camera.pos.x).toBeCloseTo(5, 1)
    expect(world.camera.pos.y).toBeCloseTo(5, 1)
  })

  it("snapInspect enquadra imediatamente e incorpora o offset da area segura", () => {
    const world = makeWorld()
    const target = { x: 12, y: 8 }
    world.camera.zoom = 1.2
    world.camera.screenOffset = { x: -190, y: 10 }

    snapInspect(world, target)

    const st = toScreen(target.x, target.y)
    const sc = toScreen(world.camera.pos.x, world.camera.pos.y)
    expect((st.x - sc.x) * world.camera.zoom).toBeCloseTo(-190, 9)
    expect((st.y - sc.y) * world.camera.zoom).toBeCloseTo(10, 9)
    expect(world.camera.prev).toEqual(world.camera.pos)
    expect(world.camera.inspectTarget).toEqual(target)
  })
})
