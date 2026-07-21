/** Testes do sistema de percurso de NPCs (walkers) — lógica pura de avanço
 *  (stepAlongPath) + ciclo de vida do sistema. Pixi instancia headless
 *  (Graphics/GraphicsContext sem renderer — mesmo padrão de props.test.ts). */
import { describe, expect, it } from "vitest"
import { T_WALK } from "../engine/types"
import type { FloorPlan, Vec2 } from "../engine/types"
import { findPath } from "../engine/astar"
import { createWalkerSystem, stepAlongPath, WALKER_SPEED } from "./walkers"

/** Planta aberta (tudo caminhável) — spawn irrelevante pros walkers. */
function openPlan(w = 16, h = 16): FloorPlan {
  const grid = new Uint8Array(w * h).fill(T_WALK)
  return { w, h, grid, rooms: [], spawn: { x: 1.5, y: 1.5 } }
}

/** Planta com parede vertical em x=5 (fresta só em y=8): força desvio. */
function walledPlan(): FloorPlan {
  const plan = openPlan(12, 12)
  for (let y = 0; y < 12; y++) {
    if (y === 8) continue
    plan.grid[y * plan.w + 5] = 0
  }
  return plan
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)

const AGENT = "claude-code" as const
const COLOR = "#8a9a7b"

describe("stepAlongPath (núcleo puro)", () => {
  it("velocidade constante nas 8 direções (|Δpos| = step por tick)", () => {
    const dirs: Vec2[] = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 1, y: 1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 },
    ]
    for (const d of dirs) {
      const len = Math.hypot(d.x, d.y)
      const pos: Vec2 = { x: 0, y: 0 }
      // alvo a 5 tiles de distância euclidiana na direção d
      const path: Vec2[] = [{ x: (d.x / len) * 5, y: (d.y / len) * 5 }]
      let prev: Vec2 = { ...pos }
      for (let i = 0; i < 10; i++) {
        stepAlongPath(pos, path, 0.1)
        expect(dist(pos, prev)).toBeCloseTo(0.1, 9)
        prev = { ...pos }
      }
      // 10 ticks de 0.1 ⇒ 1 tile percorrido, independente da direção
      expect(dist(pos, { x: 0, y: 0 })).toBeCloseTo(1, 9)
    }
  })

  it("consome waypoints em sequência e clampa no fim do caminho", () => {
    const pos: Vec2 = { x: 0.5, y: 0.5 }
    const path: Vec2[] = [
      { x: 2.5, y: 0.5 },
      { x: 2.5, y: 2.5 },
    ]
    // passo maior que o caminho inteiro: para EXATAMENTE no último waypoint
    const r = stepAlongPath(pos, path, 100)
    expect(r.arrived).toBe(true)
    expect(pos.x).toBeCloseTo(2.5, 6)
    expect(pos.y).toBeCloseTo(2.5, 6)
    expect(path.length).toBe(0)
  })
})

describe("createWalkerSystem", () => {
  it("computa caminho entre dois tiles caminháveis (desvia de parede)", () => {
    const plan = walledPlan()
    const from: Vec2 = { x: 2.5, y: 2.5 }
    const to: Vec2 = { x: 8.5, y: 2.5 }
    // sanity: o A* do engine acha o desvio pela fresta
    expect(findPath(plan, from, to)).not.toBeNull()

    const sys = createWalkerSystem(plan)
    const w = sys.spawn({ agent: AGENT, color: COLOR, seed: 7, from, to })
    let arrived = false
    w.onArrive(() => {
      arrived = true
    })
    for (let i = 0; i < 60 * 30 && !arrived; i++) sys.update(1 / 60)
    expect(arrived).toBe(true)
    // chegou de fato no destino (o desvio passa pela fresta em y=8)
    expect(dist(w.pos, to)).toBeLessThan(0.2)
    sys.clear()
  })

  it("avança por dt em velocidade constante e monotônica até o alvo", () => {
    const plan = openPlan()
    const sys = createWalkerSystem(plan)
    const to: Vec2 = { x: 9.5, y: 8.5 }
    const w = sys.spawn({
      agent: AGENT,
      color: COLOR,
      seed: 1,
      from: { x: 1.5, y: 1.5 },
      to,
      speed: 3,
    })
    let prevPos: Vec2 = { ...w.pos }
    let prevD = dist(w.pos, to)
    let arrived = false
    w.onArrive(() => {
      arrived = true
    })
    while (!arrived) {
      sys.update(0.1)
      const d = dist(w.pos, to)
      if (!arrived) {
        // monotônico: sempre mais perto do destino
        expect(d).toBeLessThan(prevD)
        // |Δpos| por tick = speed*dt (exceto no tick final, coberto por arrived)
        expect(dist(w.pos, prevPos)).toBeLessThanOrEqual(3 * 0.1 + 1e-9)
      }
      prevD = d
      prevPos = { ...w.pos }
    }
    expect(dist(w.pos, to)).toBeLessThan(0.1)
    sys.clear()
  })

  it("onArrive dispara UMA vez (e imediato se registrado após a chegada)", () => {
    const plan = openPlan()
    const sys = createWalkerSystem(plan)
    const w = sys.spawn({
      agent: AGENT,
      color: COLOR,
      seed: 2,
      from: { x: 1.5, y: 1.5 },
      to: { x: 4.5, y: 1.5 },
    })
    let count = 0
    w.onArrive(() => {
      count++
    })
    for (let i = 0; i < 60 * 10; i++) sys.update(1 / 60)
    expect(count).toBe(1)
    // registro tardio: dispara imediatamente, também uma vez
    let late = 0
    w.onArrive(() => {
      late++
    })
    expect(late).toBe(1)
    sys.clear()
  })

  it("leave() inverte o percurso e onGone dispara (done + destruição)", () => {
    const plan = openPlan()
    const sys = createWalkerSystem(plan)
    const from: Vec2 = { x: 1.5, y: 1.5 }
    const w = sys.spawn({
      agent: AGENT,
      color: COLOR,
      seed: 3,
      from,
      to: { x: 7.5, y: 4.5 },
      carrying: "doc",
    })
    let gone = 0
    w.onArrive(() => w.leave())
    w.onGone(() => {
      gone++
    })
    for (let i = 0; i < 60 * 30 && !w.done; i++) sys.update(1 / 60)
    expect(w.done).toBe(true)
    expect(gone).toBe(1)
    // voltou pelo caminho até a origem antes de sumir
    expect(dist(w.pos, from)).toBeLessThan(0.2)
    // avatar destruído (root fora de qualquer cena)
    expect(w.root.destroyed).toBe(true)
    sys.clear()
  })

  it("cancel() aborta na hora: done, avatar destruído, sem onArrive/onGone", () => {
    const plan = openPlan()
    const sys = createWalkerSystem(plan)
    const w = sys.spawn({
      agent: AGENT,
      color: COLOR,
      seed: 5,
      from: { x: 1.5, y: 1.5 },
      to: { x: 9.5, y: 1.5 },
      carrying: "doc",
    })
    let fired = 0
    w.onArrive(() => fired++)
    w.onGone(() => fired++)
    sys.update(0.1)
    w.cancel()
    expect(w.done).toBe(true)
    expect(w.root.destroyed).toBe(true)
    expect(fired).toBe(0)
    // updates seguintes não explodem nem ressuscitam o walker
    sys.update(0.1)
    expect(w.done).toBe(true)
    sys.clear()
  })

  it("callback que cancela OUTRO walker no meio do update não pula ninguém", () => {
    const plan = openPlan()
    const sys = createWalkerSystem(plan)
    const a = sys.spawn({
      agent: AGENT,
      color: COLOR,
      seed: 6,
      from: { x: 1.5, y: 1.5 },
      to: { x: 2.5, y: 1.5 }, // 1 tile: chega no primeiro update(1)
    })
    const b = sys.spawn({
      agent: AGENT,
      color: COLOR,
      seed: 7,
      from: { x: 5.5, y: 5.5 },
      to: { x: 9.5, y: 5.5 },
    })
    const c = sys.spawn({
      agent: AGENT,
      color: COLOR,
      seed: 8,
      from: { x: 8.5, y: 8.5 },
      to: { x: 12.5, y: 8.5 },
    })
    // A chega e, DENTRO do loop de update, cancela B (eviction via callback).
    a.onArrive(() => b.cancel())
    const cStart = { ...c.pos }
    sys.update(1)
    expect(b.done).toBe(true)
    expect(b.root.destroyed).toBe(true)
    // C (depois de B na lista) andou EXATAMENTE speed*dt neste MESMO frame —
    // a eviction no meio do loop não pulou o update dele.
    expect(dist(c.pos, cStart)).toBeCloseTo(WALKER_SPEED, 6)
    // updates seguintes não explodem nem ressuscitam B
    sys.update(0.1)
    expect(b.done).toBe(true)
    sys.clear()
  })

  it("usa WALKER_SPEED (~3 tiles/s) por padrão", () => {
    expect(WALKER_SPEED).toBe(3)
    const plan = openPlan()
    const sys = createWalkerSystem(plan)
    const w = sys.spawn({
      agent: AGENT,
      color: COLOR,
      seed: 4,
      from: { x: 1.5, y: 1.5 },
      to: { x: 11.5, y: 1.5 },
    })
    const start = { ...w.pos }
    sys.update(1) // 1s ⇒ 3 tiles
    expect(dist(w.pos, start)).toBeCloseTo(WALKER_SPEED, 6)
    sys.clear()
  })
})
