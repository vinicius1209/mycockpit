/** Simulação do mundo (dono do estado mutável — O3; passo fixo via loop.ts).
 *
 *  Ordem do tick: prev ← pos · consome cliques (clickDeskId/clickWorld) ·
 *  WASD cancela caminho · movimento (move-and-slide por eixo) · proximidade
 *  com histerese · relógio · câmera. Eventos discretos saem por `emit`.
 */
import { BODY_HALF, BOSS_SPEED, REACH_ENTER, REACH_EXIT } from "./types"
import type { BossFacing, BossState, DeskPlacement, FloorPlan, SimEvent, Vec2, World } from "./types"
import { inputDirToWorld } from "./iso"
import { aabbFree } from "./grid"
import { findPath } from "./astar"
import { updateCamera } from "./camera"

/** Folga p/ considerar um waypoint alcançado (tiles). */
export const ARRIVE_EPS = 0.05
/** A mesa mais próxima só rouba o alvo com esta folga de distância (tiles). */
export const TARGET_SWAP_EPS = 0.15

export function createWorld(plan: FloorPlan): World {
  return {
    plan,
    boss: {
      pos: { x: plan.spawn.x, y: plan.spawn.y },
      prev: { x: plan.spawn.x, y: plan.spawn.y },
      vel: { x: 0, y: 0 },
      facing: "front",
      moving: false,
      path: null,
      pendingDeskId: null,
    },
    camera: {
      mode: "follow",
      pos: { x: plan.spawn.x, y: plan.spawn.y },
      prev: { x: plan.spawn.x, y: plan.spawn.y },
      zoom: 1,
      inspectTarget: null,
      screenOffset: { x: 0, y: 0 },
      zoomFreezeUntil: 0,
    },
    input: { keys: new Set(), clickWorld: null, clickDeskId: null },
    nearDeskId: null,
    time: 0,
  }
}

/** WASD/setas em espaço de TELA: ix (→ positivo), iy (↓ positivo). */
function keyDir(keys: Set<string>): { ix: number; iy: number } {
  const left = keys.has("a") || keys.has("arrowleft")
  const right = keys.has("d") || keys.has("arrowright")
  const up = keys.has("w") || keys.has("arrowup")
  const down = keys.has("s") || keys.has("arrowdown")
  return { ix: (right ? 1 : 0) - (left ? 1 : 0), iy: (down ? 1 : 0) - (up ? 1 : 0) }
}

function findTarget(plan: FloorPlan, id: string): Pick<DeskPlacement, "id" | "interactTile"> | null {
  for (const room of plan.rooms) {
    for (const desk of room.desks) {
      if (desk.id === id) return desk
    }
  }
  for (const target of plan.interactables ?? []) {
    if (target.id === id) return target
  }
  return null
}

/** Converte velocidade do mundo para a direção dominante na projeção 2:1.
 *  Mantém a direção anterior quando parado para evitar estalos de pose. */
export function bossFacingForVelocity(vel: Vec2, current: BossFacing): BossFacing {
  const screenX = vel.x - vel.y
  const screenY = (vel.x + vel.y) / 2
  if (Math.abs(screenX) < 1e-9 && Math.abs(screenY) < 1e-9) return current
  if (Math.abs(screenX) > Math.abs(screenY)) return screenX > 0 ? "right" : "left"
  return screenY > 0 ? "front" : "back"
}

/** Move-and-slide por eixo: eixo bloqueado não anda (desliza no outro). */
function moveAndSlide(plan: FloorPlan, boss: BossState, dx: number, dy: number): void {
  if (dx !== 0) {
    const nx = boss.pos.x + dx
    if (aabbFree(plan, nx, boss.pos.y, BODY_HALF)) boss.pos.x = nx
  }
  if (dy !== 0) {
    const ny = boss.pos.y + dy
    if (aabbFree(plan, boss.pos.x, ny, BODY_HALF)) boss.pos.y = ny
  }
}

/** Primeiro input de movimento do boss tira a câmera do inspect (§3). */
function exitInspect(world: World, emit: (e: SimEvent) => void): void {
  if (world.camera.mode !== "inspect") return
  world.camera.mode = "follow"
  world.camera.inspectTarget = null
  emit({ kind: "camera-mode", mode: "follow" })
}

/** Segue o caminho do click-to-move; emite arrived-at-desk só quando o caminho
 *  COMPLETA (preso na geometria ⇒ cancela sem "chegada"). */
function followPath(world: World, dt: number, emit: (e: SimEvent) => void): void {
  const boss = world.boss
  let remaining = BOSS_SPEED * dt
  let dirX = 0
  let dirY = 0
  let completed = false
  let guard = 32

  while (boss.path && boss.path.length > 0 && remaining > 1e-9 && guard-- > 0) {
    const wp = boss.path[0]
    const dx = wp.x - boss.pos.x
    const dy = wp.y - boss.pos.y
    const dist = Math.hypot(dx, dy)
    if (dist <= ARRIVE_EPS) {
      boss.path.shift()
      if (boss.path.length === 0) {
        boss.path = null
        completed = true
      }
      continue
    }
    const step = Math.min(dist, remaining)
    const ux = dx / dist
    const uy = dy / dist
    const bx = boss.pos.x
    const by = boss.pos.y
    moveAndSlide(world.plan, boss, ux * step, uy * step)
    dirX = ux
    dirY = uy
    remaining -= step
    const moved = Math.hypot(boss.pos.x - bx, boss.pos.y - by)
    if (moved < step * 1e-3) {
      // Preso contra a geometria: cancela o caminho sem emitir chegada.
      boss.path = null
      boss.pendingDeskId = null
      break
    }
  }

  boss.vel = { x: dirX * BOSS_SPEED, y: dirY * BOSS_SPEED }
  if (completed && boss.pendingDeskId) {
    emit({ kind: "arrived-at-desk", deskId: boss.pendingDeskId })
    boss.pendingDeskId = null
  }
}

/** Proximidade com histerese REACH_ENTER/REACH_EXIT e alvo único: a mesa mais
 *  próxima só assume se estiver em alcance; troca de alvo exige folga de
 *  TARGET_SWAP_EPS (evita flicker entre duas mesas equidistantes). Os
 *  interactables sem mesa (mesa de reunião) entram na MESMA disputa — a ui
 *  distingue pelo id (near-desk continua o único evento de alcance). */
function updateProximity(world: World, emit: (e: SimEvent) => void): void {
  const boss = world.boss
  let bestId: string | null = null
  let bestD = Infinity
  let currentD = Infinity
  const consider = (id: string, interactTile: { x: number; y: number }) => {
    const d = Math.hypot(interactTile.x + 0.5 - boss.pos.x, interactTile.y + 0.5 - boss.pos.y)
    if (id === world.nearDeskId) currentD = d
    if (d < bestD) {
      bestD = d
      bestId = id
    }
  }
  for (const room of world.plan.rooms) {
    for (const desk of room.desks) consider(desk.id, desk.interactTile)
  }
  for (const it of world.plan.interactables ?? []) consider(it.id, it.interactTile)

  let next = world.nearDeskId
  if (next !== null && currentD > REACH_EXIT) next = null
  if (next === null) {
    if (bestId !== null && bestD <= REACH_ENTER) next = bestId
  } else if (bestId !== null && bestId !== next && bestD <= REACH_ENTER && bestD < currentD - TARGET_SWAP_EPS) {
    next = bestId
  }

  if (next !== world.nearDeskId) {
    world.nearDeskId = next
    emit({ kind: "near-desk", deskId: next })
  }
}

/** Um passo fixo da simulação (dt = SIM_DT em uso normal). */
export function simTick(world: World, dt: number, emit: (e: SimEvent) => void): void {
  const boss = world.boss
  boss.prev = { x: boss.pos.x, y: boss.pos.y }

  const { ix, iy } = keyDir(world.input.keys)
  const hasKeyInput = ix !== 0 || iy !== 0

  // Clique numa mesa: A* até o interactTile + auto-abrir dock na chegada.
  if (world.input.clickDeskId !== null) {
    const desk = findTarget(world.plan, world.input.clickDeskId)
    world.input.clickDeskId = null
    if (desk) {
      const target = { x: desk.interactTile.x + 0.5, y: desk.interactTile.y + 0.5 }
      const path = findPath(world.plan, boss.pos, target)
      if (path) {
        boss.path = path
        boss.pendingDeskId = desk.id
        exitInspect(world, emit)
      }
    }
  }
  // Clique no chão: A* com clamp de tile bloqueado (dentro do findPath).
  if (world.input.clickWorld !== null) {
    const target = world.input.clickWorld
    world.input.clickWorld = null
    const path = findPath(world.plan, boss.pos, target)
    if (path) {
      boss.path = path
      boss.pendingDeskId = null
      exitInspect(world, emit)
    }
  }

  // WASD cancela o click-to-move (e o dock pendente).
  if (hasKeyInput) {
    boss.path = null
    boss.pendingDeskId = null
    exitInspect(world, emit)
  }

  if (hasKeyInput) {
    const dir = inputDirToWorld(ix, iy)
    boss.vel = { x: dir.x * BOSS_SPEED, y: dir.y * BOSS_SPEED }
    moveAndSlide(world.plan, boss, boss.vel.x * dt, boss.vel.y * dt)
  } else if (boss.path && boss.path.length > 0) {
    followPath(world, dt, emit)
  } else {
    boss.vel = { x: 0, y: 0 }
  }

  boss.facing = bossFacingForVelocity(boss.vel, boss.facing)

  boss.moving = boss.pos.x !== boss.prev.x || boss.pos.y !== boss.prev.y

  updateProximity(world, emit)

  world.time += dt
  updateCamera(world, dt)
}
