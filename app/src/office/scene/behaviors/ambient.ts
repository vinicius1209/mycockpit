/** Pack AMBIENT — charme + som do escritório.
 *
 *  GATO DO ESCRITÓRIO: um único gato (cap próprio de 1 — NÃO conta no cap dos
 *  walkers de agent) vagueia devagar (CAT_SPEED) pelo corredor e salas usando
 *  o MESMO A* dos walkers, com pausas curtas; a cada ciclo escolhe dormir
 *  ~2min num canto da sala com mais atividade REAL (mesas typing/thinking do
 *  snapshot — heatmap fofo). Nunca bloqueia tile: o sprite não entra na grid,
 *  o boss atravessa. reducedMotion ⇒ gato sempre dormindo num canto, estático.
 *  Modo rápido de dev: localStorage mc.office.catFast=1 (ciclos curtos).
 *
 *  SONS (ui/sound — opt-in, default OFF): este pack é quem observa o runtime
 *  e dispara notifySound nos pontos REAIS:
 *    footstep — cadência enquanto há viagens de walker ativas (tripCount>0)
 *    typing   — taxa proporcional ao nº de mesas "typing" (máx. 2/s)
 *    coffee   — transição "mesa ganhou viagem de café" (prioridade coffee)
 *    delivery — entrega nova no snapshot (dedupe por deskId|at, TTL 60s)
 *
 *  O sprite (scene/petSprite) entra na dynamicLayer via opts.layer — passada
 *  pelo stage na linha de registro do pack (região marcada). */
import type { Container } from "pixi.js"
import { findPath } from "../../engine/astar"
import { toScreen } from "../../engine/iso"
import {
  T_INTERACT,
  T_WALK,
  type FloorPlan,
  type OfficeSnapshot,
  type Vec2,
} from "../../engine/types"
import { mulberry32 } from "../ambient"
import { quantizeZIndex, zIndexChanged } from "../logic"
import { stepAlongPath } from "../walkers"
import { createPetSprite, type PetSprite } from "../petSprite"
import { BEHAVIOR_PRIORITY, hashSeed, type BehaviorApi, type BehaviorPack } from "../behaviors"
import { notifySound } from "../../ui/sound"

/** Velocidade do gato (tiles/s) — bem mais calmo que os walkers (3). */
export const CAT_SPEED = 1.2
/** Soneca perto da sala ativa (s) — ~2min, com variação. */
const SLEEP_MIN_S = 105
const SLEEP_MAX_S = 150
/** Pausa sentado entre trechos de passeio (s). */
const PAUSE_MIN_S = 2.5
const PAUSE_MAX_S = 6
/** Trechos de passeio antes de escolher dormir. */
const HOPS_MIN = 2
const HOPS_MAX = 4
/** Modo rápido (dev/simulação — mc.office.catFast=1). */
const FAST_SLEEP_MIN_S = 7
const FAST_SLEEP_MAX_S = 12
const FAST_PAUSE_MIN_S = 0.8
const FAST_PAUSE_MAX_S = 1.6

/** zIndex: pés do gato praticamente na âncora (bicho baixinho). */
const CAT_Z_BIAS = 2

/** Cadência dos passinhos com walkers ativos (s entre ticks). */
const FOOTSTEP_GAP_S = 0.34
/** Taxa de teclado por mesa typing (disparos/s); teto global 2/s. */
const TYPING_RATE_PER_DESK = 0.7
const TYPING_RATE_MAX = 2
/** Entregas já sonorizadas expiram da memória (ms, relógio de parede). */
const DELIVERY_SEEN_TTL_MS = 60_000

/** Sala com mais atividade REAL (mesas typing/thinking); null = tudo quieto.
 *  Empate: a primeira na ordem do snapshot (estável). Pura — testável. */
export function catActivityRoom(s: OfficeSnapshot): string | null {
  let best: string | null = null
  let bestCount = 0
  for (const room of s.rooms) {
    let count = 0
    for (const desk of room.desks) {
      if (desk.state === "typing" || desk.state === "thinking") count++
    }
    if (count > bestCount) {
      bestCount = count
      best = room.projectId
    }
  }
  return best
}

/** Tile caminhável (nem mesa, nem interact) mais "de canto" da sala do
 *  projeto; sem projeto/sala, um canto da sala comum; sem nada, o primeiro
 *  tile caminhável da planta. Devolve o CENTRO do tile (contínuo) ou null
 *  numa planta sem tile caminhável. Pura — testável. */
export function catSleepSpot(plan: FloorPlan, projectId: string | null): Vec2 | null {
  const walkable = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= plan.w || y >= plan.h) return false
    const flags = plan.grid[y * plan.w + x]
    return (flags & T_WALK) !== 0 && (flags & T_INTERACT) === 0
  }
  const inRect = (origin: Vec2, w: number, h: number): Vec2 | null => {
    // cantos com 1 tile de folga das bordas (na iso, a coluna colada na
    // parede oeste fica atrás do painel e a fileira sul derrama sobre a
    // beirada do piso), em ordem de visibilidade: SE, SW, NE, NW — os do
    // norte por último (podem ficar atrás de balcões/mesas encostados na
    // parede norte). Varredura sul→norte no fim.
    const xw = Math.max(origin.x, origin.x + w - 2)
    const yh = Math.max(origin.y, origin.y + h - 2)
    const x1 = Math.min(origin.x + 1, xw)
    const y1 = Math.min(origin.y + 1, yh)
    const corners: Vec2[] = [
      { x: xw, y: yh },
      { x: x1, y: yh },
      { x: xw, y: y1 },
      { x: x1, y: y1 },
    ]
    for (const c of corners) if (walkable(c.x, c.y)) return { x: c.x + 0.5, y: c.y + 0.5 }
    for (let y = origin.y + h - 1; y >= origin.y; y--) {
      for (let x = origin.x; x < origin.x + w; x++) {
        if (walkable(x, y)) return { x: x + 0.5, y: y + 0.5 }
      }
    }
    return null
  }
  if (projectId) {
    const room = plan.rooms.find((r) => r.projectId === projectId)
    if (room) {
      const spot = inRect(room.origin, room.w, room.h)
      if (spot) return spot
    }
  }
  if (plan.commonRoom) {
    const spot = inRect(plan.commonRoom.origin, plan.commonRoom.w, plan.commonRoom.h)
    if (spot) return spot
  }
  for (let y = plan.h - 1; y >= 0; y--) {
    for (let x = 0; x < plan.w; x++) {
      if (walkable(x, y)) return { x: x + 0.5, y: y + 0.5 }
    }
  }
  return null
}

type CatMode = "plan" | "walk" | "pause" | "sleep"

export function createAmbientPack(opts: { layer: Container }): BehaviorPack {
  const catFast =
    typeof localStorage !== "undefined" && localStorage.getItem("mc.office.catFast") === "1"
  const sleepMinS = catFast ? FAST_SLEEP_MIN_S : SLEEP_MIN_S
  const sleepSpanS = (catFast ? FAST_SLEEP_MAX_S : SLEEP_MAX_S) - sleepMinS
  const pauseMinS = catFast ? FAST_PAUSE_MIN_S : PAUSE_MIN_S
  const pauseSpanS = (catFast ? FAST_PAUSE_MAX_S : PAUSE_MAX_S) - pauseMinS
  /** Sorteia quantos trechos de passeio até a próxima soneca. */
  const rollHops = (r: () => number): number =>
    catFast ? 1 : HOPS_MIN + Math.floor(r() * (HOPS_MAX - HOPS_MIN + 1))

  // --- gato -----------------------------------------------------------------
  const rng = mulberry32(hashSeed("office|cat"))
  let cat: PetSprite | null = null
  let staticDone = false // reducedMotion: posicionado uma única vez
  const pos: Vec2 = { x: 0, y: 0 }
  let path: Vec2[] = []
  let mode: CatMode = "plan"
  let goal: "wander" | "sleep" = "wander"
  let hopsLeft = rollHops(rng)
  let waitUntil = 0
  let zq = Number.NaN
  /** Sala mais ativa do último snapshot (projectId) — alvo da soneca. */
  let activityRoom: string | null = null

  const place = (): void => {
    if (!cat) return
    const p = toScreen(pos.x, pos.y)
    cat.root.position.set(p.x, p.y)
    const feetY = p.y + CAT_Z_BIAS
    if (zIndexChanged(zq, feetY)) {
      zq = quantizeZIndex(feetY)
      cat.root.zIndex = zq
    }
  }

  const ensureCat = (plan: FloorPlan): PetSprite | null => {
    if (cat) return cat
    const start = catSleepSpot(plan, null)
    if (!start) return null // planta sem tile caminhável (teste vazio)
    pos.x = start.x
    pos.y = start.y
    cat = createPetSprite()
    opts.layer.addChild(cat.root)
    place()
    return cat
  }

  /** Tile caminhável aleatório e alcançável, longe o bastante pra valer o
   *  passeio (algumas tentativas; falhou ⇒ tenta de novo no próximo tick). */
  const pickWanderPath = (plan: FloorPlan): Vec2[] | null => {
    for (let i = 0; i < 16; i++) {
      const x = Math.floor(rng() * plan.w)
      const y = Math.floor(rng() * plan.h)
      const flags = plan.grid[y * plan.w + x]
      if ((flags & T_WALK) === 0 || (flags & T_INTERACT) !== 0) continue
      if (Math.abs(x + 0.5 - pos.x) + Math.abs(y + 0.5 - pos.y) < 4) continue
      const p = findPath(plan, pos, { x: x + 0.5, y: y + 0.5 })
      if (p && p.length > 0) return p
    }
    return null
  }

  const tickCat = (dtSec: number, api: BehaviorApi): void => {
    if (api.reducedMotion) {
      // gato sempre dormindo num canto — cena parada, custo zero
      if (staticDone) return
      const pet = ensureCat(api.plan)
      if (!pet) return
      pet.setSleeping(true)
      pet.updateAnim(api.time, true)
      place()
      staticDone = true
      return
    }
    const pet = ensureCat(api.plan)
    if (!pet) return
    const time = api.time

    if (mode === "plan") {
      // decide o próximo trecho: passear ou ir dormir perto da atividade
      if (hopsLeft <= 0 && goal !== "sleep") {
        goal = "sleep"
        const spot = catSleepSpot(api.plan, activityRoom)
        const p = spot ? findPath(api.plan, pos, spot) : null
        if (p) {
          path = p
          mode = "walk"
          pet.setMoving(true)
        } else {
          // canto inalcançável: dorme onde está mesmo (gato é gato)
          mode = "sleep"
          waitUntil = time + sleepMinS + rng() * sleepSpanS
          pet.setSleeping(true)
        }
      } else {
        const p = pickWanderPath(api.plan)
        if (p) {
          goal = "wander"
          path = p
          mode = "walk"
          pet.setMoving(true)
        }
        // sem caminho nesta rodada: tenta de novo no próximo tick
      }
    } else if (mode === "walk") {
      const { dir, arrived } = stepAlongPath(pos, path, CAT_SPEED * dtSec)
      // perfil: flip pela direção horizontal em TELA (sx cresce com wx - wy)
      if (dir.x - dir.y < -1e-6) pet.setFlip(true)
      else if (dir.x - dir.y > 1e-6) pet.setFlip(false)
      place()
      if (arrived) {
        pet.setMoving(false)
        if (goal === "sleep") {
          mode = "sleep"
          waitUntil = time + sleepMinS + rng() * sleepSpanS
          pet.setSleeping(true)
        } else {
          hopsLeft--
          mode = "pause"
          waitUntil = time + pauseMinS + rng() * pauseSpanS
        }
      }
    } else if (mode === "pause") {
      if (time >= waitUntil) mode = "plan"
    } else if (mode === "sleep") {
      if (time >= waitUntil) {
        pet.setSleeping(false)
        goal = "wander"
        hopsLeft = rollHops(rng)
        mode = "plan"
      }
    }
    pet.updateAnim(time, false)
  }

  // --- som ------------------------------------------------------------------
  const soundRng = mulberry32(hashSeed("office|sound"))
  let stepTimer = 0
  let typeTimer = 0
  let typingCount = 0
  /** Mesas com viagem de CAFÉ no tick anterior (borda de subida ⇒ borbulha). */
  const coffeeDesks = new Set<string>()
  /** Entregas já sonorizadas (deskId|at → at) — dedupe entre snapshots. */
  const seenDeliveries = new Map<string, number>()

  const tickSound = (dtSec: number, api: BehaviorApi): void => {
    // passinhos: cadência fixa enquanto há walkers de comportamento ativos
    if (api.tripCount() > 0) {
      stepTimer -= dtSec
      if (stepTimer <= 0) {
        notifySound("footstep")
        stepTimer = FOOTSTEP_GAP_S * (0.85 + soundRng() * 0.3)
      }
    } else stepTimer = 0

    // teclado: taxa proporcional às mesas typing (máx. 2/s), jitter no gap
    const rate = Math.min(TYPING_RATE_MAX, typingCount * TYPING_RATE_PER_DESK)
    if (rate > 0) {
      typeTimer -= dtSec
      if (typeTimer <= 0) {
        notifySound("typing")
        typeTimer = (1 / rate) * (0.7 + soundRng() * 0.6)
      }
    } else typeTimer = 0

    // café: mesa GANHOU viagem de café neste tick (transição, não estado)
    for (const deskId of api.deskIds()) {
      const isCoffee = api.activeTrip(deskId)?.priority === BEHAVIOR_PRIORITY.coffee
      if (isCoffee && !coffeeDesks.has(deskId)) {
        coffeeDesks.add(deskId)
        notifySound("coffee")
      } else if (!isCoffee) coffeeDesks.delete(deskId)
    }
  }

  return {
    id: "ambient",

    onSnapshot(s, _api) {
      activityRoom = catActivityRoom(s)
      typingCount = 0
      for (const room of s.rooms) {
        for (const desk of room.desks) if (desk.state === "typing") typingCount++
      }
      // sino de entrega: só entregas NOVAS (dedupe com TTL de parede)
      const wall = Date.now()
      for (const [key, at] of seenDeliveries) {
        if (wall - at > DELIVERY_SEEN_TTL_MS) seenDeliveries.delete(key)
      }
      for (const d of s.deliveries) {
        const key = `${d.deskId}|${d.at}`
        if (seenDeliveries.has(key)) continue
        seenDeliveries.set(key, d.at)
        notifySound("delivery")
      }
    },

    onTick(dtSec, api) {
      tickCat(dtSec, api)
      tickSound(dtSec, api)
    },
  }
}
