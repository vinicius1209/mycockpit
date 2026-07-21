// PONTE do Companion Web no FRONT (docs/agent-office.md §8, backlog COMPANION —
// onda 1): o cérebro vive NESTA webview (stores useChat/useMission/
// useInteractions); o Rust é camada fina (servidor HTTP+WS). Este módulo escala
// o padrão provado da tray (set_tray_snapshot / tray://action):
//   OUT — push de estado coalescido (≤2Hz) via invoke("set_companion_snapshot")
//         + ping "companion_conv_updated" (throttled 1s) p/ o celular refetchar
//         o histórico da conversa com turno vivo;
//   IN  — listen("companion://action") com switch FECHADO de ações, TODAS
//         executando pelos stores/bridges existentes (answerGate, answer,
//         abort, cancelDeskTurn, ensureDeskConversation+sendFromDesk) — as
//         guardas ficam intactas, nada de bypass.
// Import sancionado do office/bridge/send (§6.1 item 5 do doc). NÃO depende do
// office montado: tudo sai dos stores direto.

import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import type { Attachment, AttachmentKind } from "@/lib/attachments"
import { AGENTS, availability } from "@/lib/agents"
import type { InteractionAnswer, ApprovalData, QuestionData } from "@/lib/interaction"
import type { MissionPhaseStatus, MissionStatus } from "@/lib/missionTypes"
import {
  isTauri,
  loadLedger,
  listRecentDeliveries,
  type LedgerEntry,
  type RecentDelivery,
} from "@/lib/db"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { convIdForInteraction, useInteractions } from "@/store/interactions"
import { useMission } from "@/store/mission"
import {
  cancelDeskTurn,
  DESK_TITLE_PREFIX,
  ensureDeskConversation,
  sendFromDesk,
} from "@/office/bridge/send"
import { OFFICE_AGENTS, type OfficeAgentId } from "@/office/engine/types"
import { perfSpan } from "@/office/engine/perf"

// ─────────────────────────────────────────────────────────── shape do snapshot
// A onda 2 (página do celular) constrói EM CIMA deste shape — mudar é breaking.
// Nunca inclui paths absolutos do disco (worktree/projectPath ficam fora).

/** Item que PRECISA de você: gate de missão, aprovação de comando ou pergunta
 *  estruturada do agente. `agent` é o ID do registry (a página rotula). */
export interface CompanionAttention {
  /** gate → "gate:<convId>"; approval/question → id do request (responder usa). */
  id: string
  kind: "gate" | "approval" | "question"
  /** null = não mapeável a uma conversa (question não carrega run_id). */
  convId: string | null
  projectId: string | null
  projectName: string | null
  /** ID do agent dono (fase da missão ou conversa); "" se desconhecido. */
  agent: string
  /** Índice da fase (missão); null fora de missão. */
  phase: number | null
  phaseLabel: string | null
  /** gate: perguntas abertas · question: enunciados das perguntas. */
  questions?: string[]
  /** approval: comando extraído (Bash) e a tool pedida. */
  command?: string
  toolName?: string
}

/** Atividade em execução agora (turno linear OU missão). */
export interface CompanionRunning {
  convId: string
  projectId: string | null
  projectName: string | null
  kind: "turno" | "missão"
  /** ID do agent (turno: o da conversa; missão: o da fase corrente). */
  agent: string
  /** Título da conversa (turno) ou task (missão). */
  label: string
  /** Etapa humana ("Executando comando…", "Planejar…"). */
  detail: string
  startedAt: number | null
  /** Só p/ kind "missão": resumo compacto das fases. */
  missionPhases?: { label: string; status: MissionPhaseStatus }[]
}

export interface CompanionMissionPhase {
  label: string
  agent: string
  status: MissionPhaseStatus
  costUsd: number
}

export interface CompanionMission {
  convId: string
  projectId: string | null
  projectName: string | null
  task: string
  status: MissionStatus
  phases: CompanionMissionPhase[]
  /** Índice da fase corrente (além do fim quando done). */
  current: number
  costTotal: number
  maxCostUsd: number | null
  /** Gate pendente (responder via ação answer_gate). null = nada pendente. */
  gate: { phase: number; questions: string[] } | null
}

export interface CompanionDelivery {
  projectId: string
  projectName: string | null
  task: string
  agent: string
  costUsd: number | null
  createdAt: number
}

export interface CompanionCosts {
  /** US$ de HOJE (ledger desde 0h local) + missões vivas (ainda fora do ledger). */
  totalUsd: number
  byProject: Record<string, number>
}

/** Agent utilizável num projeto + a conversa de MESA dele (quando já existe).
 *  `deskConvId` é o que devolve o histórico ao celular: sem ele a página só
 *  reencontrava a conversa enquanto o turno estava em running[] — sair e
 *  voltar depois do turno perdia o histórico (gap G2 do Companion). */
export interface CompanionProjectAgent {
  agent: string
  /** Conversa "Mesa · {agent}" mais recente do projeto (histórico via
   *  GET /api/conv). Ausente = a mesa nunca conversou neste projeto. */
  deskConvId?: string
  deskTitle?: string
}

export interface CompanionProject {
  id: string
  name: string
  /** Agents utilizáveis nesta máquina (ready/instalado) + conversa da mesa. */
  agents: CompanionProjectAgent[]
}

export interface CompanionSnapshot {
  attention: CompanionAttention[]
  running: CompanionRunning[]
  missions: CompanionMission[]
  deliveries: CompanionDelivery[]
  costs: CompanionCosts
  projects: CompanionProject[]
}

/** Dados assíncronos (DB) que temperam o snapshot; cacheados pelo bridge. */
export interface CompanionExtras {
  ledger: LedgerEntry[]
  deliveries: RecentDelivery[]
}

const EMPTY_EXTRAS: CompanionExtras = { ledger: [], deliveries: [] }

// ─────────────────────────────────────────────────────── construção (síncrona)

/** Etapa humana do turno linear (mesmo mapa da tray — texto de telemetria). */
function linearDetail(convId: string): string {
  const c = useChat.getState().byId[convId]
  const last = c?.items[c.items.length - 1]
  if (last?.kind === "tool") {
    const known: Record<string, string> = {
      Bash: "Executando comando…",
      Read: "Lendo arquivo…",
      Edit: "Editando arquivos…",
      Write: "Escrevendo arquivo…",
      Glob: "Mapeando o projeto…",
      Grep: "Buscando no projeto…",
      WebSearch: "Pesquisando na web…",
    }
    return known[last.name] ?? `Usando ${last.name}…`
  }
  if (c?.streamingTextId || last?.kind === "text") return "Redigindo resposta…"
  return "Analisando a tarefa…"
}

/** Monta o snapshot completo DOS STORES (síncrono, puro sobre getState — não
 *  depende do office montado). `extras` = cache assíncrono de ledger/entregas. */
export function buildCompanionSnapshot(
  extras: CompanionExtras = EMPTY_EXTRAS,
): CompanionSnapshot {
  const app = useApp.getState()
  const chat = useChat.getState()
  const missions = useMission.getState()
  const queue = useInteractions.getState().queue

  const projectName = new Map(app.projects.map((p) => [p.id, p.name]))
  const projectOf = (convId: string): string | null =>
    chat.byId[convId]?.projectId ?? null
  const nameOf = (pid: string | null): string | null =>
    pid ? (projectName.get(pid) ?? null) : null
  const titleOf = (convId: string): string => {
    const pid = projectOf(convId)
    return (
      (pid
        ? chat.conversationsByProject[pid]?.find((c) => c.id === convId)?.title
        : null) ?? "Conversa"
    )
  }

  // ── atenção: gates das missões + fila única de interações ──
  const attention: CompanionAttention[] = []
  for (const [convId, m] of Object.entries(missions.byConv)) {
    if (m.status !== "running" || !m.gate) continue
    const pid = projectOf(convId)
    const ph = m.phases[m.gate.phase]
    attention.push({
      id: `gate:${convId}`,
      kind: "gate",
      convId,
      projectId: pid,
      projectName: nameOf(pid),
      agent: ph?.def.agent ?? "",
      phase: m.gate.phase,
      phaseLabel: ph?.def.label ?? null,
      questions: m.gate.questions,
    })
  }
  for (const req of queue) {
    const target = convIdForInteraction(req, chat, missions)
    const convId = target?.convId ?? null
    const pid = convId ? projectOf(convId) : null
    if (req.kind === "approval") {
      const d = req.data as Partial<ApprovalData> | null | undefined
      const phase =
        target?.kind === "mission" && target.phase != null ? target.phase : null
      const phaseRun =
        convId && phase != null
          ? missions.byConv[convId]?.phases[phase]
          : undefined
      attention.push({
        id: req.id,
        kind: "approval",
        convId,
        projectId: pid,
        projectName: nameOf(pid),
        agent:
          phaseRun?.def.agent ??
          (convId ? (chat.byId[convId]?.agent ?? "") : ""),
        phase,
        phaseLabel: phaseRun?.def.label ?? null,
        command: typeof d?.command === "string" ? d.command : "",
        toolName: typeof d?.tool_name === "string" ? d.tool_name : "",
      })
    } else {
      const d = req.data as Partial<QuestionData> | null | undefined
      attention.push({
        id: req.id,
        kind: "question",
        convId,
        projectId: pid,
        projectName: nameOf(pid),
        agent: convId ? (chat.byId[convId]?.agent ?? "") : "",
        phase: null,
        phaseLabel: null,
        questions: (d?.questions ?? []).map((q) => q.question),
      })
    }
  }

  // ── execução: turnos lineares rodando + missões running ──
  const running: CompanionRunning[] = []
  for (const [convId, c] of Object.entries(chat.byId)) {
    if (!c.running) continue
    running.push({
      convId,
      projectId: c.projectId || null,
      projectName: nameOf(c.projectId || null),
      kind: "turno",
      agent: c.agent,
      label: titleOf(convId),
      detail: linearDetail(convId),
      startedAt: c.startedAt,
    })
  }
  for (const [convId, m] of Object.entries(missions.byConv)) {
    if (m.status !== "running") continue
    const pid = projectOf(convId)
    const ph = m.phases[m.current]
    running.push({
      convId,
      projectId: pid,
      projectName: nameOf(pid),
      kind: "missão",
      agent: ph?.def.agent ?? "",
      label: m.task,
      detail: ph ? `${ph.def.label}…` : "Preparando próxima etapa…",
      startedAt: ph?.startedAt ?? m.startedAt,
      missionPhases: m.phases.map((p) => ({
        label: p.def.label,
        status: p.status,
      })),
    })
  }

  // ── missões (todas de byConv: running/done/error/aborted — a página filtra) ──
  const missionList: CompanionMission[] = Object.entries(missions.byConv).map(
    ([convId, m]) => {
      const pid = projectOf(convId)
      return {
        convId,
        projectId: pid,
        projectName: nameOf(pid),
        task: m.task,
        status: m.status,
        phases: m.phases.map((p) => ({
          label: p.def.label,
          agent: p.def.agent,
          status: p.status,
          costUsd: p.costUsd,
        })),
        current: m.current,
        costTotal: m.costTotal,
        maxCostUsd: m.maxCostUsd,
        gate: m.gate ?? null,
      }
    },
  )

  // ── custos: ledger de hoje + missões VIVAS (não-done nunca entram no ledger;
  // done viram delivery e já estão no ledger — somar de novo dobraria). ──
  const byProject: Record<string, number> = {}
  let totalUsd = 0
  for (const e of extras.ledger) {
    const c = e.costUsd ?? 0
    totalUsd += c
    byProject[e.projectId] = (byProject[e.projectId] ?? 0) + c
  }
  for (const [convId, m] of Object.entries(missions.byConv)) {
    if (m.status === "done" || m.costTotal <= 0) continue
    totalUsd += m.costTotal
    const pid = projectOf(convId)
    if (pid) byProject[pid] = (byProject[pid] ?? 0) + m.costTotal
  }

  // ── projetos + agents utilizáveis (registry × detecção runtime) + a conversa
  // de MESA de cada agent (mesma regra do ensureDeskConversation: meta.agent
  // igual E título "Mesa · …", a mais recente). As metas vêm de
  // conversationsByProject — a ponte as carrega lazy (maybeLoadDeskMetas). ──
  const usableAgents = AGENTS.filter(
    (a) =>
      a.kind === "agent" &&
      a.available &&
      ["ready", "installed-auth-unknown"].includes(
        availability(a.id, app.settings.detected),
      ),
  ).map((a) => a.id)
  const deskOf = (pid: string, agent: string): CompanionProjectAgent => {
    const metas = chat.conversationsByProject[pid] ?? []
    let best: { id: string; title: string | null; updatedAt: number } | null =
      null
    for (const m of metas) {
      if (m.agent !== agent || !m.title?.startsWith(DESK_TITLE_PREFIX)) continue
      if (!best || m.updatedAt > best.updatedAt) best = m
    }
    return best
      ? { agent, deskConvId: best.id, deskTitle: best.title ?? undefined }
      : { agent }
  }
  const projects: CompanionProject[] = app.projects.map((p) => ({
    id: p.id,
    name: p.name,
    agents: usableAgents.map((a) => deskOf(p.id, a)),
  }))

  return {
    attention,
    running,
    missions: missionList,
    deliveries: extras.deliveries.map((d) => ({
      projectId: d.projectId,
      projectName: nameOf(d.projectId),
      task: d.task,
      agent: d.agent,
      costUsd: d.costUsd,
      createdAt: d.createdAt,
    })),
    costs: { totalUsd, byProject },
    projects,
  }
}

// ───────────────────────────────────────────────── executor (companion://action)

/** Anexos vindos do celular: o upload multipart JÁ salvou os blobs via a mesma
 *  rotina do save_attachment (Rust) e devolveu os metadados — aqui só validamos
 *  o SHAPE e o path relativo esperado ("attachments/…"); nada de path absoluto
 *  ou fora do cache de anexos passa. */
function sanitizeAttachments(v: unknown): Attachment[] {
  if (!Array.isArray(v)) return []
  const out: Attachment[] = []
  for (const raw of v) {
    if (typeof raw !== "object" || raw === null) continue
    const a = raw as Record<string, unknown>
    if (typeof a.path !== "string" || !a.path.startsWith("attachments/")) continue
    if (a.path.includes("..")) continue // nunca escapa do cache de anexos
    const kind: AttachmentKind =
      a.kind === "image" || a.kind === "pdf" ? a.kind : "other"
    out.push({
      path: a.path,
      name: typeof a.name === "string" ? a.name : "anexo",
      kind,
      mime: typeof a.mime === "string" ? a.mime : "application/octet-stream",
      bytes: typeof a.bytes === "number" ? a.bytes : 0,
    })
  }
  return out
}

/** Anexos resolvidos pelo RUST no payload da ação: `attachments` chega como
 *  MAPA {attachmentId → Attachment} (o cache de uploads do celular) + a ordem
 *  escolhida em `attachmentIds`. Array direto (shape do desktop) também passa. */
function uploadedAttachments(p: Record<string, unknown>): Attachment[] {
  if (Array.isArray(p.attachments)) return sanitizeAttachments(p.attachments)
  if (typeof p.attachments !== "object" || p.attachments === null) return []
  const map = p.attachments as Record<string, unknown>
  const ids = Array.isArray(p.attachmentIds)
    ? p.attachmentIds.filter((x): x is string => typeof x === "string")
    : Object.keys(map)
  return sanitizeAttachments(ids.map((id) => map[id]))
}

function isInteractionAnswer(v: unknown): v is InteractionAnswer {
  if (typeof v !== "object" || v === null) return false
  const a = v as Record<string, unknown>
  return typeof a.allow === "boolean" || Array.isArray(a.answers)
}

function str(v: unknown): string {
  return typeof v === "string" ? v : ""
}

/** Executa UMA ação vinda do celular (payload do evento `companion://action`).
 *  O Rust já RECONSTRUIU o payload (whitelist fechada, campos extras nunca
 *  passam) com o discriminador `kind` — o mesmo vocabulário do POST /api/action.
 *  Switch FECHADO — ação desconhecida é ignorada com aviso; toda ação passa
 *  pelos stores/bridges existentes (guardas intactas: answerGate no-opa sem
 *  gate, answer no-opa se o id já saiu da fila, sendFromDesk tem TODAS as
 *  guardas de envio). Exportada p/ teste. */
export async function handleCompanionAction(payload: unknown): Promise<void> {
  const p =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {}
  const action = str(p.kind)
  switch (action) {
    case "answer_gate": {
      const convId = str(p.convId)
      if (!convId || !Array.isArray(p.answers)) {
        console.warn("[companion] answer_gate malformado — ignorado", p)
        return
      }
      const answers = p.answers.map((raw) => {
        const a =
          typeof raw === "object" && raw !== null
            ? (raw as Record<string, unknown>)
            : {}
        const attachments = sanitizeAttachments(a.attachments)
        return {
          text: str(a.text),
          attachments: attachments.length ? attachments : undefined,
        }
      })
      // Uploads do celular viajam FORA das answers (attachmentIds + mapa
      // resolvido pelo Rust): anexam à PRIMEIRA resposta — o gate entrega tudo
      // ao agente de uma vez, a posição não muda a semântica.
      const uploaded = uploadedAttachments(p)
      if (uploaded.length) {
        const first = answers[0] ?? { text: "", attachments: undefined }
        answers[0] = {
          text: first.text,
          attachments: [...(first.attachments ?? []), ...uploaded],
        }
      }
      useMission.getState().answerGate(convId, answers)
      return
    }
    case "answer_interaction": {
      const id = str(p.id)
      if (!id || !isInteractionAnswer(p.answer)) {
        console.warn("[companion] answer_interaction malformado — ignorado", p)
        return
      }
      useInteractions.getState().answer(id, p.answer)
      return
    }
    case "stop_mission": {
      const convId = str(p.convId)
      if (!convId) return
      useMission.getState().abort(convId)
      return
    }
    case "stop_turn": {
      const convId = str(p.convId)
      if (!convId) return
      await cancelDeskTurn(convId)
      return
    }
    case "send_message": {
      const projectId = str(p.projectId)
      const agent = str(p.agent)
      const text = str(p.text).trim()
      if (!projectId || !text || !OFFICE_AGENTS.includes(agent as OfficeAgentId)) {
        console.warn("[companion] send_message malformado — ignorado", p)
        return
      }
      const proj = useApp.getState().projects.find((pr) => pr.id === projectId)
      if (!proj) {
        console.warn("[companion] projeto desconhecido — ignorado", projectId)
        return
      }
      const officeAgent = agent as OfficeAgentId
      const convId = await ensureDeskConversation(projectId, officeAgent)
      await sendFromDesk({
        convId,
        projectId,
        projectPath: proj.path,
        agent: officeAgent,
        text,
        attachments: uploadedAttachments(p),
      })
      return
    }
    default:
      console.warn("[companion] ação desconhecida ignorada:", action)
  }
}

// ─────────────────────────────────────────────────────── bridge (push + ações)

/** Coalescing do push: no máx. 1 invoke a cada 500ms (≤2Hz). */
const PUSH_MIN_INTERVAL_MS = 500
/** Ping de conversa atualizada: no máx. 1/s por conversa. */
const PING_MIN_INTERVAL_MS = 1_000
/** Cache do ledger/entregas: re-lê o DB no máx. a cada 30s. */
const EXTRAS_TTL_MS = 30_000

let started = false
let unsubs: (() => void)[] = []
let pushTimer: ReturnType<typeof setTimeout> | null = null
let lastPushAt = 0
let lastSentKey: string | null = null
let extrasCache: CompanionExtras = EMPTY_EXTRAS
let extrasAt = 0
const pingTimers = new Map<string, ReturnType<typeof setTimeout>>()
const lastPingAt = new Map<string, number>()

/** Metas de conversa de TODOS os projetos, carregadas lazy (1x por projeto):
 *  o deskConvId do snapshot sai de conversationsByProject, mas o desktop só
 *  carrega metas sob demanda — sem este empurrão, projetos nunca abertos na
 *  sessão apareceriam sem mesa no celular. loadProjectConversations é no-op
 *  quando já carregado; o setState dela dispara novo push sozinho. */
const metasRequested = new Set<string>()
function maybeLoadDeskMetas(): void {
  const chat = useChat.getState()
  for (const p of useApp.getState().projects) {
    if (metasRequested.has(p.id) || chat.conversationsByProject[p.id]) continue
    metasRequested.add(p.id)
    void chat.loadProjectConversations(p.id).catch(() => {
      metasRequested.delete(p.id) // falhou → tenta de novo no próximo push
    })
  }
}

function maybeRefreshExtras(): void {
  if (Date.now() - extrasAt < EXTRAS_TTL_MS) return
  extrasAt = Date.now()
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  void Promise.all([loadLedger(startOfToday.getTime()), listRecentDeliveries(6)])
    .then(([ledger, deliveries]) => {
      extrasCache = { ledger, deliveries }
      schedulePush() // dados novos → re-empurra (dedupe segura se nada mudou)
    })
    .catch(() => {})
}

function pushNow(): void {
  const endSpan = perfSpan("companion") // S7 (no-op sem mc.office.perf)
  try {
    lastPushAt = Date.now()
    maybeRefreshExtras()
    maybeLoadDeskMetas()
    const snapshot = buildCompanionSnapshot(extrasCache)
    // dedupe ESTRUTURAL antes do invoke (mesmo padrão do updateTray): o subscribe
    // dispara a cada set dos stores, mas só atravessamos a ponte quando o payload
    // muda de verdade.
    const key = JSON.stringify(snapshot)
    if (key === lastSentKey) return
    lastSentKey = key
    invoke("set_companion_snapshot", { snapshot }).catch(() => {
      lastSentKey = null // comando pode não existir ainda — não trava o dedupe
    })
  } finally {
    endSpan()
  }
}

function schedulePush(): void {
  if (pushTimer) return // já agendado neste burst → coalesce
  const wait = Math.max(0, lastPushAt + PUSH_MIN_INTERVAL_MS - Date.now())
  pushTimer = setTimeout(() => {
    pushTimer = null
    pushNow()
  }, wait)
}

/** Ping throttled (1s/conversa): a webview avisa que a conversa mudou e o
 *  celular refetcha o histórico (o Rust lê a linha do SQLite read-only). */
function pingConvUpdated(convId: string): void {
  if (pingTimers.has(convId)) return
  const wait = Math.max(
    0,
    (lastPingAt.get(convId) ?? 0) + PING_MIN_INTERVAL_MS - Date.now(),
  )
  pingTimers.set(
    convId,
    setTimeout(() => {
      pingTimers.delete(convId)
      lastPingAt.set(convId, Date.now())
      invoke("companion_conv_updated", { convId }).catch(() => {})
    }, wait),
  )
}

/** Liga a ponte: assina os stores (push coalescido + ping de conv viva) e
 *  escuta `companion://action`. Idempotente; retorna o stop. Gated pelo
 *  setting `companionEnabled` (ver o watcher no fim do módulo) — nunca roda
 *  com o Companion desligado. */
export function startCompanionBridge(): () => void {
  if (started) return stopCompanionBridge
  started = true

  unsubs.push(
    useChat.subscribe((state, prev) => {
      schedulePush()
      // conv-updated: só conversas com turno VIVO cujo estado mudou de ref.
      for (const [convId, c] of Object.entries(state.byId)) {
        if ((c.running || c.finalizing) && prev.byId[convId] !== c) {
          pingConvUpdated(convId)
        }
      }
    }),
    useMission.subscribe(() => schedulePush()),
    useInteractions.subscribe(() => schedulePush()),
    useApp.subscribe(() => schedulePush()),
  )

  let disposed = false
  listen<unknown>("companion://action", (e) => {
    void handleCompanionAction(e.payload)
  })
    .then((un) => {
      if (disposed) un()
      else unsubs.push(un)
    })
    .catch(() => {})
  unsubs.push(() => {
    disposed = true
  })

  schedulePush() // snapshot inicial
  return stopCompanionBridge
}

/** Desliga a ponte e limpa timers/estado (usado em teste e num futuro toggle). */
export function stopCompanionBridge(): void {
  if (!started) return
  started = false
  for (const u of unsubs) u()
  unsubs = []
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  for (const t of pingTimers.values()) clearTimeout(t)
  pingTimers.clear()
  lastPingAt.clear()
  metasRequested.clear()
  lastPushAt = 0
  lastSentKey = null
  extrasCache = EMPTY_EXTRAS
  extrasAt = 0
}

// ─────────────────────────────── servidor (comandos Rust) + gate pelo setting

/** Info do servidor companion (espelho do CompanionInfo do Rust). */
export interface CompanionInfo {
  running: boolean
  urlLan: string | null
  token: string | null
  /** Nº de dispositivos (sockets WS) conectados agora. */
  connectedCount: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Status do servidor (null fora do Tauri / comando indisponível). */
export async function companionStatus(): Promise<CompanionInfo | null> {
  if (!isTauri()) return null
  try {
    return await invoke<CompanionInfo>("companion_status")
  } catch {
    return null
  }
}

/** Sobe o servidor com RETRY curto: logo após um companion_stop o socket
 *  antigo pode ainda estar fechando (bind falha com "porta indisponível") —
 *  tenta de novo por ~2s antes de desistir. */
export async function startCompanionServer(): Promise<CompanionInfo> {
  let lastErr = "companion_start indisponível"
  for (let i = 0; i < 8; i++) {
    try {
      return await invoke<CompanionInfo>("companion_start")
    } catch (e) {
      lastErr = String(e)
      await sleep(250)
    }
  }
  throw new Error(lastErr)
}

export async function stopCompanionServer(): Promise<void> {
  try {
    await invoke("companion_stop")
  } catch {
    // comando indisponível (dev browser) — nada a parar
  }
}

/** Revoga o token antigo e sobe com um novo: stop → apaga token (Rust) →
 *  start. Celulares pareados perdem o acesso na hora (o QR muda). */
export async function regenerateCompanionToken(): Promise<CompanionInfo> {
  await stopCompanionServer()
  await invoke("companion_revoke_token")
  return startCompanionServer()
}

/** Aplica o setting: ligado ⇒ ponte + servidor; desligado ⇒ para os dois.
 *  A ponte NUNCA roda com o setting desligado (opt-in de verdade). */
function syncCompanionWithSetting(enabled: boolean): void {
  if (enabled) {
    startCompanionBridge()
    void startCompanionServer().catch((e) => {
      console.warn("[companion] servidor não subiu:", e)
    })
  } else {
    void stopCompanionServer()
    stopCompanionBridge()
  }
}

// Gate no import (o App.tsx importa este módulo por efeito, padrão do
// store/interactions): só liga se o usuário OPT-IN nas Settings — boot com o
// setting ligado religa sozinho; o watcher reage ao toggle ao vivo. Fora do
// Tauri não há ponte — o dev no browser segue limpo.
if (isTauri()) {
  syncCompanionWithSetting(useApp.getState().settings.companionEnabled)
  useApp.subscribe((s, prev) => {
    if (s.settings.companionEnabled !== prev.settings.companionEnabled) {
      syncCompanionWithSetting(s.settings.companionEnabled)
    }
  })
}
