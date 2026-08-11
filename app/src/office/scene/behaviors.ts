/** SISTEMA DE COMPORTAMENTOS do Agent Office — orquestrador com ARBITRAGEM
 *  CENTRAL de "viagens" (o avatar sentado levanta, caminha até um destino,
 *  pausa e volta; ao sumir, o sentado reaparece).
 *
 *  Princípios (docs/agent-office.md):
 *  - Todo movimento reflete estado REAL do runtime — packs decidem QUANDO a
 *    partir do snapshot/tick; o orquestrador decide SE (arbitragem).
 *  - Invariante nº1: aborto/fim de viagem SEMPRE restaura o avatar sentado.
 *  - Cap global de MAX_BEHAVIOR_WALKERS walkers; prioridade maior pode ABORTAR
 *    um comportamento menor (da mesma mesa, ou o de menor prioridade do
 *    escritório quando o cap está cheio).
 *  - Uma mesa nunca tem 2 comportamentos ativos.
 *  - Mesa não-idle nunca INICIA comportamento ocioso (idle: true).
 *  - RESERVA de mesa-alvo: viagem com targetDeskId (visita reviewer/gate)
 *    reserva a mesa visitada — ociosos do dono são negados e um ocioso em voo
 *    é recalled graciosamente; a reserva morre com a viagem reservante.
 *  - reducedMotion ⇒ nenhuma viagem spawna (beginTrip devolve null).
 *
 *  PACKS: comportamentos moram em scene/behaviors/*.ts e são registrados via
 *  registerPack({id, onSnapshot?, onTick?}) — registro ADITIVO, um pack por
 *  linha no wiring do stage (fácil de mergear entre frentes).
 *
 *  PURO de Pixi em runtime: só importa TIPOS de walkers/avatars — 100%
 *  testável com um WalkerSystem real headless + ctx fake (behaviors.test.ts).
 */
import type { StandingCarry } from "./avatars"
import type { Walker, WalkerSpawnOpts, WalkerSystem } from "./walkers"
import type {
  DeskVisualState,
  FloorPlan,
  OfficeAgentId,
  OfficeSnapshot,
  Vec2,
} from "@/lib/fleet/types"
import { perfSpan } from "@/lib/fleet/perf"

/** Cap GLOBAL de walkers de comportamento simultâneos no escritório. */
export const MAX_BEHAVIOR_WALKERS = 3

/** Prioridades canônicas (maior vence): handoff > descanso-sofá >
 *  reviewer-visita > kickoff/guerra > bastão > café > passeio-pensante.
 *  Packs usam estes valores em beginTrip — números com folga entre si para
 *  variações internas de um pack (ex.: coffee + 1). */
export const BEHAVIOR_PRIORITY = {
  handoff: 70,
  sofaRest: 60,
  reviewerVisit: 50,
  kickoff: 40,
  baton: 30,
  coffee: 20,
  wander: 10,
} as const

/** Hash 32-bit FNV-1a (mesmo algoritmo de props/layout — cópia PURA para
 *  packs não dependerem de módulos com Pixi). Determinístico por string. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// ---------------------------------------------------------------------------
// Contratos (as frentes de packs dependem EXATAMENTE destes tipos)
// ---------------------------------------------------------------------------

/** Destinos canônicos de comportamento, em coords contínuas de MUNDO (tiles).
 *  null = a planta não tem a sala correspondente (planta vazia/de teste). */
export type BehaviorTargets = {
  /** Frente da cafeteira (cozinha da sala comum). */
  coffee: Vec2 | null
  /** Frente do bebedouro da cozinha (fallback do café; passeios). */
  waterCooler: Vec2 | null
  /** Ao lado do sofá do lounge (sala comum, canto SE). */
  sofa: Vec2 | null
  /** Faixa livre ao sul do mesão de reunião (interactTile da sala comum). */
  meetingTable: Vec2 | null
  /** Atendimento em frente à mesa executiva (sala do boss). */
  bossDesk: Vec2 | null
}

/** Extrai os destinos canônicos da planta (sala comum + sala do boss).
 *  O stage usa isto para montar o ctx; puro e determinístico. */
export function behaviorTargetsFromPlan(plan: FloorPlan): BehaviorTargets {
  const c = plan.commonRoom
  return {
    coffee: c ? { x: c.origin.x + 1.5, y: c.origin.y + 1.5 } : null,
    waterCooler: c ? { x: c.origin.x + 3.5, y: c.origin.y + 1.5 } : null,
    sofa: c ? { x: c.origin.x + 8.5, y: c.origin.y + 6.5 } : null,
    meetingTable: c ? { x: c.origin.x + 6.5, y: c.origin.y + 6.5 } : null,
    bossDesk: plan.bossRoom
      ? {
          x: plan.bossRoom.interactTile.x + 0.5,
          y: plan.bossRoom.interactTile.y + 0.5,
        }
      : null,
  }
}

/** Dados de uma mesa para spawnar um walker "com a cara" do agent dela. */
export type BehaviorDeskInfo = {
  id: string
  agent: OfficeAgentId
  /** Cor do agent (mesma dos labels/avatar sentado). */
  color: string
  /** Seed determinística da mesa (hashSeed(deskId)). */
  seed: number
  /** Centro caminhável do interactTile (origem/destino de walkers), em tiles. */
  anchor: Vec2
}

/** Contexto fornecido PELO STAGE a cada update/applySnapshot — a ponte única
 *  entre comportamentos e cena. O stage MUTA `time` antes de cada chamada. */
export type BehaviorCtx = {
  /** Esconde o avatar SENTADO da mesa (virou walker). */
  hideSeated(deskId: string): void
  /** Mostra o avatar SENTADO da mesa (invariante nº1: todo fim/aborto chama). */
  showSeated(deskId: string): void
  seatedVisible(deskId: string): boolean
  /** Centro caminhável de interação da mesa, em tiles (null = mesa desconhecida). */
  deskAnchor(deskId: string): Vec2 | null
  /** Estado corrente do snapshot (null = mesa desconhecida). */
  deskState(deskId: string): DeskVisualState | null
  deskInfo(deskId: string): BehaviorDeskInfo | null
  /** Todas as mesas da planta (ordem estável). */
  deskIds(): readonly string[]
  /** Posição do boss em coords de MUNDO (tiles) do último render. */
  bossPos(): Vec2
  targets: BehaviorTargets
  /** Relógio da sim (s) — o stage atualiza antes de update/applySnapshot. */
  time: number
  /** walkers.spawn + addChild na camada dinâmica (o stage cuida da cena). */
  spawnWalker(opts: WalkerSpawnOpts): Walker
  /** Balão efêmero "📄 handoff" na mesa (efeito de cena; no-op sem a mesa). */
  handoffBubble(deskId: string): void
  /** Aceno curto do avatar SENTADO olhando pro lado do boss (~1.2s; efeito de
   *  cena do pack pessoal). OPCIONAL: ctx de teste/plantas mínimas omitem. */
  waveSeated?(deskId: string): void
}

export type BehaviorTripPhase = "go" | "pause" | "return" | "done"

export type BehaviorTrip = {
  readonly deskId: string
  readonly priority: number
  readonly phase: BehaviorTripPhase
  readonly walker: Walker
  /** Troca o prop na mão do walker (doc/coffee/null). */
  setCarrying(item: StandingCarry): void
  /** Aborta JÁ: cancela o walker, restaura o sentado e dispara onAbort. */
  abort(): void
}

export type BehaviorTripOpts = {
  deskId: string
  /** Prioridade da arbitragem (BEHAVIOR_PRIORITY.*). */
  priority: number
  /** Comportamento OCIOSO: exige mesa "idle" para iniciar e aborta no
   *  applySnapshot quando ela sai de "idle". Força startStates/keepStates. */
  idle?: boolean
  /** Estados da mesa em que a viagem pode INICIAR
   *  (default: ["idle","off"]; ignorado com idle: true). */
  startStates?: readonly DeskVisualState[]
  /** Estados em que a viagem SEGUE viva no applySnapshot — fora deles o
   *  orquestrador aborta (default: ["idle","off"]; ignorado com idle: true). */
  keepStates?: readonly DeskVisualState[]
  /** Destino em coords contínuas de MUNDO (tiles). */
  to: Vec2
  /** Prop na mão durante a IDA (doc/coffee). */
  carrying?: StandingCarry
  /** Velocidade do walker (tiles/s; default do sistema). Pensador anda mais
   *  devagar que courier — variação sutil deixa o movimento natural. */
  speed?: number
  /** Pausa no destino antes de voltar (s; default 0 = volta direto). */
  pauseS?: number
  /** Mesa-ALVO de uma VISITA (reviewer/gate): o orquestrador RESERVA a mesa
   *  enquanto esta viagem viver — o dono dela não INICIA comportamento ocioso
   *  (café/passeio negados) e um ocioso EM VOO é recalled graciosamente (volta
   *  andando; nunca cancela seco). A reserva é liberada no fim/aborto da
   *  viagem reservante — o visitante nunca revisa cadeira vazia por ócio. */
  targetDeskId?: string
  /** Chegada ao destino (trocar carrying, balão, etc.). */
  onArrive?(trip: BehaviorTrip): void
  /** Ciclo completo (voltou à mesa e sumiu; sentado já restaurado). */
  onDone?(): void
  /** Abortado (prioridade maior, mudança de estado, clear; sentado já restaurado). */
  onAbort?(): void
}

/** API entregue aos packs (ctx do stage + arbitragem central). */
export type BehaviorApi = BehaviorCtx & {
  plan: FloorPlan
  reducedMotion: boolean
  /** Pede uma viagem à arbitragem. null = negada (reducedMotion, mesa
   *  desconhecida, estado fora de startStates, mesa já ocupada por prioridade
   *  ≥, sentado indisponível ou cap cheio sem menor-prioridade p/ derrubar). */
  beginTrip(opts: BehaviorTripOpts): BehaviorTrip | null
  /** Viagem ativa da mesa, se houver (de QUALQUER pack). */
  activeTrip(deskId: string): BehaviorTrip | null
  /** Mesa reservada como ALVO de uma visita viva (targetDeskId)? Packs de
   *  comportamento ocioso podem checar antes de gastar agenda — o beginTrip
   *  nega de qualquer forma. */
  deskReserved(deskId: string): boolean
  /** Viagens ativas no escritório (cap MAX_BEHAVIOR_WALKERS). */
  tripCount(): number
}

export type BehaviorPack = {
  id: string
  /** Snapshot discreto (≤10Hz), chamado DEPOIS dos abortos por estado. */
  onSnapshot?(s: OfficeSnapshot, api: BehaviorApi): void
  /** Tick por frame (dt da sim, clampado; api.time = relógio corrente). */
  onTick?(dtSec: number, api: BehaviorApi): void
}

export type Behaviors = {
  registerPack(pack: BehaviorPack): void
  applySnapshot(s: OfficeSnapshot, ctx: BehaviorCtx): void
  update(dtSec: number, ctx: BehaviorCtx): void
  /** Aborta todas as viagens (restaura TODOS os sentados) e limpa os walkers. */
  clear(): void
}

// ---------------------------------------------------------------------------
// Orquestrador
// ---------------------------------------------------------------------------

const IDLE_STATES: readonly DeskVisualState[] = ["idle"]
const WORK_STATES: readonly DeskVisualState[] = ["idle", "off"]

type TripState = {
  deskId: string
  priority: number
  keepStates: readonly DeskVisualState[]
  /** Comportamento OCIOSO (idle: true ou passeio-pensante) — o que uma mesa
   *  RESERVADA nega e o que uma visita recalla na mesa-alvo. */
  idleLike: boolean
  /** Mesa reservada POR esta viagem (visitas); liberada no dropTrip. */
  targetDeskId?: string
  walker: Walker
  phase: BehaviorTripPhase
  pauseUntil: number
  ctx: BehaviorCtx
  onDone?: () => void
  onAbort?: () => void
  handle: BehaviorTrip
}

export function createBehaviors(opts: {
  plan: FloorPlan
  walkers: WalkerSystem
  reducedMotion: boolean
}): Behaviors {
  const { plan, walkers, reducedMotion } = opts
  const packs: BehaviorPack[] = []
  const trips: TripState[] = []
  const byDesk = new Map<string, TripState>()
  /** Reservas de mesa-ALVO de visitas vivas: targetDeskId → viagem reservante.
   *  Reserva NOVA de mesmo alvo sobrescreve (a liberação checa identidade). */
  const reservations = new Map<string, TripState>()

  /** Remove a viagem das estruturas, libera a reserva que ela detém e
   *  restaura o sentado (invariante nº1). */
  const dropTrip = (st: TripState): void => {
    st.phase = "done"
    const i = trips.indexOf(st)
    if (i >= 0) trips.splice(i, 1)
    if (byDesk.get(st.deskId) === st) byDesk.delete(st.deskId)
    if (st.targetDeskId && reservations.get(st.targetDeskId) === st) {
      reservations.delete(st.targetDeskId)
    }
    st.ctx.showSeated(st.deskId)
  }

  const abortTrip = (st: TripState): void => {
    if (st.phase === "done") return
    st.walker.cancel() // sem onArrive/onGone — o aborto faz a contabilidade
    dropTrip(st)
    st.onAbort?.()
  }

  const finishTrip = (st: TripState): void => {
    if (st.phase === "done") return
    dropTrip(st)
    st.onDone?.()
  }

  const beginTrip = (ctx: BehaviorCtx, o: BehaviorTripOpts): BehaviorTrip | null => {
    if (reducedMotion) return null
    const info = ctx.deskInfo(o.deskId)
    const from = ctx.deskAnchor(o.deskId)
    if (!info || !from) return null
    const idle = o.idle === true
    const startStates = idle ? IDLE_STATES : (o.startStates ?? WORK_STATES)
    const keepStates = idle ? IDLE_STATES : (o.keepStates ?? WORK_STATES)
    const state = ctx.deskState(o.deskId)
    // mesa não-idle nunca inicia comportamento ocioso (e trabalho respeita
    // seus startStates)
    if (state === null || !startStates.includes(state)) return null
    // mesa RESERVADA (alvo de visita): o dono não sai por ócio — café/kickoff/
    // comemoração (idle: true) e passeio-pensante (wander) são negados; viagens
    // de TRABALHO (handoff/bastão/…) seguem passando
    const idleLike = idle || o.priority <= BEHAVIOR_PRIORITY.wander
    if (idleLike && reservations.has(o.deskId)) return null
    // uma mesa nunca tem 2 comportamentos ativos; prioridade maior ABORTA o
    // menor da mesma mesa (o aborto restaura o sentado, que vira o novo walker)
    const current = byDesk.get(o.deskId)
    if (current) {
      if (current.priority >= o.priority) return null
      abortTrip(current)
    }
    // sentado indisponível (escondido por algo fora do sistema): nega
    if (!ctx.seatedVisible(o.deskId)) return null
    // cap global: prioridade maior derruba a viagem de MENOR prioridade
    // estritamente abaixo da pedida; sem candidata, nega
    if (trips.length >= MAX_BEHAVIOR_WALKERS) {
      let lowest: TripState | null = null
      for (const t of trips) {
        if (lowest === null || t.priority < lowest.priority) lowest = t
      }
      if (lowest === null || lowest.priority >= o.priority) return null
      abortTrip(lowest)
    }

    ctx.hideSeated(o.deskId)
    const walker = ctx.spawnWalker({
      agent: info.agent,
      color: info.color,
      seed: info.seed,
      from,
      to: o.to,
      carrying: o.carrying,
      speed: o.speed,
    })
    const st: TripState = {
      deskId: o.deskId,
      priority: o.priority,
      keepStates,
      idleLike,
      targetDeskId: o.targetDeskId,
      walker,
      phase: "go",
      pauseUntil: 0,
      ctx,
      onDone: o.onDone,
      onAbort: o.onAbort,
      handle: null as unknown as BehaviorTrip,
    }
    st.handle = {
      deskId: o.deskId,
      priority: o.priority,
      get phase() {
        return st.phase
      },
      walker,
      setCarrying: (item) => walker.setCarrying(item),
      abort: () => abortTrip(st),
    }
    walker.onArrive(() => {
      if (st.phase !== "go") return
      st.phase = "pause"
      st.pauseUntil = st.ctx.time + (o.pauseS ?? 0)
      o.onArrive?.(st.handle)
    })
    walker.onGone(() => finishTrip(st))
    trips.push(st)
    byDesk.set(o.deskId, st)
    if (o.targetDeskId) {
      // ocioso EM VOO na mesa-alvo (dono no café): RECALL gracioso — o dono
      // volta ANDANDO pra cadeira enquanto o visitante chega (nunca cancela
      // seco; o sentado reaparece no onGone dele)
      const tenant = byDesk.get(o.targetDeskId)
      if (tenant && tenant.idleLike && tenant.phase !== "return") {
        tenant.phase = "return"
        tenant.walker.leave()
      }
      reservations.set(o.targetDeskId, st)
    }
    return st.handle
  }

  /** api cacheada por identidade de ctx (o stage usa UM ctx estável; `time`
   *  chega via protótipo — leitura sempre corrente, zero alocação por frame). */
  let cachedApi: BehaviorApi | null = null
  let cachedCtx: BehaviorCtx | null = null
  const apiFor = (ctx: BehaviorCtx): BehaviorApi => {
    if (cachedCtx === ctx && cachedApi) return cachedApi
    const api = Object.create(ctx) as BehaviorApi
    api.plan = plan
    api.reducedMotion = reducedMotion
    api.beginTrip = (o) => beginTrip(ctx, o)
    api.activeTrip = (deskId) => byDesk.get(deskId)?.handle ?? null
    api.deskReserved = (deskId) => reservations.has(deskId)
    api.tripCount = () => trips.length
    cachedCtx = ctx
    cachedApi = api
    return api
  }

  return {
    registerPack(pack) {
      // aditivo e idempotente por id (HMR/duplo-wiring não duplica)
      if (packs.some((p) => p.id === pack.id)) return
      packs.push(pack)
    },

    applySnapshot(s, ctx) {
      // 1) mudanças de estado: viagem VIVA sempre mantém o sentado oculto
      //    (setState→applyPose pode tê-lo re-mostrado — nunca 2 corpos), e mesa
      //    fora dos keepStates ⇒ RECALL GRACIOSO: o walker VOLTA ANDANDO
      //    (leave; o sentado reaparece no onGone). Nada de teleporte pra
      //    cadeira — o "pulo" seco lia como bug. Aborto instantâneo fica só
      //    para prioridade maior/clear/destroy.
      for (let i = trips.length - 1; i >= 0; i--) {
        const st = trips[i]
        if (ctx.seatedVisible(st.deskId)) ctx.hideSeated(st.deskId)
        const state = ctx.deskState(st.deskId)
        if (state !== null && st.keepStates.includes(state)) continue
        if (st.phase !== "return") {
          st.phase = "return"
          st.walker.leave()
        }
      }
      // 2) packs reagem ao snapshot (podem iniciar viagens novas)
      const api = apiFor(ctx)
      for (const pack of packs) pack.onSnapshot?.(s, api)
    },

    update(dtSec, ctx) {
      const endSpan = perfSpan("behaviors") // S4 (no-op sem mc.office.perf)
      // pausas vencidas ⇒ volta pelo caminho (leave; onGone restaura)
      for (const st of trips) {
        if (st.phase === "pause" && ctx.time >= st.pauseUntil) {
          st.phase = "return"
          st.walker.leave()
        }
      }
      const api = apiFor(ctx)
      for (const pack of packs) pack.onTick?.(dtSec, api)
      // avanço físico (dispara onArrive/onGone dos trips)
      walkers.update(dtSec, reducedMotion)
      endSpan()
    },

    clear() {
      for (let i = trips.length - 1; i >= 0; i--) abortTrip(trips[i])
      walkers.clear()
    },
  }
}
