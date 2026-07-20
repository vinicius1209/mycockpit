// Derivação DISCRETA da atividade real → snapshot da cena (docs/agent-office.md
// §4). Fonte: stores zustand (useChat/useMission/useApp/useInteractions — a
// fila de interações pendentes é a do store, fonte ÚNICA compartilhada com o
// InteractionHost). Nada aqui roda por frame: startDeriving assina os stores
// com coalescing ≤10Hz (trailing edge) e dedupe por igualdade estrutural — a
// cena só recebe TRANSIÇÕES.
//
// Camadas: bridge/ importa engine/types + stores/lib do app. NUNCA engine/sim,
// scene/ ou ui/.

import {
  OFFICE_AGENTS,
  roomAggregate,
  type DeskSnapshot,
  type DeskVisualState,
  type OfficeAgentId,
  type OfficeSnapshot,
  type RoomSnapshot,
} from "@/office/engine/types"
import { availability } from "@/lib/agents"
import { loadLedger } from "@/lib/db"
import type { ApprovalData } from "@/lib/interaction"
import type { MissionPersona, MissionRun } from "@/lib/missionTypes"
import { useApp } from "@/store/app"
import { useChat, type ChatItem } from "@/store/chat"
import { useInteractions } from "@/store/interactions"
import { useMission } from "@/store/mission"

/** Janela de "output recente": houve text_delta/tool há ≤2.5s ⇒ digitando. */
const TYPING_WINDOW_MS = 2500
/** Balão de entrega fica vivo por 15s. */
const DELIVERY_TTL_MS = 15_000
/** Coalescing do espelho de UI: no máximo ~10 snapshots/s (trailing edge). */
const COALESCE_MS = 100
/** Re-derive periódico p/ decaimentos (typing→thinking, expirar balões). */
const TICK_MS = 1000
/** Re-agregação do ledger de custo (query async, cacheada). */
const LEDGER_REFRESH_MS = 60_000

const PERSONA_LABEL: Record<MissionPersona, string> = {
  planner: "Planejando",
  executor: "Executando",
  reviewer: "Revisando",
}

/** hand > typing > thinking > (idle|off): um estado só sobe, nunca desce. */
const RANK: Record<DeskVisualState, number> = {
  off: 0,
  idle: 0,
  thinking: 1,
  typing: 2,
  hand: 3,
}

// ---------------------------------------------------------------------------
// Estado de módulo (memória entre derives — o snapshot em si é derivado)
// ---------------------------------------------------------------------------

type ActivityMark = { sig: string; at: number }
/** Última assinatura de atividade por fonte (convId linear / convId#mN missão)
 *  + quando ela mudou. É a heurística de typing: não interceptamos handleEvent,
 *  então "output recente" = "o último item da conversa mudou há ≤2.5s". */
const activity = new Map<string, ActivityMark>()
/** Convs que JÁ vimos rodando: só elas geram balão de entrega quando o turno
 *  termina (senão um result histórico viraria balão no primeiro derive). */
const wasRunning = new Set<string>()
/** Balões de entrega vivos (expiram em 15s). */
let deliveries: OfficeSnapshot["deliveries"] = []
/** Cache do ledger de custo agregado por projectId (query async). */
let ledgerByProject: Record<string, number> = {}

// Interações pendentes: SEM cópia local — a fila é a do useInteractions
// (fonte única; responder/resolver remove lá e o derive só lê).

/** (testes) zera toda a memória entre derives. */
export function _resetDeriveState(): void {
  activity.clear()
  wasRunning.clear()
  deliveries = []
  ledgerByProject = {}
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

type ChatStateSnapshot = ReturnType<typeof useChat.getState>

/** Agent do registry que tem mesa no office (ids fora do trio → sem mesa). */
function officeAgent(agent: string): OfficeAgentId | null {
  return (OFFICE_AGENTS as string[]).includes(agent)
    ? (agent as OfficeAgentId)
    : null
}

/** Projeto dono de uma conversa: byId primeiro, senão as metas por projeto. */
function projectOfConv(
  chat: ChatStateSnapshot,
  convId: string,
): string | undefined {
  const c = chat.byId[convId]
  if (c) return c.projectId
  for (const [pid, list] of Object.entries(chat.conversationsByProject)) {
    if (list.some((m) => m.id === convId)) return pid
  }
  return undefined
}

/** Assinatura leve do "andamento" de uma lista de itens: muda quando chega
 *  delta/tool/result — é o que a heurística de typing observa. */
function itemsSignature(items: ChatItem[]): string {
  const last = items[items.length - 1]
  if (!last) return "0"
  const extra =
    last.kind === "text"
      ? String(last.text.length)
      : last.kind === "tool"
        ? `${last.name}:${last.result ? 1 : 0}`
        : ""
  return `${items.length}:${last.id}:${last.kind}:${extra}`
}

/** typing vs thinking de um turno em andamento, pela memória de atividade. */
function liveState(
  key: string,
  items: ChatItem[],
  now: number,
): { state: "typing" | "thinking"; detail?: string } {
  const sig = itemsSignature(items)
  const prev = activity.get(key)
  if (!prev || prev.sig !== sig) activity.set(key, { sig, at: now })
  const at = activity.get(key)!.at
  const last = items[items.length - 1]
  // "output recente" só conta se o fio está de fato produzindo (texto/tool);
  // último item user/result/notice = silêncio do modelo ⇒ pensando.
  const producing = last && (last.kind === "text" || last.kind === "tool")
  if (producing && now - at <= TYPING_WINDOW_MS) {
    return {
      state: "typing",
      detail: last.kind === "tool" ? last.name : undefined,
    }
  }
  return { state: "thinking" }
}

/** Resumo curto pt-BR de um result (balão de entrega). */
function shortResult(text: string | undefined, ok: boolean): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim()
  if (!t) return ok ? "Turno concluído" : "Turno terminou com falha"
  return t.length > 80 ? `${t.slice(0, 80)}…` : t
}

/** Sobe o estado da mesa (nunca rebaixa; empate mantém o primeiro — gate de
 *  missão é aplicado antes de approval e vence). */
function upgrade(
  desk: DeskSnapshot,
  patch: Pick<DeskSnapshot, "state" | "label"> & Partial<DeskSnapshot>,
): void {
  if (RANK[patch.state] <= RANK[desk.state]) return
  desk.state = patch.state
  desk.label = patch.label
  desk.detail = patch.detail
  desk.convId = patch.convId
  desk.hand = patch.hand
}

// agregado da sala: fonte única em engine/types.roomAggregate (compartilhada
// com a fixture sim-data — mesma régua no Tauri e no browser)

/** Fase de uma missão apontada por um run_id `missionId::phase-N` (o formato
 *  do phaseRunId do store); null = sufixo em outro formato. */
function phaseIndexFromRunId(run: MissionRun, runId: string): number | null {
  const suffix = runId.slice(run.id.length + 2)
  const m = /^phase-(\d+)$/.exec(suffix)
  return m ? Number(m[1]) : null
}

// ---------------------------------------------------------------------------
// A derivação
// ---------------------------------------------------------------------------

/** Fotografa a atividade real dos stores num OfficeSnapshot. Determinística
 *  dado (stores + memória de atividade + relógio); `now` é injetável p/ teste. */
export function deriveOfficeSnapshot(now: number = Date.now()): OfficeSnapshot {
  const chat = useChat.getState()
  const missions = useMission.getState()
  const app = useApp.getState()
  const detected = app.settings.detected

  // 1) Base: uma sala por projeto, 3 mesas; CLI não detectado ⇒ mesa apagada.
  //    (Fonte da detecção: settings.detected — snapshot de detect_agents/
  //    toProbeMap gravado no boot do App e no "Verificar agora" das Settings.)
  const deskByKey = new Map<string, DeskSnapshot>()
  const roomsBase = app.projects.map((p) => {
    const desks = OFFICE_AGENTS.map((agent): DeskSnapshot => {
      const avail = availability(agent, detected)
      const off = avail === "missing" || avail === "not-integrated"
      const desk: DeskSnapshot = {
        id: `${p.id}::${agent}`,
        projectId: p.id,
        agent,
        state: off ? "off" : "idle",
        label: off ? "Não detectado" : "Disponível",
      }
      deskByKey.set(desk.id, desk)
      return desk
    })
    return { project: p, desks }
  })

  // 2) Missões: a fase corrente acende a mesa do agent da fase (label da
  //    persona); gate humano ⇒ mão levantada na mesa da fase do gate.
  for (const [convId, run] of Object.entries(missions.byConv)) {
    const projectId = projectOfConv(chat, convId)
    if (!projectId) continue
    if (run.gate) {
      const phase = run.phases[run.gate.phase]
      const agent = phase ? officeAgent(phase.def.agent) : null
      if (agent) {
        const desk = deskByKey.get(`${projectId}::${agent}`)
        if (desk) {
          upgrade(desk, {
            state: "hand",
            hand: "gate",
            label: "Precisa de você",
            detail: PERSONA_LABEL[phase.def.persona],
            convId,
          })
        }
      }
      continue
    }
    if (run.status !== "running") continue
    const phase = run.phases[run.current]
    const agent = phase ? officeAgent(phase.def.agent) : null
    if (!phase || !agent) continue
    const desk = deskByKey.get(`${projectId}::${agent}`)
    if (!desk) continue
    const live = liveState(`${convId}#m${run.current}`, phase.items ?? [], now)
    upgrade(desk, {
      state: live.state,
      label: PERSONA_LABEL[phase.def.persona],
      detail: live.detail ?? phase.def.label,
      convId,
    })
  }

  // 3) Turnos lineares: conversa running ⇒ typing (output ≤2.5s) ou thinking.
  for (const [convId, c] of Object.entries(chat.byId)) {
    if (!c.running) continue
    wasRunning.add(convId)
    const agent = officeAgent(c.agent)
    if (!agent) continue
    const desk = deskByKey.get(`${c.projectId}::${agent}`)
    if (!desk) continue
    const live = liveState(convId, c.items, now)
    upgrade(desk, {
      state: live.state,
      label: live.state === "typing" ? "Digitando" : "Pensando",
      detail: live.detail,
      convId,
    })
  }

  // 4) Fim de turno linear ⇒ balão curto de entrega (só p/ convs que vimos
  //    rodando — um result histórico não vira balão no primeiro derive).
  for (const convId of [...wasRunning]) {
    const c = chat.byId[convId]
    if (!c) {
      wasRunning.delete(convId)
      continue
    }
    if (c.running) continue
    wasRunning.delete(convId)
    const terminal = [...c.items]
      .reverse()
      .find(
        (it) =>
          it.kind === "result" ||
          it.kind === "error" ||
          it.kind === "cancelled",
      )
    if (!terminal || terminal.kind !== "result") continue
    const agent = officeAgent(c.agent)
    if (!agent) continue
    deliveries.push({
      deskId: `${c.projectId}::${agent}`,
      text: shortResult(terminal.text, terminal.ok),
      at: now,
    })
  }
  deliveries = deliveries.filter((d) => now - d.at <= DELIVERY_TTL_MS)

  // 5) Approvals pendentes (fila do useInteractions) mapeáveis ⇒ mão levantada.
  //    question NÃO tem run_id no payload ⇒ sem mesa (o host global cobre).
  //    Responder pelo card remove da fila NA HORA ⇒ a mão abaixa no mesmo
  //    derive (o backend não emite resolved pra respostas do usuário).
  for (const req of useInteractions.getState().queue) {
    if (req.kind !== "approval") continue
    const data = req.data as Partial<ApprovalData> | null | undefined
    const runId = typeof data?.run_id === "string" ? data.run_id : null
    if (!runId) continue

    let target: { projectId: string; agent: OfficeAgentId; convId: string } | null =
      null
    // 5a) turno linear: run_id É o runId corrente da conversa (turno pausado).
    for (const [convId, c] of Object.entries(chat.byId)) {
      if (c.runId !== runId) continue
      const agent = officeAgent(c.agent)
      if (agent) target = { projectId: c.projectId, agent, convId }
      break
    }
    // 5b) missão: prefixo `missionId::` casa com byConv; a fase vem do sufixo
    //     `phase-N` (fallback: fase corrente).
    if (!target) {
      for (const [convId, run] of Object.entries(missions.byConv)) {
        if (!runId.startsWith(`${run.id}::`)) continue
        const idx = phaseIndexFromRunId(run, runId) ?? run.current
        const phase = run.phases[idx] ?? run.phases[run.current]
        const agent = phase ? officeAgent(phase.def.agent) : null
        const projectId = projectOfConv(chat, convId)
        if (agent && projectId) target = { projectId, agent, convId }
        break
      }
    }
    if (!target) continue
    const desk = deskByKey.get(`${target.projectId}::${target.agent}`)
    if (!desk) continue
    upgrade(desk, {
      state: "hand",
      hand: "approval",
      label: "Aguardando aprovação",
      detail: data?.command || data?.tool_name || undefined,
      convId: target.convId,
    })
  }

  // 6) Custo por sala: ledger agregado (cache async) + missões EM VOO (o custo
  //    delas só entra no ledger via deliveries quando terminam).
  const missionCost: Record<string, number> = {}
  for (const [convId, run] of Object.entries(missions.byConv)) {
    if (run.status !== "running") continue
    const pid = projectOfConv(chat, convId)
    if (pid) missionCost[pid] = (missionCost[pid] ?? 0) + run.costTotal
  }

  const rooms: RoomSnapshot[] = roomsBase.map(({ project, desks }) => ({
    projectId: project.id,
    name: project.name,
    color: project.color ?? undefined,
    agg: roomAggregate(desks),
    costUsd:
      (ledgerByProject[project.id] ?? 0) + (missionCost[project.id] ?? 0),
    desks,
  }))

  return { rooms, deliveries: [...deliveries] }
}

/** Recarrega o cache de custo por projeto (ledger unificado: turn_costs +
 *  deliveries + stage_runs, desde sempre = custo ACUMULADO do projeto). */
async function refreshLedger(): Promise<void> {
  try {
    const entries = await loadLedger(0)
    const agg: Record<string, number> = {}
    for (const e of entries) {
      agg[e.projectId] = (agg[e.projectId] ?? 0) + (e.costUsd ?? 0)
    }
    ledgerByProject = agg
  } catch {
    // best-effort: mantém o cache anterior
  }
}

/** Assina os stores (incluindo a fila de interações) e entrega snapshots ao
 *  `cb` com coalescing ≤10Hz (trailing edge) e dedupe estrutural (JSON):
 *  transições discretas, nunca por frame. Retorna o unsubscribe. */
export function startDeriving(cb: (s: OfficeSnapshot) => void): () => void {
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastJson = ""

  const emit = () => {
    if (disposed) return
    const snap = deriveOfficeSnapshot()
    const json = JSON.stringify(snap)
    if (json === lastJson) return // dedupe: nada mudou de verdade
    lastJson = json
    cb(snap)
  }

  // Trailing edge: a 1ª mudança do burst agenda; as demais coalescem no timer.
  const schedule = () => {
    if (disposed || timer) return
    timer = setTimeout(() => {
      timer = null
      emit()
    }, COALESCE_MS)
  }

  // useInteractions entra na lista: a fila é alimentada no import do store
  // (App.tsx importa no boot), então approvals de ANTES da 1ª visita ao
  // office já estão nela — nenhum listener próprio aqui.
  const unsubs = [
    useChat.subscribe(schedule),
    useMission.subscribe(schedule),
    useApp.subscribe(schedule),
    useInteractions.subscribe(schedule),
  ]

  // Decaimentos precisam de relógio (typing→thinking após 2.5s de silêncio,
  // balões expirando aos 15s): re-derive periódico barato — o dedupe engole
  // os ticks sem transição.
  const ticker = setInterval(schedule, TICK_MS)

  // Custo: o ledger é async — carrega já e re-agrega de tempos em tempos.
  const refresh = () => {
    void refreshLedger().then(schedule)
  }
  refresh()
  const ledgerTimer = setInterval(refresh, LEDGER_REFRESH_MS)

  emit() // primeira foto imediata (o resto chega no trailing edge)

  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
    clearInterval(ticker)
    clearInterval(ledgerTimer)
    for (const u of unsubs) u()
  }
}
