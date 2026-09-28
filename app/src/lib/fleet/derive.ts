// Derivação discreta da atividade real → snapshot da cena (docs/agent-office.md
// §4). Lê os stores (useChat, useMission, useApp, useInteractions); nada roda
// por frame: startDeriving coalesce em ≤10Hz com dedupe estrutural, e desligado
// (setActive) não deriva, senão cada tecla no chat pagaria um derive inútil.
// Camadas: importa stores e lib do app, nunca engine, scene ou ui.

import { retomadaAgendada } from "@/lib/autoResume"
import {
  OFFICE_AGENTS,
  roomAggregate,
  type DeskSnapshot,
  type DeskVisualState,
  type OfficeAgentId,
  type OfficeSnapshot,
  type RoomMission,
  type RoomSnapshot,
} from "@/lib/fleet/types"
import { perfSpan } from "@/lib/fleet/perf"
import { availability, type Availability } from "@/lib/agents"
import { loadLedger } from "@/lib/db"
import { aggregateLedgerByProject } from "@/lib/fleet/ledgerAgg"
import type { ApprovalData } from "@/lib/interaction"
import type { MissionPersona, MissionRun } from "@/lib/missionTypes"
import { formatResetBrief } from "@/lib/resetHint"
import { useApp } from "@/store/app"
import { useChat, hasExecutorTurn, type ChatItem } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { convIdForInteraction, useInteractions } from "@/store/interactions"
import { useMission } from "@/store/mission"
import { usePresets } from "@/store/presets"

/** Janela de "output recente": houve text_delta/tool há ≤2.5s ⇒ digitando. */
const TYPING_WINDOW_MS = 2500
/** Balão de entrega fica vivo por 15s. */
const DELIVERY_TTL_MS = 15_000
/** Handoff físico fica vivo por 20s (a cena deduplica por from::to::at). */
const HANDOFF_TTL_MS = 20_000
/** Kickoff de missão (reunião nas mesas das fases) fica vivo por 25s. */
const KICKOFF_TTL_MS = 25_000
/** Celebração de missão done fica viva por 12s. */
const CELEBRATION_TTL_MS = 12_000
/** Bastão de revezamento (agent da conv mudou) fica vivo por 20s. */
const BATON_TTL_MS = 20_000
/** Chegada (mesa off → disponível) fica viva por 25s. */
const ARRIVAL_TTL_MS = 25_000
/** Entrega ao Boss (courier até a mesa executiva) fica viva por 30s. */
const BOSS_DELIVERY_TTL_MS = 30_000
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
/** Fase corrente vista no ÚLTIMO derive, por convId de missão — é a memória
 *  que permite detectar a TRANSIÇÃO (i done → i+1 running) e não re-emitir. */
const missionPhaseSeen = new Map<string, number>()
/** Handoffs físicos vivos (expiram em 20s). */
let handoffs: NonNullable<OfficeSnapshot["handoffs"]> = []
/** Último status de missão visto por convId — memória das transições
 *  ausente/queued→running (kickoff) e →done (celebração). */
const missionStatusSeen = new Map<string, MissionRun["status"]>()
/** Último agent visto por conv COM items (bastão: agent MUDOU entre derives). */
const lastAgentByConv = new Map<string, string>()
/** Última condição "off" vista por mesa (arrival: off → disponível). */
const lastOffByDesk = new Map<string, boolean>()
/** Kickoffs vivos (expiram em 25s). */
let kickoffs: NonNullable<OfficeSnapshot["kickoffs"]> = []
/** Celebrações vivas (expiram em 12s). */
let celebrations: NonNullable<OfficeSnapshot["celebrations"]> = []
/** Bastões de revezamento vivos (expiram em 20s). */
let batons: NonNullable<OfficeSnapshot["batons"]> = []
/** Chegadas vivas (expiram em 25s). */
let arrivals: NonNullable<OfficeSnapshot["arrivals"]> = []
/** Entregas ao Boss vivas (expiram em 30s). */
let bossDeliveries: NonNullable<OfficeSnapshot["bossDeliveries"]> = []
/** Cache do ledger por projectId (query async): custo, e — à parte, nunca 0
 *  (ADR-047) — o sem preço. */
let ledgerCache: {
  byProject: Record<string, number>
  unpriced: Record<string, { turns: number; tokens: number }>
} = { byProject: {}, unpriced: {} }

// Interações pendentes: SEM cópia local — a fila é a do useInteractions
// (fonte única; responder/resolver remove lá e o derive só lê).

/** (testes) zera toda a memória entre derives. */
export function _resetDeriveState(): void {
  activity.clear()
  wasRunning.clear()
  deliveries = []
  missionPhaseSeen.clear()
  handoffs = []
  missionStatusSeen.clear()
  lastAgentByConv.clear()
  lastOffByDesk.clear()
  kickoffs = []
  celebrations = []
  batons = []
  arrivals = []
  bossDeliveries = []
  ledgerCache = { byProject: {}, unpriced: {} }
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

/** Estado-base da mesa antes de qualquer atividade: binário presente não é
 *  prontidão. CLI deslogada e rate limit apagam a mesa com o motivo; auth
 *  incerta (inclui o agy, sem comando de auth) segue usável. Pura. */
export function deskBaseState(
  avail: Availability,
  limited: boolean,
  resetHint: string | null,
): Pick<DeskSnapshot, "state" | "label" | "detail"> {
  // switch EXAUSTIVO (F-C): membro novo de Availability quebra no tsc via o
  // check `never` abaixo, em vez de cair em "Disponível" por omissão.
  switch (avail) {
    case "missing":
    case "not-integrated":
      return { state: "off", label: "Não detectado" }
    case "installed-not-authenticated":
      return { state: "off", label: "Instalado, sem login" }
    case "ready":
    case "installed-auth-unknown":
      if (limited) {
        return {
          state: "off", label: RATE_LIMIT_LABEL,
          detail: formatResetBrief(resetHint) ?? undefined,
        }
      }
      return { state: "idle", label: "Disponível" }
    default: {
      const exhaustive: never = avail
      return exhaustive
    }
  }
}

/** Nome atual do preset, resolvido no render (renomear atualiza a mesa). Sem o
 *  preset no store, cai no carimbo `presetName`, o último nome conhecido. */
function currentPresetName(
  presetId: string | null | undefined,
  stamped: string | null | undefined,
): string | null {
  if (!presetId) return stamped ?? null
  const preset = usePresets.getState().list.find((p) => p.id === presetId)
  return preset?.name ?? stamped ?? null
}

/** S3.5 — rótulo da mesa num turno linear sob persona: generaliza o
 *  "persona na label" que as fases de missão já usam (PERSONA_LABEL). Puro. */
export function linearDeskLabel(
  state: "typing" | "thinking",
  presetName: string | null | undefined,
): string {
  const base = state === "typing" ? "Digitando" : "Pensando"
  return presetName ? `${base} como ${presetName}` : base
}

/** Label da mesa em rate limit — fonte ÚNICA da string (N2): deskBaseState
 *  produz, offInstruction e o DeskMenu comparam via isRateLimitLabel. Renomear
 *  a copy quebra em UM lugar só. */
const RATE_LIMIT_LABEL = "Em rate limit"

/** A mesa está apagada por rate limit? (sinal semântico pro DeskMenu, em vez
 *  de comparar a string de copy espalhada). */
export function isRateLimitLabel(label: string | null | undefined): boolean {
  return label === RATE_LIMIT_LABEL
}

/** Instrução por motivo de mesa apagada, colada aos labels de deskBaseState
 *  para não divergirem: "Verifique nos Ajustes" só vale para binário ausente;
 *  login é no terminal; rate limit é esperar a janela. */
export function offInstruction(label: string): string {
  if (label === "Instalado, sem login") return "Faça login pelo terminal da CLI."
  if (isRateLimitLabel(label)) return "Aguarde a janela liberar."
  return "Verifique nos Ajustes."
}

// agregado da sala: fonte única em engine/types.roomAggregate (compartilhada
// com a fixture sim-data — mesma régua no Tauri e no browser)

// run_id → conversa: fonte única em store/interactions. A mesa usa o recorte
// só de approval (a mão da mesa é de aprovação); cards e sidebar usam a mesma
// régua sem filtro de kind.

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

  // 1) Base: uma sala por projeto, 3 mesas. CLI ausente, deslogado ou em rate
  //    limit apaga a mesa com o motivo; turno rodando ainda sobe o estado
  //    (estado real vence rótulo). Detecção: settings.detected; rate limit:
  //    app.limitedAgents.
  const limitedAgents = app.limitedAgents
  const deskByKey = new Map<string, DeskSnapshot>()
  const roomsBase = app.projects.map((p) => {
    const desks = OFFICE_AGENTS.map((agent): DeskSnapshot => {
      const avail = availability(agent, detected)
      const base = deskBaseState(
        avail,
        agent in limitedAgents,
        limitedAgents[agent] ?? null,
      )
      const off = base.state === "off"
      const desk: DeskSnapshot = {
        id: `${p.id}::${agent}`,
        projectId: p.id,
        agent,
        state: base.state,
        label: base.label,
        detail: base.detail,
      }
      // Chegada: a mesa estava "off" e voltou a ser usável, e o avatar entra
      // pela porta. O primeiro derive só memoriza.
      const prevOff = lastOffByDesk.get(desk.id)
      if (prevOff === true && !off) arrivals.push({ deskId: desk.id, at: now })
      lastOffByDesk.set(desk.id, off)
      deskByKey.set(desk.id, desk)
      return desk
    })
    return { project: p, desks }
  })

  // 2) Missões: a fase corrente acende a mesa do agent da fase (label da
  //    persona); gate humano ⇒ mão levantada na mesa da fase do gate.
  //    De quebra: kanban por projeto (whiteboard), kickoff e celebração.
  const missionByProject = new Map<string, MissionRun>()
  for (const [convId, run] of Object.entries(missions.byConv)) {
    const projectId = projectOfConv(chat, convId)
    if (!projectId) continue
    // Kanban do whiteboard: UMA missão por sala — rodando vence; entre iguais,
    // a mais recente (startedAt). O quadro persiste depois de done.
    const kanban = missionByProject.get(projectId)
    const runActive = run.status === "running"
    if (
      !kanban ||
      (runActive && kanban.status !== "running") ||
      (runActive === (kanban.status === "running") &&
        run.startedAt > kanban.startedAt)
    ) {
      missionByProject.set(projectId, run)
    }
    // Kickoff: ausente/queued → running (memória por convId; inclui o 1º
    // avistamento já running — a missão está de fato decolando). Celebração:
    // transição REAL → done (missão já done no 1º derive é histórica).
    const statusSeen = missionStatusSeen.get(convId)
    if (runActive && statusSeen !== "running") {
      const deskIds = [
        ...new Set(
          run.phases
            .map((ph) => officeAgent(ph.def.agent))
            .filter((a): a is OfficeAgentId => a !== null)
            .map((a) => `${projectId}::${a}`),
        ),
      ]
      if (deskIds.length > 0) kickoffs.push({ projectId, deskIds, at: now })
    }
    if (
      run.status === "done" &&
      statusSeen !== undefined &&
      statusSeen !== "done"
    ) {
      celebrations.push({ projectId, at: now })
    }
    missionStatusSeen.set(convId, run.status)
    // Handoff físico: a fase avançou, a anterior está done e o agent mudou, então
    // courier mesa→mesa. O primeiro derive só memoriza.
    const seen = missionPhaseSeen.get(convId)
    if (seen !== undefined && run.current > seen) {
      // origem = a fase IMEDIATAMENTE anterior à corrente (não a última vista):
      // se um coalesce de 100ms engoliu mais de uma transição, o courier deve
      // partir da mesa de quem acabou de entregar, não de fases atrás.
      const fromDef = run.phases[run.current - 1]
      const toDef = run.phases[run.current]
      const fromAgent = fromDef ? officeAgent(fromDef.def.agent) : null
      const toAgent = toDef ? officeAgent(toDef.def.agent) : null
      if (
        fromAgent &&
        toAgent &&
        fromAgent !== toAgent &&
        fromDef.status === "done"
      ) {
        handoffs.push({
          fromDeskId: `${projectId}::${fromAgent}`,
          toDeskId: `${projectId}::${toAgent}`,
          at: now,
        })
      }
    }
    missionPhaseSeen.set(convId, run.current)
    if (run.gate) {
      const phase = run.phases[run.gate.phase]
      const agent = phase ? officeAgent(phase.def.agent) : null
      if (agent) {
        const desk = deskByKey.get(`${projectId}::${agent}`)
        if (desk) {
          desk.persona = phase.def.persona // a mesa hospeda a fase do gate
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
    desk.persona = phase.def.persona // metadado ortogonal ao rank de estado
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
      // S3.5: conversa sob preset → "Digitando como {preset.name}" (o persona-
      // na-label das missões, generalizado pra personas de conversa). O nome
      // vem do store de presets no render (rename atualiza a label).
      label: linearDeskLabel(
        live.state,
        currentPresetName(c.presetId, c.presetName),
      ),
      // turno mudo (watchdog marcou): a mesa conta há quanto tempo (de graça).
      detail:
        live.detail ??
        (c.stalledSince != null
          ? `mudo há ${Math.max(1, Math.round((now - c.stalledSince) / 60_000))}min`
          : undefined),
      convId,
    })
  }

  // 3b) Revezamento: agent mudou numa conversa com itens → bastão mesa→mesa
  //     (conversa vazia não memoriza). Auto-resume agendado → a mesa descansa
  //     até nextAt.
  for (const [convId, c] of Object.entries(chat.byId)) {
    // conv só com pareceres de conselheiro (advice) não é "trabalho" de executor
    // → não memoriza agent nem gera bastão espúrio (Especialistas E1).
    if (hasExecutorTurn(c.items)) {
      const prevAgent = lastAgentByConv.get(convId)
      if (prevAgent !== undefined && prevAgent !== c.agent) {
        const from = officeAgent(prevAgent)
        const to = officeAgent(c.agent)
        if (from && to && from !== to) {
          batons.push({
            fromDeskId: `${c.projectId}::${from}`,
            toDeskId: `${c.projectId}::${to}`,
            at: now,
          })
        }
      }
      lastAgentByConv.set(convId, c.agent)
    }
    // Só descansa ESPERANDO o horário: depois do disparo a mesa trabalha.
    const mesa = retomadaAgendada(c) ? deskByKey.get(`${c.projectId}::${officeAgent(c.agent)}`) : undefined
    if (mesa && c.autoResume) mesa.restUntil = c.autoResume.nextAt
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
      convId,
      text: shortResult(terminal.text, terminal.ok),
      at: now,
    })
    // Mesmo gatilho, outro palco: o courier leva o documento até o Boss.
    bossDeliveries.push({ deskId: `${c.projectId}::${agent}`, convId, at: now })
  }
  deliveries = deliveries.filter((d) => now - d.at <= DELIVERY_TTL_MS)
  handoffs = handoffs.filter((h) => now - h.at <= HANDOFF_TTL_MS)
  kickoffs = kickoffs.filter((k) => now - k.at <= KICKOFF_TTL_MS)
  celebrations = celebrations.filter((c) => now - c.at <= CELEBRATION_TTL_MS)
  batons = batons.filter((b) => now - b.at <= BATON_TTL_MS)
  arrivals = arrivals.filter((a) => now - a.at <= ARRIVAL_TTL_MS)
  bossDeliveries = bossDeliveries.filter(
    (d) => now - d.at <= BOSS_DELIVERY_TTL_MS,
  )
  for (const convId of [...missionPhaseSeen.keys()]) {
    if (!missions.byConv[convId]) missionPhaseSeen.delete(convId)
  }
  for (const convId of [...missionStatusSeen.keys()]) {
    if (!missions.byConv[convId]) missionStatusSeen.delete(convId)
  }
  for (const convId of [...lastAgentByConv.keys()]) {
    if (!chat.byId[convId]) lastAgentByConv.delete(convId)
  }
  for (const deskId of [...lastOffByDesk.keys()]) {
    if (!deskByKey.has(deskId)) lastOffByDesk.delete(deskId)
  }

  // 5) Approval pendente mapeável → mão levantada. Só approval: a mesa só sabe
  //    dizer "Aguardando aprovação", e levantar a mão por uma pergunta mentiria
  //    sobre o pedido. Responder pelo card tira da fila na hora, e a mão abaixa
  //    no mesmo derive.
  for (const req of useInteractions.getState().queue) {
    // dono do pedido: recorte approval-only (question / sem run_id ⇒ null).
    const home = convIdForInteraction(req, chat, missions)
    if (!home) continue
    const data = req.data as Partial<ApprovalData> | null | undefined

    let target: { projectId: string; agent: OfficeAgentId; convId: string } | null =
      null
    if (home.kind === "linear") {
      // 5a) turno linear: run_id É o runId corrente da conversa (turno pausado).
      const c = chat.byId[home.convId]
      const agent = c ? officeAgent(c.agent) : null
      if (agent) target = { projectId: c.projectId, agent, convId: home.convId }
    } else {
      // 5b) missão: a fase resolvida veio do helper (sufixo `phase-N`,
      //     fallback: fase corrente); null = irresolvível ⇒ sem mesa.
      const run = missions.byConv[home.convId]
      const phase = home.phase != null ? run?.phases[home.phase] : undefined
      const agent = phase ? officeAgent(phase.def.agent) : null
      const projectId = projectOfConv(chat, home.convId)
      if (agent && projectId) target = { projectId, agent, convId: home.convId }
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

  // 7) Guerra (Fusion): disputa ativa numa conv do projeto ⇒ mesas dos agents
  //    candidatos mapeáveis; nenhum mapeável ⇒ as 3 mesas da sala.
  const warByProject = new Map<string, { deskIds: string[] }>()
  for (const [convId, fus] of Object.entries(useFusion.getState().byConv)) {
    if (
      fus.phase === "configuring" ||
      fus.phase === "done" ||
      fus.phase === "aborted"
    ) {
      continue
    }
    const pid = projectOfConv(chat, convId)
    if (!pid) continue
    const mapped = [
      ...new Set(
        fus.candidates
          .map((c) => officeAgent(c.agent))
          .filter((a): a is OfficeAgentId => a !== null),
      ),
    ]
    const agents = mapped.length > 0 ? mapped : OFFICE_AGENTS
    warByProject.set(pid, { deskIds: agents.map((a) => `${pid}::${a}`) })
  }

  const rooms: RoomSnapshot[] = roomsBase.map(({ project, desks }) => {
    const kanban = missionByProject.get(project.id)
    let mission: RoomMission | undefined
    if (kanban) {
      const cur = kanban.phases[kanban.current]
      const curAgent = cur ? officeAgent(cur.def.agent) : null
      mission = {
        phases: kanban.phases.map((ph) => ({
          label: ph.def.label,
          persona: ph.def.persona,
          agent: ph.def.agent,
          status: ph.status,
        })),
        current: kanban.current,
        executorDeskId: curAgent ? `${project.id}::${curAgent}` : undefined,
      }
    }
    return {
      projectId: project.id,
      name: project.name,
      color: project.color ?? undefined,
      agg: roomAggregate(desks),
      costUsd: (ledgerCache.byProject[project.id] ?? 0) + (missionCost[project.id] ?? 0),
      unpriced: ledgerCache.unpriced[project.id] ?? { turns: 0, tokens: 0 },
      desks,
      mission,
      war: warByProject.get(project.id),
    }
  })

  return {
    rooms,
    deliveries: [...deliveries],
    handoffs: [...handoffs],
    kickoffs: [...kickoffs],
    celebrations: [...celebrations],
    batons: [...batons],
    arrivals: [...arrivals],
    bossDeliveries: [...bossDeliveries],
  }
}

/** Recarrega o cache de custo por projeto (ledger unificado: turn_costs, que
 *  desde o MH2.1 inclui as fases de missão, + stage_runs; desde sempre =
 *  custo ACUMULADO do projeto). */
async function refreshLedger(): Promise<void> {
  try {
    ledgerCache = aggregateLedgerByProject(await loadLedger(0))
  } catch {
    // best-effort: mantém o cache anterior
  }
}

export type DeriveHandle = {
  /** Encerra de vez: unsubscribe dos stores + timers. */
  stop(): void
  /** Liga ou desliga a derivação. Desligada, nada deriva (store, decaimento,
   *  ledger): cada tecla no chat notificaria os assinantes por um trabalho que
   *  o dedupe descartaria. Religar emite na hora. */
  setActive(active: boolean): void
}

/** Assina os stores e entrega snapshots a `cb` (≤10Hz, dedupe estrutural).
 *  `opts.active` começa desligado quando a cena monta oculta. */
export function startDeriving(
  cb: (s: OfficeSnapshot) => void,
  opts: { active?: boolean } = {},
): DeriveHandle {
  let disposed = false
  let active = opts.active !== false
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastJson = ""

  const emit = () => {
    if (disposed) return
    // S7: derive + stringify do dedupe + cb (stage.applySnapshot/setSnapshot)
    const endSpan = perfSpan("derive") // no-op sem mc.office.perf
    try {
      const snap = deriveOfficeSnapshot()
      const json = JSON.stringify(snap)
      if (json === lastJson) return // dedupe: nada mudou de verdade
      lastJson = json
      cb(snap)
    } finally {
      endSpan()
    }
  }

  // Trailing edge: a 1ª mudança do burst agenda; as demais coalescem no timer.
  // Inativo (office oculto) o agendamento nem acontece: nada a derivar.
  const schedule = () => {
    if (disposed || !active || timer) return
    timer = setTimeout(() => {
      timer = null
      emit()
    }, COALESCE_MS)
  }

  // A fila de interações é alimentada no import do store (boot), então
  // approvals de antes da 1ª visita já estão nela.
  const unsubs = [
    useChat.subscribe(schedule),
    useMission.subscribe(schedule),
    useApp.subscribe(schedule),
    useInteractions.subscribe(schedule),
    useFusion.subscribe(schedule), // guerra: disputa ativa vira room.war
    usePresets.subscribe(schedule), // rename de preset re-rotula a mesa
  ]

  // Decaimentos precisam de relógio (typing→thinking após 2.5s de silêncio,
  // balões expirando aos 15s): re-derive periódico barato — o dedupe engole
  // os ticks sem transição.
  const ticker = setInterval(schedule, TICK_MS)

  // Custo: o ledger é async — carrega já e re-agrega de tempos em tempos.
  // Inativo não consulta o banco (o custo não vai pra lugar nenhum).
  const refresh = () => {
    if (disposed || !active) return
    void refreshLedger().then(schedule)
  }
  refresh()
  const ledgerTimer = setInterval(refresh, LEDGER_REFRESH_MS)

  if (active) emit() // primeira foto imediata (o resto chega no trailing edge)

  return {
    stop() {
      disposed = true
      if (timer) clearTimeout(timer)
      clearInterval(ticker)
      clearInterval(ledgerTimer)
      for (const u of unsubs) u()
    },
    setActive(next) {
      if (disposed || next === active) return
      active = next
      if (!next) {
        // some com o trailing edge pendente: o burst que o agendou já não
        // interessa a ninguém.
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        return
      }
      emit() // volta à cena com o estado de AGORA (dedupe engole se nada mudou)
      refresh() // e o ledger pode ter envelhecido escondido
    },
  }
}
