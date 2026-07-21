/** Sistema genérico de percurso de NPCs (fundação de handoff/café — módulo
 *  autônomo, SEM integração no stage ainda).
 *
 *  Cada walker: caminho via A* do engine (findPath), avanço waypoint a
 *  waypoint em velocidade constante (mesmo módulo de |v| nas 8 direções),
 *  flip/facing pela direção dominante na projeção 2:1 e zIndex = screenY dos
 *  pés a cada update (padrão do y-sort — atribuição só quando o quantizado
 *  muda). Animação delegada ao StandingAgentAvatar (respeita reducedMotion).
 *
 *  Ciclo de vida: spawn(from→to) · onArrive (uma vez, na chegada) · leave()
 *  (volta pelo caminho: pos atual → origem) · onGone (uma vez, ao sumir;
 *  o avatar é destruído e o walker sai do sistema).
 */
import { Container } from "pixi.js"
import { findPath } from "../engine/astar"
import { toScreen } from "../engine/iso"
import { bossFacingForVelocity } from "../engine/sim"
import type { BossFacing, FloorPlan, OfficeAgentId, Vec2 } from "../engine/types"
import { createStandingAgentAvatar, type StandingCarry } from "./avatars"
import { quantizeZIndex, zIndexChanged } from "./logic"
import { SPIKE_SCALE } from "./props"

/** Velocidade padrão dos NPCs (tiles/s — mais calma que o BOSS_SPEED). */
export const WALKER_SPEED = 3
/** Folga p/ considerar um waypoint alcançado (tiles — igual à sim do boss). */
export const WALKER_ARRIVE_EPS = 0.05
/** Âncora dos pés em px locais do avatar (mesmo offset do boss no stage). */
const WALKER_FEET_OFFSET = 17 * SPIKE_SCALE

// ---------------------------------------------------------------------------
// Núcleo puro do avanço (testável sem Pixi)
// ---------------------------------------------------------------------------

/** Avança `step` tiles ao longo de `path` (waypoints em coords contínuas).
 *  MUTA `pos` e `path` (waypoints alcançados saem por shift). Velocidade
 *  constante: |Δpos| = min(step, distância restante do caminho) em qualquer
 *  direção. Devolve a direção-unidade do último trecho percorrido (0,0 se não
 *  andou) e se o caminho terminou. */
export function stepAlongPath(
  pos: Vec2,
  path: Vec2[],
  step: number,
): { dir: Vec2; arrived: boolean } {
  let remaining = step
  let dirX = 0
  let dirY = 0
  let guard = 64
  while (path.length > 0 && remaining > 1e-9 && guard-- > 0) {
    const wp = path[0]
    const dx = wp.x - pos.x
    const dy = wp.y - pos.y
    const dist = Math.hypot(dx, dy)
    if (dist <= WALKER_ARRIVE_EPS) {
      pos.x = wp.x
      pos.y = wp.y
      path.shift()
      continue
    }
    const s = Math.min(dist, remaining)
    dirX = dx / dist
    dirY = dy / dist
    pos.x += dirX * s
    pos.y += dirY * s
    remaining -= s
  }
  return { dir: { x: dirX, y: dirY }, arrived: path.length === 0 }
}

// ---------------------------------------------------------------------------
// Sistema
// ---------------------------------------------------------------------------

export type WalkerSpawnOpts = {
  agent: OfficeAgentId
  color: string | number
  seed?: number
  /** Origem em coords contínuas de MUNDO (tiles). */
  from: Vec2
  /** Destino em coords contínuas de MUNDO (tiles). */
  to: Vec2
  carrying?: StandingCarry
  /** tiles/s (default WALKER_SPEED). */
  speed?: number
}

export type Walker = {
  /** Container p/ a camada dinâmica (posição em px de cena + zIndex y-sort). */
  root: Container
  /** Posição corrente em tiles (mesma referência, mutada in place). */
  pos: Vec2
  /** True quando o walker terminou o ciclo (foi embora e foi destruído). */
  readonly done: boolean
  /** Dispara UMA vez na chegada ao destino (imediato se já chegou). */
  onArrive(cb: () => void): void
  /** Dispara UMA vez quando o walker sumiu após leave() (imediato se já foi). */
  onGone(cb: () => void): void
  /** Volta pelo caminho (pos atual → origem) e finaliza (done + onGone). */
  leave(): void
  /** Aborta e destrói ESTE walker imediatamente — sem onArrive/onGone (quem
   *  cancela já sabe; os callbacks pendentes nunca disparam). done vira true. */
  cancel(): void
  /** Troca o prop na mão dianteira (doc/coffee/null). */
  setCarrying(item: StandingCarry): void
}

export type WalkerSystem = {
  spawn(opts: WalkerSpawnOpts): Walker
  /** Avança todos os walkers; remove (e destrói) os que terminaram. */
  update(dtSec: number, reducedMotion?: boolean): void
  /** Destrói todos os walkers imediatamente (sem onGone). */
  clear(): void
}

type WalkerState = {
  avatar: ReturnType<typeof createStandingAgentAvatar>
  pos: Vec2
  origin: Vec2
  path: Vec2[]
  speed: number
  phase: "going" | "arrived" | "leaving" | "gone"
  facing: BossFacing
  zq: number
  arriveCbs: (() => void)[]
  goneCbs: (() => void)[]
  arriveFired: boolean
  goneFired: boolean
}

export function createWalkerSystem(plan: FloorPlan): WalkerSystem {
  const walkers: WalkerState[] = []
  let clock = 0

  const place = (st: WalkerState): void => {
    const p = toScreen(st.pos.x, st.pos.y)
    st.avatar.root.position.set(p.x, p.y)
    const feetY = p.y + WALKER_FEET_OFFSET
    if (zIndexChanged(st.zq, feetY)) {
      st.zq = quantizeZIndex(feetY)
      st.avatar.root.zIndex = st.zq // atribuição só quando o quantizado muda
    }
  }

  const fireArrive = (st: WalkerState): void => {
    if (st.arriveFired) return
    st.arriveFired = true
    for (const cb of st.arriveCbs.splice(0)) cb()
  }

  const fireGone = (st: WalkerState): void => {
    if (st.goneFired) return
    st.goneFired = true
    st.phase = "gone"
    for (const cb of st.goneCbs.splice(0)) cb()
    st.avatar.destroy()
  }

  return {
    spawn(opts) {
      const pos: Vec2 = { x: opts.from.x, y: opts.from.y }
      const origin: Vec2 = { x: opts.from.x, y: opts.from.y }
      const avatar = createStandingAgentAvatar(opts.agent, opts.color, opts.seed)
      avatar.setCarrying(opts.carrying ?? null)
      // destino inalcançável ⇒ caminho vazio: o walker "chega" onde está no
      // próximo update (onArrive dispara; a feature decide o que fazer)
      const path = findPath(plan, pos, opts.to) ?? []

      const st: WalkerState = {
        avatar,
        pos,
        origin,
        path,
        speed: opts.speed ?? WALKER_SPEED,
        phase: "going",
        facing: "front",
        zq: Number.NaN, // primeiro place() sempre atribui
        arriveCbs: [],
        goneCbs: [],
        arriveFired: false,
        goneFired: false,
      }
      place(st)

      const walker: Walker = {
        root: avatar.root,
        pos,
        get done() {
          return st.phase === "gone"
        },
        onArrive(cb) {
          if (st.arriveFired) cb()
          else st.arriveCbs.push(cb)
        },
        onGone(cb) {
          if (st.goneFired) cb()
          else st.goneCbs.push(cb)
        },
        leave() {
          if (st.phase === "leaving" || st.phase === "gone") return
          st.phase = "leaving"
          st.path = findPath(plan, st.pos, st.origin) ?? []
        },
        cancel() {
          if (st.phase === "gone") return
          st.phase = "gone"
          st.arriveFired = true // callbacks pendentes nunca disparam
          st.goneFired = true
          const i = walkers.indexOf(st)
          if (i >= 0) walkers.splice(i, 1)
          st.avatar.destroy()
        },
        setCarrying(item) {
          avatar.setCarrying(item)
        },
      }
      walkers.push(st)
      return walker
    },

    update(dtSec, reducedMotion = false) {
      clock += dtSec
      // Itera um SNAPSHOT: callbacks (fireArrive/fireGone) podem cancelar
      // walkers — cancel() faz splice em `walkers` na hora — e um splice no
      // meio da iteração pularia/duplicaria o update de um vizinho neste
      // frame. A eviction dos que terminaram acontece DEPOIS do loop.
      for (const st of [...walkers]) {
        if (st.phase === "gone") continue // cancelado por callback neste frame
        const walking = st.path.length > 0
        if (walking) {
          const { dir, arrived } = stepAlongPath(st.pos, st.path, st.speed * dtSec)
          st.facing = bossFacingForVelocity(dir, st.facing)
          st.avatar.setFacing(st.facing)
          st.avatar.setMoving(!arrived)
          place(st)
          if (arrived) {
            if (st.phase === "going") {
              st.phase = "arrived"
              fireArrive(st)
            } else if (st.phase === "leaving") {
              fireGone(st) // avatar destruído; eviction pós-loop
              continue
            }
          }
        } else if (st.phase === "going") {
          // spawn sem caminho (ou from === to): chegada imediata
          st.avatar.setMoving(false)
          st.phase = "arrived"
          fireArrive(st)
        } else if (st.phase === "leaving") {
          fireGone(st)
          continue
        }
        // widen: fireArrive pode ter cancelado ESTE walker (cancel() no
        // callback muta st.phase → "gone"); o narrowing do TS não enxerga.
        if ((st.phase as WalkerState["phase"]) !== "gone")
          st.avatar.updateAnim(clock, reducedMotion)
      }
      // Eviction pós-loop: remove todos os "gone" (cancel() já se removeu).
      for (let i = walkers.length - 1; i >= 0; i--)
        if (walkers[i].phase === "gone") walkers.splice(i, 1)
    },

    clear() {
      for (const st of walkers) st.avatar.destroy()
      walkers.length = 0
    },
  }
}
