/** Pack CORE — os dois comportamentos originais do stage, migrados 1:1:
 *
 *  HANDOFF (courier de missão): fase done → próxima com agent diferente na
 *  mesma sala (snapshot.handoffs, TTL 20s no derive). O agent da mesa de
 *  ORIGEM levanta com um documento, entrega na mesa destino (balão
 *  "📄 handoff"), pausa e volta. Dedupe por from::to::at com memória de 60s;
 *  spawn negado NÃO marca visto — retenta no próximo snapshot (o TTL do
 *  derive limita as tentativas).
 *
 *  CAFÉ (pausa ociosa): raro, só mesas "idle", no máximo UM café por vez.
 *  Intervalo por mesa sorteado por LCG determinístico (seed
 *  hashSeed(`${deskId}|coffee`)); destino = cafeteira da sala comum, fallback
 *  bebedouro (primeiro alcançável pelo A* vence). Volta com a caneca.
 *  Modo rápido (localStorage mc.office.coffeeFast=1) é só de dev/simulação.
 *
 *  Arbitragem (orquestrador): handoff > café — o courier aborta o café da
 *  própria mesa E derruba o café por capacidade quando o cap está cheio.
 */
import { findPath } from "../../engine/astar"
import {
  BEHAVIOR_PRIORITY,
  MAX_BEHAVIOR_WALKERS,
  hashSeed,
  type BehaviorApi,
  type BehaviorPack,
  type BehaviorTrip,
} from "../behaviors"
import type { Vec2 } from "../../engine/types"

/** Pausa do courier na mesa destino antes de voltar (s). */
export const HANDOFF_PAUSE_S = 0.9
/** Handoffs já atendidos (dedupe from::to::at) expiram da memória em 60s. */
const HANDOFF_SEEN_TTL_MS = 60_000

/** Pausa com a caneca na cafeteira (s). */
export const COFFEE_PAUSE_S = 4
/** Intervalo entre cafés da MESMA mesa (s, sorteado por seed da mesa). */
const COFFEE_MIN_S = 180
const COFFEE_MAX_S = 360
const COFFEE_FAST_MIN_S = 8
const COFFEE_FAST_MAX_S = 16

type CoffeeSlot = {
  /** Relógio da sim (s) do próximo café; <0 = re-agendar a partir de agora. */
  nextAt: number
  /** LCG por mesa — intervalos determinísticos entre sessões. */
  seed: number
}

export function createCorePack(): BehaviorPack {
  /** Handoffs já atendidos (chave from::to::at → at) — dedupe entre snapshots. */
  const seenHandoffs = new Map<string, number>()
  const coffeeSlots = new Map<string, CoffeeSlot>()
  let coffeeTrip: BehaviorTrip | null = null

  const coffeeFast =
    typeof localStorage !== "undefined" &&
    localStorage.getItem("mc.office.coffeeFast") === "1"
  const coffeeMinS = coffeeFast ? COFFEE_FAST_MIN_S : COFFEE_MIN_S
  const coffeeSpanS = (coffeeFast ? COFFEE_FAST_MAX_S : COFFEE_MAX_S) - coffeeMinS
  const nextCoffeeDelay = (slot: CoffeeSlot): number => {
    slot.seed = (Math.imul(slot.seed, 1664525) + 1013904223) >>> 0
    return coffeeMinS + (slot.seed / 0xffffffff) * coffeeSpanS
  }

  const startCoffee = (api: BehaviorApi, deskId: string, slot: CoffeeSlot): void => {
    const from = api.deskAnchor(deskId)
    if (!from) return
    // destino: 1º alcançável pelo A* real (cafeteira, depois bebedouro)
    let to: Vec2 | null = null
    for (const target of [api.targets.coffee, api.targets.waterCooler]) {
      if (target && findPath(api.plan, from, target)) {
        to = target
        break
      }
    }
    slot.nextAt = api.time + nextCoffeeDelay(slot)
    if (!to) return // sala comum inalcançável desta mesa: fica pro próximo
    const trip = api.beginTrip({
      deskId,
      priority: BEHAVIOR_PRIORITY.coffee,
      idle: true,
      to,
      pauseS: COFFEE_PAUSE_S,
      onArrive(t) {
        t.setCarrying("coffee") // caneca servida — volta com ela
      },
      onDone() {
        coffeeTrip = null
        slot.nextAt = -1 // re-agenda a partir do relógio corrente
      },
      onAbort() {
        coffeeTrip = null
        slot.nextAt = -1
      },
    })
    if (trip) coffeeTrip = trip
  }

  return {
    id: "core",

    onSnapshot(s, api) {
      // memória de dedupe expira por relógio de PAREDE (at vem do derive em ms)
      const wall = Date.now()
      for (const [key, at] of seenHandoffs) {
        if (wall - at > HANDOFF_SEEN_TTL_MS) seenHandoffs.delete(key)
      }
      // reducedMotion ⇒ sem courier (o balão de entrega do overlay já cobre)
      if (api.reducedMotion) return
      for (const h of s.handoffs ?? []) {
        const key = `${h.fromDeskId}::${h.toDeskId}::${h.at}`
        if (seenHandoffs.has(key)) continue
        const to = api.deskAnchor(h.toDeskId)
        if (!api.deskInfo(h.fromDeskId) || !api.deskInfo(h.toDeskId) || !to) {
          seenHandoffs.set(key, h.at) // sem como atender — não retenta
          continue
        }
        const trip = api.beginTrip({
          deskId: h.fromDeskId,
          priority: BEHAVIOR_PRIORITY.handoff,
          to,
          carrying: "doc",
          pauseS: HANDOFF_PAUSE_S,
          onArrive(t) {
            t.setCarrying(null) // documento entregue
            api.handoffBubble(h.toDeskId)
          },
        })
        // negado (mesa ocupada/ativa/cap sem vítima): NÃO marca visto —
        // retenta no próximo snapshot; o TTL de 20s do derive limita
        if (trip) seenHandoffs.set(key, h.at)
      }
    },

    onTick(_dtSec, api) {
      if (api.reducedMotion) return
      const time = api.time
      for (const deskId of api.deskIds()) {
        let slot = coffeeSlots.get(deskId)
        if (!slot) {
          slot = { nextAt: -1, seed: hashSeed(`${deskId}|coffee`) }
          coffeeSlots.set(deskId, slot)
        }
        if (slot.nextAt < 0) slot.nextAt = time + nextCoffeeDelay(slot)
        // raro, só mesa idle com sentado presente, no máx. 1 café por vez e
        // sem estourar o cap (bloqueado ⇒ NÃO re-agenda: sai assim que puder)
        if (coffeeTrip !== null) continue
        if (api.tripCount() >= MAX_BEHAVIOR_WALKERS) continue
        if (api.deskState(deskId) !== "idle") continue
        if (!api.seatedVisible(deskId)) continue
        // mesa RESERVADA (alvo de visita do reviewer/gate): o dono fica na
        // cadeira — nem gasta a vaga de "1 café por vez" com uma negada
        if (api.deskReserved(deskId)) continue
        if (time < slot.nextAt) continue
        startCoffee(api, deskId, slot)
      }
    },
  }
}
