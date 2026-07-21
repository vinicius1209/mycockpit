/** Pack PESSOAL — estados corporais dos agents (tudo sinal REAL do runtime):
 *
 *  PENSAR ANDANDO: mesa em "thinking" há >THINK_PACE_AFTER_S ⇒ o avatar
 *  levanta e faz um vai-e-vem curto (~PACE_SPAN_TILES) junto da própria mesa
 *  com os balões de pensamento SEGUINDO o caminhante; volta a sentar quando o
 *  estado muda (abort do orquestrador por keepStates). Prioridade mínima
 *  (wander) — qualquer comportamento real derruba o passeio.
 *
 *  DESCANSO NO SOFÁ: desk.restUntil futuro (auto-resume de rate-limit) ⇒
 *  caminha até o sofá da sala comum, ENCOSTA (lean sutil) com 3 "Z" subindo
 *  em loop lento, e volta quando restUntil passa ou o sinal some do snapshot.
 *
 *  CUMPRIMENTO: boss a <GREET_DIST_TILES de uma mesa idle ⇒ aceno curto do
 *  SENTADO (variante de braço erguida via ctx.waveSeated, olhando pro boss).
 *  Cooldown por mesa. In-place — nenhum walker.
 *
 *  CHEGADA AO TRABALHO: snapshot.arrivals (mesa off→disponível) ⇒ o avatar
 *  ENTRA andando pela porta do corredor mais próxima até a mesa e senta.
 *  Fora do beginTrip (a viagem é porta→mesa, sem retorno): spawn direto com
 *  dedupe por deskId::at + guardas (estado voltou a off / sentado reapareceu
 *  por fora ⇒ cancela — nunca 2 corpos do mesmo agent na cena).
 *
 *  reducedMotion ⇒ NADA disso (posturas estáticas; o snapshot já resolve).
 *  Modo rápido (localStorage mc.office.personalFast=1) é só de dev/simulação.
 */
import { Container, Graphics } from "pixi.js"
import { findPath } from "../../engine/astar"
import type {
  DeskVisualState,
  FloorPlan,
  Vec2,
} from "../../engine/types"
import { createThoughtDots, type ThoughtDots } from "../effects"
import type { Walker } from "../walkers"
import {
  BEHAVIOR_PRIORITY,
  type BehaviorPack,
  type BehaviorTrip,
} from "../behaviors"

/** Mesa pensando há mais que isto (s) ⇒ o avatar levanta pra andar. */
export const THINK_PACE_AFTER_S = 8
/** Alcance do vai-e-vem a partir da âncora da mesa (tiles). */
export const PACE_SPAN_TILES = 2.4
/** Pausa MÍNIMA no ponto extremo (s); soma-se jitter até +PACE_PAUSE_JIT_S. */
export const PACE_PAUSE_S = 0.5
const PACE_PAUSE_JIT_S = 1.1
/** EPISÓDIOS, não loop: cada episódio tem 1–PACE_LEGS_MAX pernas; depois o
 *  pensador SENTA e descansa PACE_REST_MIN..MAX_S antes do próximo (pensar
 *  andando o tempo inteiro lia como robô em loop). */
const PACE_LEGS_MAX = 3
const PACE_REST_MIN_S = 18
const PACE_REST_MAX_S = 45
/** Micro-respiro entre pernas do MESMO episódio (s, + jitter). */
const PACE_GAP_S = 0.35
/** Pensador anda mais devagar que courier (tiles/s, com jitter por perna). */
const PACE_SPEED_MIN = 2.1
const PACE_SPEED_JIT = 0.6
/** Encurtamento aleatório do span por perna (nunca o mesmo ponto exato). */
const PACE_SPAN_MIN_F = 0.68
const PACE_SPAN_JIT_F = 0.37
/** Re-tentativa quando a viagem foi negada/abortada (s). */
const PACE_BLOCKED_RETRY_S = 4
/** Máximo de pensadores andando ao mesmo tempo (deixa folga no cap p/ os
 *  comportamentos de verdade — handoff/sofá/café). */
const PACE_MAX = 2

/** Só vale a caminhada se ainda faltam ≥ isto de descanso (ms). */
export const REST_MIN_REMAIN_MS = 7_000
/** Inclinação "encostado no sofá" (rad, transform-only no root do walker). */
export const REST_LEAN_RAD = 0.12
/** Teto da pausa no sofá (s) — o wake real vem do restUntil (wall-clock). */
const REST_PAUSE_CAP_S = 600

/** Proximidade do boss que dispara o aceno (tiles, distância contínua). */
export const GREET_DIST_TILES = 2.5
/** Cooldown do aceno por mesa (s, relógio da sim). */
export const GREET_COOLDOWN_S = 30

/** Chegadas já atendidas (dedupe deskId::at) expiram da memória em 60s. */
const ARRIVAL_SEEN_TTL_MS = 60_000
/** Máximo de walk-ins simultâneos (fora do cap do orquestrador). */
const ARRIVAL_MAX = 2

const THINKING_ONLY: readonly DeskVisualState[] = ["thinking"]
const IDLE_ONLY: readonly DeskVisualState[] = ["idle"]

// ---------------------------------------------------------------------------
// Efeito 💤: 3 "Z" gráficos subindo em loop lento (transform/alpha apenas)
// ---------------------------------------------------------------------------

const ZZZ_PERIOD_S = 3.2

type ZzzFx = { root: Container; tick(timeSec: number): void }

function createZzz(): ZzzFx {
  const root = new Container()
  const zs: Graphics[] = []
  for (let i = 0; i < 3; i++) {
    const g = new Graphics()
      .moveTo(-3, -3)
      .lineTo(3, -3)
      .lineTo(-3, 3)
      .lineTo(3, 3)
      .stroke({ width: 1.8, color: 0xf0f1f2, cap: "round", join: "round" })
    g.alpha = 0
    zs.push(g)
    root.addChild(g)
  }
  return {
    root,
    tick(timeSec) {
      for (let i = 0; i < zs.length; i++) {
        const ph = (timeSec / ZZZ_PERIOD_S + i / zs.length) % 1
        zs[i].position.set(3 + 8 * ph, -16 * ph)
        zs[i].scale.set(0.55 + 0.65 * ph)
        zs[i].alpha = ph < 0.18 ? ph / 0.18 : 1 - (ph - 0.18) / 0.82
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

const PACE_DIRS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

/** Destinos válidos do vai-e-vem: pontos a PACE_SPAN_TILES da âncora com
 *  caminho DIRETO pelo A* (comprimento ~ do span ⇒ sem desvio por porta —
 *  o pensador nunca "passeia" pra fora da sala). */
export function paceTargets(plan: FloorPlan, anchor: Vec2): Vec2[] {
  const out: Vec2[] = []
  for (const d of PACE_DIRS) {
    const to = {
      x: anchor.x + d.x * PACE_SPAN_TILES,
      y: anchor.y + d.y * PACE_SPAN_TILES,
    }
    const path = findPath(plan, anchor, to)
    if (!path) continue
    let len = 0
    let prev = anchor
    for (const wp of path) {
      len += Math.hypot(wp.x - prev.x, wp.y - prev.y)
      prev = wp
    }
    if (len <= PACE_SPAN_TILES + 1.2) out.push(to)
  }
  return out
}

/** Porta do corredor mais próxima da mesa (centro do doorTile da sala). */
export function nearestDoor(
  plan: FloorPlan,
  deskId: string,
  anchor: Vec2,
): Vec2 | null {
  for (const room of plan.rooms) {
    if (!room.desks.some((d) => d.id === deskId)) continue
    let best: Vec2 | null = null
    let bestDist = Infinity
    for (const tile of room.doorTiles) {
      const c = { x: tile.x + 0.5, y: tile.y + 0.5 }
      const dist = Math.hypot(c.x - anchor.x, c.y - anchor.y)
      if (dist < bestDist) {
        bestDist = dist
        best = c
      }
    }
    return best
  }
  return null
}

// ---------------------------------------------------------------------------
// Pack
// ---------------------------------------------------------------------------

type PaceSlot = {
  targets: Vec2[] | null
  k: number
  nextAt: number
  /** Pernas restantes do episódio corrente (0 ⇒ próximo início sorteia novo). */
  legsLeft: number
}
type PaceRun = { trip: BehaviorTrip; dots: ThoughtDots; alive: boolean }
type RestRun = { trip: BehaviorTrip; zzz: ZzzFx | null; alive: boolean }
type ArrivalRun = { walker: Walker; arrived: boolean }

export function createPersonalPack(): BehaviorPack {
  const fast =
    typeof localStorage !== "undefined" &&
    localStorage.getItem("mc.office.personalFast") === "1"
  const thinkAfterS = fast ? 2 : THINK_PACE_AFTER_S
  const greetCooldownS = fast ? 8 : GREET_COOLDOWN_S
  const restMinRemainMs = fast ? 2_000 : REST_MIN_REMAIN_MS

  // pensar andando
  const thinkingSince = new Map<string, number>()
  const paceSlots = new Map<string, PaceSlot>()
  const paceRuns = new Map<string, PaceRun>()

  // descanso no sofá (restUntil por mesa, rebuild a cada snapshot)
  const restUntilByDesk = new Map<string, number>()
  const restRuns = new Map<string, RestRun>()

  // cumprimento
  const greetAt = new Map<string, number>()

  // chegada ao trabalho
  const seenArrivals = new Map<string, number>()
  const arrivalRuns = new Map<string, ArrivalRun>()

  /** Tira o 💤 + lean do dorminhoco (walker AINDA vivo) — antes de voltar. */
  const clearRestFx = (run: RestRun): void => {
    if (!run.zzz || run.trip.walker.done) {
      run.zzz = null
      return
    }
    run.zzz.root.destroy({ children: true })
    run.zzz = null
    run.trip.walker.root.rotation = 0
  }

  return {
    id: "personal",

    onSnapshot(s, api) {
      // restUntil por mesa: sinal REAL do auto-resume (rate-limit)
      restUntilByDesk.clear()
      for (const room of s.rooms) {
        for (const d of room.desks) {
          if (d.restUntil !== undefined) restUntilByDesk.set(d.id, d.restUntil)
        }
      }

      // memória de chegadas expira por relógio de PAREDE (at vem em ms)
      const wall = Date.now()
      for (const [key, at] of seenArrivals) {
        if (wall - at > ARRIVAL_SEEN_TTL_MS) seenArrivals.delete(key)
      }

      // walk-ins ativos: mesa voltou a "off" (cadeira vazia fica vazia) OU o
      // sentado reapareceu por fora (troca de estado) ⇒ cancela o corpo extra
      for (const [deskId, run] of arrivalRuns) {
        if (run.walker.done) {
          arrivalRuns.delete(deskId)
          continue
        }
        const state = api.deskState(deskId)
        if (state === null || state === "off" || api.seatedVisible(deskId)) {
          run.walker.cancel()
          arrivalRuns.delete(deskId)
        }
      }

      if (api.reducedMotion) return

      for (const a of s.arrivals ?? []) {
        const key = `${a.deskId}::${a.at}`
        if (seenArrivals.has(key)) continue
        // guardas TRANSIENTES (lotação/viagem em voo) vêm ANTES do "visto":
        // negado agora ⇒ retenta enquanto o TTL do derive reapresentar o evento
        if (arrivalRuns.size >= ARRIVAL_MAX || arrivalRuns.has(a.deskId)) continue
        if (api.activeTrip(a.deskId)) continue
        seenArrivals.set(key, a.at)
        const info = api.deskInfo(a.deskId)
        const anchor = api.deskAnchor(a.deskId)
        const state = api.deskState(a.deskId)
        if (!info || !anchor || state === null || state === "off") continue
        if (!api.seatedVisible(a.deskId)) continue
        const door = nearestDoor(api.plan, a.deskId, anchor)
        if (!door) continue
        api.hideSeated(a.deskId)
        const run: ArrivalRun = {
          walker: api.spawnWalker({
            agent: info.agent,
            color: info.color,
            seed: info.seed,
            from: door,
            to: anchor,
          }),
          arrived: false,
        }
        // senta no onTick — fora do update dos walkers (cancel durante a
        // iteração destruiria o avatar no meio do próprio frame)
        run.walker.onArrive(() => {
          run.arrived = true
        })
        arrivalRuns.set(a.deskId, run)
      }
    },

    onTick(_dtSec, api) {
      if (api.reducedMotion) return
      const time = api.time

      // -- chegada: efetiva a sentada (walker some, sentado aparece) --------
      for (const [deskId, run] of arrivalRuns) {
        if (run.walker.done) {
          arrivalRuns.delete(deskId)
          continue
        }
        if (run.arrived) {
          run.walker.cancel()
          api.showSeated(deskId)
          arrivalRuns.delete(deskId)
        }
      }

      // -- pensar andando ---------------------------------------------------
      for (const deskId of api.deskIds()) {
        if (api.deskState(deskId) === "thinking") {
          if (!thinkingSince.has(deskId)) thinkingSince.set(deskId, time)
        } else thinkingSince.delete(deskId)
      }
      for (const [deskId, run] of paceRuns) {
        if (!run.alive || run.trip.walker.done) {
          paceRuns.delete(deskId)
          continue
        }
        // os balões de pensamento seguem o caminhante
        run.dots.tick(time, 0, false)
      }
      for (const [deskId, since] of thinkingSince) {
        if (time - since < thinkAfterS) continue
        if (paceRuns.size >= PACE_MAX) break
        let slot = paceSlots.get(deskId)
        if (!slot) {
          slot = { targets: null, k: 0, nextAt: 0, legsLeft: 0 }
          paceSlots.set(deskId, slot)
        }
        if (time < slot.nextAt) continue
        if (paceRuns.has(deskId) || api.activeTrip(deskId)) continue
        if (!api.seatedVisible(deskId)) continue
        const anchor = api.deskAnchor(deskId)
        const info = api.deskInfo(deskId)
        if (!anchor || !info) continue
        slot.targets ??= paceTargets(api.plan, anchor)
        if (slot.targets.length === 0) {
          slot.nextAt = time + 60 // sala apertada: nem tenta por um tempo
          continue
        }
        // episódio novo? sorteia 1..PACE_LEGS_MAX pernas
        if (slot.legsLeft <= 0) {
          slot.legsLeft = 1 + Math.floor(Math.random() * PACE_LEGS_MAX)
        }
        // vai-e-vem com jitter: alterna direções válidas, mas o PONTO varia a
        // cada perna (span encurtado aleatório) — nunca o mesmo pêndulo exato
        const base = slot.targets[slot.k++ % slot.targets.length]
        const f = PACE_SPAN_MIN_F + Math.random() * PACE_SPAN_JIT_F
        const to: Vec2 = {
          x: anchor.x + (base.x - anchor.x) * f,
          y: anchor.y + (base.y - anchor.y) * f,
        }
        const theSlot = slot
        const run: PaceRun = {
          trip: null as unknown as BehaviorTrip,
          dots: null as unknown as ThoughtDots,
          alive: true,
        }
        const restS = fast
          ? 4 + Math.random() * 4
          : PACE_REST_MIN_S + Math.random() * (PACE_REST_MAX_S - PACE_REST_MIN_S)
        const trip = api.beginTrip({
          deskId,
          priority: BEHAVIOR_PRIORITY.wander,
          startStates: THINKING_ONLY,
          keepStates: THINKING_ONLY,
          to,
          pauseS: PACE_PAUSE_S + Math.random() * PACE_PAUSE_JIT_S,
          speed: PACE_SPEED_MIN + Math.random() * PACE_SPEED_JIT,
          onDone() {
            run.alive = false
            paceRuns.delete(deskId)
            theSlot.legsLeft--
            // fim do episódio ⇒ senta e DESCANSA (nada de loop infinito);
            // senão só um micro-respiro antes da próxima perna
            theSlot.nextAt =
              theSlot.legsLeft > 0
                ? api.time + PACE_GAP_S + Math.random() * 0.6
                : api.time + restS
          },
          onAbort() {
            run.alive = false
            paceRuns.delete(deskId)
            theSlot.legsLeft = 0 // estado mudou: episódio morre junto
            theSlot.nextAt = api.time + PACE_BLOCKED_RETRY_S
          },
        })
        if (!trip) {
          slot.nextAt = time + PACE_BLOCKED_RETRY_S
          continue
        }
        run.trip = trip
        const dots = createThoughtDots(info.color)
        dots.root.position.set(28, -92) // acima da cabeça do avatar EM PÉ
        trip.walker.root.addChild(dots.root)
        run.dots = dots
        paceRuns.set(deskId, run)
      }

      // -- descanso no sofá -------------------------------------------------
      for (const [deskId, run] of restRuns) {
        if (!run.alive || run.trip.walker.done) {
          restRuns.delete(deskId)
          continue
        }
        if (run.zzz) run.zzz.tick(time)
        const until = restUntilByDesk.get(deskId)
        const phase = run.trip.phase
        if (until === undefined || Date.now() >= until || phase === "return") {
          // acordou (restUntil passou/sumiu) ou o orquestrador mandou voltar
          clearRestFx(run)
          if (!run.trip.walker.done) run.trip.walker.leave() // idempotente
        }
      }
      const sofa = api.targets.sofa
      if (sofa) {
        for (const [deskId, until] of restUntilByDesk) {
          if (until - Date.now() < restMinRemainMs) continue
          if (restRuns.has(deskId) || api.activeTrip(deskId)) continue
          if (api.deskState(deskId) !== "idle") continue
          if (!api.seatedVisible(deskId)) continue
          const info = api.deskInfo(deskId)
          if (!info) continue
          // encostos levemente espalhados (nunca 2 dorminhocos no mesmo pixel)
          const to = { x: sofa.x + ((info.seed % 3) - 1) * 0.6, y: sofa.y }
          const run: RestRun = {
            trip: null as unknown as BehaviorTrip,
            zzz: null,
            alive: true,
          }
          const trip = api.beginTrip({
            deskId,
            priority: BEHAVIOR_PRIORITY.sofaRest,
            startStates: IDLE_ONLY,
            keepStates: IDLE_ONLY,
            to,
            pauseS: REST_PAUSE_CAP_S,
            onArrive(t) {
              if (!run.alive) return
              const zzz = createZzz()
              zzz.root.position.set(16, -86) // acima da cabeça, lado direito
              t.walker.root.addChild(zzz.root)
              t.walker.root.rotation = REST_LEAN_RAD // encostado no sofá
              run.zzz = zzz
            },
            onDone() {
              run.alive = false
              restRuns.delete(deskId)
            },
            onAbort() {
              run.alive = false
              restRuns.delete(deskId)
            },
          })
          if (!trip) continue
          run.trip = trip
          restRuns.set(deskId, run)
        }
      }

      // -- cumprimento (in-place; nenhum walker) ----------------------------
      const boss = api.bossPos()
      for (const deskId of api.deskIds()) {
        const last = greetAt.get(deskId)
        if (last !== undefined && time - last < greetCooldownS) continue
        const anchor = api.deskAnchor(deskId)
        if (!anchor) continue
        const dist = Math.hypot(boss.x - anchor.x, boss.y - anchor.y)
        if (dist > GREET_DIST_TILES) continue
        if (api.deskState(deskId) !== "idle") continue
        if (!api.seatedVisible(deskId) || api.activeTrip(deskId)) continue
        greetAt.set(deskId, time)
        api.waveSeated?.(deskId)
      }
    },
  }
}
