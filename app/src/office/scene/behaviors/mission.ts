/** Pack MISSÃO/SOCIAL — os movimentos coletivos que refletem o ciclo de vida
 *  REAL das missões e conversas (todos os gatilhos vêm do snapshot do derive;
 *  nada de teatro aleatório):
 *
 *  KICKOFF (snapshot.kickoffs, TTL 25s): a missão saiu de ausente/queued →
 *  running — os agents das mesas das fases que estiverem LIVRES (idle) caminham
 *  até a mesa de reunião da sala comum, pausam ~5s juntos e voltam; quem está
 *  trabalhando fica. No máximo UMA reunião de kickoff por vez (evento não
 *  atendido retenta enquanto o TTL do derive o reapresentar).
 *
 *  VISITA DO REVIEWER (room.mission): fase corrente persona=reviewer RODANDO
 *  com mesa mapeada ⇒ o reviewer levanta, caminha até a mesa do EXECUTOR da
 *  missão e fica em pé ao lado dela enquanto a fase rodar (poll por snapshot);
 *  quando a fase muda/termina/aborta, volta andando (leave — não teleporta).
 *
 *  GATE-VISIT (mesa com hand:"gate"): o gate de missão é o evento nº1 — em vez
 *  de só levantar a mão na própria mesa, o agent CAMINHA até a mesa do Boss
 *  (targets.bossDesk) e ESPERA lá a decisão (pauseS ∞), reservando o posto via
 *  targetDeskId (BOSS_DESK_ID). Máx. 1 visita por vez: um 2º gate simultâneo
 *  fica de mão levantada na própria mesa até o posto vagar. Gate resolvido/
 *  missão abortada (a mesa sai de "hand") ⇒ volta andando — keepStates
 *  ["hand"] deixa o recall gracioso do orquestrador cobrir também. A ui/ é
 *  notificada via onGateVisitChange (balão "✋" + menu "Responder" na mesa do
 *  Boss) e a cena consulta activeGateVisit() pro hit-test do walker.
 *
 *  SALA DE GUERRA (room.war): disputa Fusion ativa ⇒ os candidatos caminham
 *  até a mesa de reunião e ficam frente a frente PENSANDO (thought-dots) até a
 *  disputa sumir do snapshot; aí voltam andando.
 *
 *  BASTÃO (snapshot.batons, TTL 20s): a conversa trocou de agent — courier da
 *  mesa antiga leva o documento até a nova (mesma mecânica do handoff, com a
 *  prioridade de bastão).
 *
 *  COMEMORAÇÃO (snapshot.celebrations, TTL 12s): missão → done — os agents
 *  LIVRES da sala levantam e dão pulinhos na frente da mesa por ~2s
 *  (transform-only) sob um confete discreto (scene/effects.createConfetti).
 *
 *  ENTREGA AO BOSS (snapshot.bossDeliveries, TTL 30s): resultado de fim de
 *  turno — courier leva o documento até a mesa executiva do Boss, DEIXA o
 *  papel lá (some da mão) e volta. O drop notifica os assinantes de
 *  onBossDeskDrop — a ui/ (store) bumpa o contador unseenDeliveries (a pilha
 *  visual de papel na mesa é da frente ambiente).
 *
 *  Arbitragem: tudo passa pelo beginTrip do orquestrador (prioridades
 *  BEHAVIOR_PRIORITY, aborto restaura o sentado, cap global). reducedMotion ⇒
 *  o pack inteiro é no-op (nenhum walker, nenhum confete).
 */
import { createConfetti, createThoughtDots, type Confetti } from "../effects"
import {
  BEHAVIOR_PRIORITY,
  hashSeed,
  type BehaviorApi,
  type BehaviorPack,
  type BehaviorTrip,
} from "../behaviors"
import {
  BOSS_DESK_ID,
  type OfficeSnapshot,
  type DeskVisualState,
  type Vec2,
} from "../../engine/types"

/** Pausa da reunião de kickoff na mesa da sala comum (s). */
export const KICKOFF_PAUSE_S = 5
/** Pausa do courier de bastão na mesa destino (s) — igual ao handoff. */
export const BATON_PAUSE_S = 0.9
/** Pausa do courier deixando o papel na mesa do Boss (s). */
export const BOSS_DROP_PAUSE_S = 1.2
/** Duração dos pulinhos de comemoração (s). */
export const CELEBRATE_JUMP_S = 2
/** Comemoração: acima do café/passeio, abaixo do bastão (variação do pack). */
export const CELEBRATE_PRIORITY = BEHAVIOR_PRIORITY.coffee + 2
/** Guerra Fusion divide o degrau do kickoff (doc: "kickoff/guerra"). */
export const WAR_PRIORITY = BEHAVIOR_PRIORITY.kickoff
/** Gate-visit é o evento nº1 da casa: acima da visita do reviewer E do
 *  handoff — a espera pela decisão nunca é derrubada pelo cap cheio. */
export const GATE_VISIT_PRIORITY = BEHAVIOR_PRIORITY.handoff + 5
/** Ponto de ESPERA do gate-visit relativo ao atendimento da mesa do Boss
 *  (targets.bossDesk), em tiles: o agent espera AO LADO — o tile de
 *  atendimento fica livre pro boss chegar e conversar de frente (clicar no
 *  walker leva o boss até lá; dois corpos no mesmo tile leriam como bug).
 *  ui/Prompts usa o MESMO deslocamento pra ancorar o balão "✋". */
export const GATE_WAIT_OFFSET: Vec2 = { x: 0, y: 0.9 }

/** Eventos atendidos (dedupe por chave) expiram da memória em 60s — mesmo
 *  padrão do seenHandoffs do pack core (o TTL do derive limita retentativas). */
const SEEN_TTL_MS = 60_000

/** Estados em que uma mesa COM fase de missão/disputa rodando opera — a viagem
 *  do reviewer/guerra nasce e segue viva com a mesa trabalhando (thinking/
 *  typing); "hand" (gate/approval) e "off" trazem o avatar de volta. */
const ACTIVE_STATES: readonly DeskVisualState[] = ["idle", "thinking", "typing"]

/** Estados da viagem de GATE-VISIT: nasce e vive só com a mesa em "hand" —
 *  o gate resolvido tira a mesa de "hand" e o próprio orquestrador já faz o
 *  recall gracioso (o pack só confirma via sendHome, idempotente). */
const GATE_STATES: readonly DeskVisualState[] = ["hand"]

/** Altura dos pulinhos de comemoração (px de CENA) e período de cada pulo. */
const JUMP_H = 12
const HOP_S = 0.4

// ---------------------------------------------------------------------------
// Drop na mesa do Boss → ui (direção de import permitida é ui→scene, então o
// pack só EMITE; ui/store se inscreve aqui e mantém o contador unseenDeliveries)
// ---------------------------------------------------------------------------

const bossDropListeners = new Set<() => void>()

/** Assina o "courier deixou um papel na mesa do Boss". Retorna o unsubscribe. */
export function onBossDeskDrop(listener: () => void): () => void {
  bossDropListeners.add(listener)
  return () => bossDropListeners.delete(listener)
}

function emitBossDeskDrop(): void {
  for (const l of bossDropListeners) l()
}

// ---------------------------------------------------------------------------
// Gate-visit → ui/cena (mesma direção do onBossDeskDrop: a cena só EMITE).
// ui/store assina onGateVisitChange (menu "Responder" + balão "✋" na mesa do
// Boss); o stage consulta activeGateVisit() no hit-test do walker.
// ---------------------------------------------------------------------------

/** Estado público do gate-visit: mesa do agent + se ele JÁ está esperando na
 *  mesa do Boss (waiting = chegou; false = ainda caminhando). */
export type GateVisit = { deskId: string; waiting: boolean }

const gateVisitListeners = new Set<(v: GateVisit | null) => void>()
/** Visita corrente (máx. 1). `pos` é a posição VIVA do walker em tiles —
 *  mesma referência mutada pelo sistema (o hit-test lê no frame). */
let gateVisitNow: (GateVisit & { pos: Vec2 }) | null = null

/** Assina mudanças do gate-visit (começou/chegou/terminou). Retorna o
 *  unsubscribe. O payload NÃO inclui a pos viva (React não quer ref mutável). */
export function onGateVisitChange(
  listener: (v: GateVisit | null) => void,
): () => void {
  gateVisitListeners.add(listener)
  return () => gateVisitListeners.delete(listener)
}

/** Visita corrente com a posição viva do walker (cena/hit-test). */
export function activeGateVisit(): (GateVisit & { pos: Vec2 }) | null {
  return gateVisitNow
}

function setGateVisit(v: (GateVisit & { pos: Vec2 }) | null): void {
  gateVisitNow = v
  const pub = v ? { deskId: v.deskId, waiting: v.waiting } : null
  for (const l of gateVisitListeners) l(pub)
}

// ---------------------------------------------------------------------------
// Pack
// ---------------------------------------------------------------------------

/** Visita longa (reviewer/guerra): viagem com pausa infinita que o pack
 *  encerra por poll — walker.leave() quando a condição sai do snapshot. */
type LongStay = {
  trip: BehaviorTrip
  /** Já mandado de volta (leave) — aguardando onDone p/ liberar o slot. */
  returning: boolean
  /** Balões de pensamento anexados ao walker (guerra) — tick no onTick. */
  dots?: ReturnType<typeof createThoughtDots>
  phase: number
}

type Jump = {
  deskId: string
  trip: BehaviorTrip
  baseY: number
  startedAt: number
  confetti: Confetti
}

export function createMissionPack(): BehaviorPack {
  /** Dedupe de eventos atendidos (chave prefixada → at). */
  const seen = new Map<string, number>()
  /** Viagens de kickoff vivas (máx. 1 reunião por vez). */
  let kickoffTrips = 0
  /** Visita do reviewer por projectId (o walker é a mesa do reviewer). */
  const visits = new Map<string, LongStay & { deskId: string; targetId: string }>()
  /** Gate-visit corrente (máx. 1 — o 2º gate espera de mão levantada). */
  let gateStay: (LongStay & { deskId: string }) | null = null
  /** Guerra por projectId → mesa → walker parado pensando. */
  const wars = new Map<string, Map<string, LongStay>>()
  /** Pulinhos de comemoração em andamento (anim no onTick). */
  const jumps: Jump[] = []

  const purgeSeen = (): void => {
    const wall = Date.now()
    for (const [key, at] of seen) {
      if (wall - at > SEEN_TTL_MS) seen.delete(key)
    }
  }

  /** Encerra uma visita longa GRACIOSAMENTE: o walker volta andando (leave);
   *  onDone/onAbort da viagem limpam o registro. Idempotente. */
  const sendHome = (stay: LongStay): void => {
    if (stay.returning) return
    stay.returning = true
    // a guerra acabou: os thought-dots somem na hora — pensar ANDANDO de volta
    // leria como se a disputa continuasse
    if (stay.dots) {
      stay.dots.root.parent?.removeChild(stay.dots.root)
      stay.dots.root.destroy({ children: true })
      stay.dots = undefined
    }
    stay.trip.walker.leave()
  }

  // --- kickoff --------------------------------------------------------------
  const syncKickoffs = (s: OfficeSnapshot, api: BehaviorApi): void => {
    for (const k of s.kickoffs ?? []) {
      const key = `k|${k.projectId}|${k.at}`
      if (seen.has(key)) continue
      // máx. 1 reunião por vez: não marca visto — retenta enquanto o TTL do
      // derive reapresentar o evento
      if (kickoffTrips > 0) continue
      const table = api.targets.meetingTable
      if (!table || k.deskIds.length === 0) {
        seen.set(key, k.at) // sem sala comum/mesas: não há como atender
        continue
      }
      const n = k.deskIds.length
      let spawned = 0
      for (let i = 0; i < n; i++) {
        // cada participante num ponto próprio da faixa livre ao sul do mesão
        const to: Vec2 = { x: table.x + (i - (n - 1) / 2) * 1.1, y: table.y }
        const trip = api.beginTrip({
          deskId: k.deskIds[i],
          priority: BEHAVIOR_PRIORITY.kickoff,
          idle: true, // quem está trabalhando FICA; abortos também via idle
          to,
          pauseS: KICKOFF_PAUSE_S,
          onDone: () => {
            kickoffTrips--
          },
          onAbort: () => {
            kickoffTrips--
          },
        })
        if (trip) {
          kickoffTrips++
          spawned++
        }
      }
      // só marca visto se AO MENOS 1 participante saiu — todas as trips negadas
      // (cap cheio de prioridades maiores) ⇒ retenta enquanto o TTL reapresentar
      if (spawned > 0) seen.set(key, k.at)
    }
  }

  // --- gate-visit (o agent vem até você) ------------------------------------
  const syncGateVisit = (s: OfficeSnapshot, api: BehaviorApi): void => {
    // mesas pedindo DECISÃO agora — só gate de missão; approval fica de mão
    // levantada na própria mesa (comportamento clássico)
    const wanting: { deskId: string }[] = []
    for (const room of s.rooms) {
      for (const d of room.desks) {
        if (d.state === "hand" && d.hand === "gate") wanting.push({ deskId: d.id })
      }
    }
    // gate resolvido / missão abortada (mesa saiu de hand:"gate") ⇒ o agent
    // volta andando pra própria mesa (idempotente com o recall do orquestrador)
    if (gateStay && !wanting.some((w) => w.deskId === gateStay!.deskId)) {
      sendHome(gateStay)
    }
    const bossDesk = api.targets.bossDesk
    // máx. 1 visita por vez (ativa OU voltando — espera o posto vagar de
    // verdade); sem mesa do Boss (planta de teste) não há aonde ir
    if (gateStay || !bossDesk) return
    // espera AO LADO do ponto de atendimento (GATE_WAIT_OFFSET)
    const to: Vec2 = {
      x: bossDesk.x + GATE_WAIT_OFFSET.x,
      y: bossDesk.y + GATE_WAIT_OFFSET.y,
    }
    for (const w of wanting) {
      // mesa ainda ocupada por outra viagem (ex.: café voltando do recall por
      // estado) ⇒ espera a cadeira restaurar — nunca derruba seco (poll)
      if (api.activeTrip(w.deskId)) continue
      const trip = api.beginTrip({
        deskId: w.deskId,
        priority: GATE_VISIT_PRIORITY,
        startStates: GATE_STATES,
        keepStates: GATE_STATES,
        to,
        // reserva o POSTO do Boss enquanto a visita viver (1 visitante; a
        // liberação vem de graça no fim/aborto da viagem reservante)
        targetDeskId: BOSS_DESK_ID,
        pauseS: Number.POSITIVE_INFINITY, // espera a decisão (poll decide a volta)
        onArrive: () => {
          // chegou: agora ESPERA na mesa do Boss — a ui acende o balão "✋"
          if (gateVisitNow?.deskId === w.deskId) {
            setGateVisit({ ...gateVisitNow, waiting: true })
          }
        },
        onDone: () => {
          gateStay = null
          setGateVisit(null)
        },
        onAbort: () => {
          gateStay = null
          setGateVisit(null)
        },
      })
      if (trip) {
        gateStay = { trip, returning: false, phase: 0, deskId: w.deskId }
        setGateVisit({ deskId: w.deskId, waiting: false, pos: trip.walker.pos })
        break
      }
    }
  }

  // --- visita do reviewer ---------------------------------------------------
  const syncReviewerVisits = (s: OfficeSnapshot, api: BehaviorApi): void => {
    /** Visitas desejadas AGORA: projectId → reviewer (walker) + mesa alvo. */
    const want = new Map<string, { deskId: string; targetId: string; to: Vec2 }>()
    for (const room of s.rooms) {
      const m = room.mission
      if (!m) continue
      const cur = m.phases[m.current]
      if (!cur || cur.persona !== "reviewer" || cur.status !== "running") continue
      // executorDeskId = mesa do agent da fase CORRENTE ⇒ a mesa do reviewer
      if (!m.executorDeskId) continue
      // mesa do EXECUTOR da missão: última fase de persona executor
      let execAgent: string | null = null
      for (let i = m.phases.length - 1; i >= 0; i--) {
        if (m.phases[i].persona === "executor") {
          execAgent = m.phases[i].agent
          break
        }
      }
      if (!execAgent) continue
      const targetId = `${room.projectId}::${execAgent}`
      if (targetId === m.executorDeskId) continue // revisa a própria mesa
      const to = api.deskAnchor(targetId)
      if (!to) continue
      want.set(room.projectId, { deskId: m.executorDeskId, targetId, to })
    }
    // fase mudou/terminou (ou trocou de mesa) ⇒ o reviewer volta andando
    for (const [projectId, visit] of visits) {
      const w = want.get(projectId)
      if (w && w.deskId === visit.deskId && w.targetId === visit.targetId) continue
      sendHome(visit)
    }
    // inicia as visitas que faltam (poll: negada tenta de novo no próximo)
    for (const [projectId, w] of want) {
      if (visits.has(projectId)) continue // ativa OU voltando — espera limpar
      const trip = api.beginTrip({
        deskId: w.deskId,
        priority: BEHAVIOR_PRIORITY.reviewerVisit,
        startStates: ACTIVE_STATES,
        keepStates: ACTIVE_STATES,
        to: w.to,
        // RESERVA a mesa do executor: o dono não sai pro café e um café em
        // voo é recalled — o reviewer nunca revisa cadeira vazia
        targetDeskId: w.targetId,
        pauseS: Number.POSITIVE_INFINITY, // o pack decide a volta (sendHome)
        onDone: () => visits.delete(projectId),
        onAbort: () => visits.delete(projectId),
      })
      if (trip) {
        visits.set(projectId, {
          trip,
          returning: false,
          phase: 0,
          deskId: w.deskId,
          targetId: w.targetId,
        })
      }
    }
  }

  // --- sala de guerra (disputa Fusion) --------------------------------------
  const syncWars = (s: OfficeSnapshot, api: BehaviorApi): void => {
    const table = api.targets.meetingTable
    const active = new Map<string, string[]>()
    if (table) {
      for (const room of s.rooms) {
        if (room.war && room.war.deskIds.length > 0) {
          active.set(room.projectId, room.war.deskIds)
        }
      }
    }
    // disputa terminou (ou mesa saiu da lista) ⇒ todo mundo volta andando
    for (const [projectId, byDesk] of wars) {
      const deskIds = active.get(projectId)
      for (const [deskId, stay] of byDesk) {
        if (!deskIds?.includes(deskId)) sendHome(stay)
      }
      if (byDesk.size === 0) wars.delete(projectId)
    }
    if (!table) return
    // frente a frente na mesa de reunião, pensando (poll re-tenta negados)
    for (const [projectId, deskIds] of active) {
      let byDesk = wars.get(projectId)
      if (!byDesk) {
        byDesk = new Map()
        wars.set(projectId, byDesk)
      }
      for (let i = 0; i < deskIds.length; i++) {
        const deskId = deskIds[i]
        if (byDesk.has(deskId)) continue // ativa OU voltando — espera limpar
        // pares frente a frente dos dois lados do mesão; trios abrem coluna
        const to: Vec2 = {
          x: table.x + (i % 2 === 0 ? -0.9 : 0.9),
          y: table.y + Math.floor(i / 2),
        }
        const trip = api.beginTrip({
          deskId,
          priority: WAR_PRIORITY,
          startStates: ACTIVE_STATES,
          keepStates: ACTIVE_STATES,
          to,
          pauseS: Number.POSITIVE_INFINITY, // volta quando a war sumir
          onArrive(t) {
            const stay = byDesk.get(deskId)
            if (!stay || stay.returning) return
            // balões de pensamento na cor do agent, sobre a cabeça do walker
            const dots = createThoughtDots(api.deskInfo(deskId)?.color ?? 0xffffff)
            dots.root.position.set(24, -88)
            t.walker.root.addChild(dots.root)
            stay.dots = dots
          },
          onDone: () => byDesk.delete(deskId),
          onAbort: () => byDesk.delete(deskId),
        })
        if (trip) {
          byDesk.set(deskId, {
            trip,
            returning: false,
            phase: (hashSeed(deskId) % 997) / 100,
          })
        }
      }
    }
  }

  // --- bastão de revezamento ------------------------------------------------
  const syncBatons = (s: OfficeSnapshot, api: BehaviorApi): void => {
    for (const b of s.batons ?? []) {
      const key = `b|${b.fromDeskId}|${b.toDeskId}|${b.at}`
      if (seen.has(key)) continue
      const to = api.deskAnchor(b.toDeskId)
      if (!api.deskInfo(b.fromDeskId) || !to) {
        seen.set(key, b.at) // sem como atender — não retenta
        continue
      }
      const trip = api.beginTrip({
        deskId: b.fromDeskId,
        priority: BEHAVIOR_PRIORITY.baton,
        to,
        carrying: "doc",
        pauseS: BATON_PAUSE_S,
        onArrive(t) {
          t.setCarrying(null) // bastão entregue
        },
      })
      // negado ⇒ NÃO marca visto: retenta no próximo snapshot (TTL limita)
      if (trip) seen.set(key, b.at)
    }
  }

  // --- comemoração ----------------------------------------------------------
  const syncCelebrations = (s: OfficeSnapshot, api: BehaviorApi): void => {
    for (const c of s.celebrations ?? []) {
      const key = `c|${c.projectId}|${c.at}`
      if (seen.has(key)) continue
      seen.set(key, c.at) // momento único: comemora agora ou não comemora
      const room = s.rooms.find((r) => r.projectId === c.projectId)
      if (!room) continue
      for (const desk of room.desks) {
        const anchor = api.deskAnchor(desk.id)
        if (!anchor) continue
        const trip = api.beginTrip({
          deskId: desk.id,
          priority: CELEBRATE_PRIORITY,
          idle: true, // quem segue trabalhando não levanta pra pular
          to: anchor, // levanta e pula NA FRENTE da própria mesa
          pauseS: CELEBRATE_JUMP_S,
          onArrive(t) {
            const confetti = createConfetti(hashSeed(`${desk.id}|confetti`))
            confetti.root.position.set(0, -95) // acima da cabeça (local do rig)
            t.walker.root.addChild(confetti.root)
            confetti.burstAt(0, 0, api.time)
            jumps.push({
              deskId: desk.id,
              trip: t,
              baseY: t.walker.root.position.y,
              startedAt: api.time,
              confetti,
            })
          },
          onDone: () => dropJump(desk.id),
          onAbort: () => dropJump(desk.id),
        })
        void trip // negada (cap/ocupada): a sala comemora com quem deu
      }
    }
  }

  const dropJump = (deskId: string): void => {
    const i = jumps.findIndex((j) => j.deskId === deskId)
    if (i >= 0) jumps.splice(i, 1)
  }

  // --- entrega na mesa do Boss ----------------------------------------------
  const syncBossDeliveries = (s: OfficeSnapshot, api: BehaviorApi): void => {
    for (const d of s.bossDeliveries ?? []) {
      const key = `d|${d.deskId}|${d.convId}|${d.at}`
      if (seen.has(key)) continue
      const to = api.targets.bossDesk
      if (!api.deskInfo(d.deskId) || !to) {
        seen.set(key, d.at) // sem mesa do boss/planta de teste: não retenta
        continue
      }
      const trip = api.beginTrip({
        deskId: d.deskId,
        priority: BEHAVIOR_PRIORITY.handoff, // mesma classe do handoff (70)
        to,
        carrying: "doc",
        pauseS: BOSS_DROP_PAUSE_S,
        onArrive(t) {
          t.setCarrying(null) // papel DEIXADO na mesa do Boss
          emitBossDeskDrop() // ui bumpa unseenDeliveries (pilha é da ambiente)
        },
      })
      if (trip) seen.set(key, d.at)
    }
  }

  return {
    id: "mission",

    onSnapshot(s, api) {
      purgeSeen()
      if (api.reducedMotion) return // nenhum walker, nenhum confete
      // ordem por prioridade DESC: os grandes reservam o cap primeiro (sem
      // spawn-e-derruba desnecessário dos menores)
      syncGateVisit(s, api) //     75 — evento nº1: a decisão vem primeiro
      syncBossDeliveries(s, api) // 70
      syncReviewerVisits(s, api) // 50
      syncWars(s, api) //          40
      syncKickoffs(s, api) //      40
      syncBatons(s, api) //        30
      syncCelebrations(s, api) //  22
    },

    onTick(_dtSec, api) {
      if (api.reducedMotion) return
      const time = api.time
      // balões de pensamento da guerra (mesmo tick dos efeitos do stage)
      for (const byDesk of wars.values()) {
        for (const stay of byDesk.values()) {
          stay.dots?.tick(time, stay.phase, false)
        }
      }
      // pulinhos: bob transform-only por cima da posição parada do walker
      for (const j of jumps) {
        const t = time - j.startedAt
        j.trip.walker.root.position.y =
          j.baseY - JUMP_H * Math.abs(Math.sin((t * Math.PI) / HOP_S))
        j.confetti.update(time, false)
      }
    },
  }
}
