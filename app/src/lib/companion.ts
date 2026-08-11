// PONTE do Companion Web no FRONT (docs/agent-office.md §8, doc histórico;
// backlog COMPANION — onda 1): o cérebro vive NESTA webview (stores useChat/useMission/
// useInteractions); o Rust é camada fina (servidor HTTP+WS). Este módulo escala
// o padrão provado da tray (set_tray_snapshot / tray://action):
//   OUT — push de estado coalescido (≤2Hz) via invoke("set_companion_snapshot")
//         + ping "companion_conv_updated" (throttled 1s) p/ o celular refetchar
//         o histórico da conversa com turno vivo;
//   IN  — listen("companion://action") com switch FECHADO de ações, TODAS
//         executando pelos stores/bridges existentes (answerGate, answer,
//         abort, cancelDeskTurn, ensureDeskConversation+sendFromDesk) — as
//         guardas ficam intactas, nada de bypass.
// Import sancionado do lib/fleet/send (ex-office/bridge/send, §6.1 item 5 do
// doc). NÃO depende de nenhuma superfície montada: tudo sai dos stores direto.

import { invoke } from "@tauri-apps/api/core"
import { getAgentDef } from "@/lib/agentDefs"
import { listen } from "@tauri-apps/api/event"
import type { Attachment, AttachmentKind } from "@/lib/attachments"
import { AGENTS, availability, dispatchBlockReason } from "@/lib/agents"
import type { InteractionAnswer, ApprovalData, QuestionData } from "@/lib/interaction"
import type { MissionPhaseStatus, MissionStatus } from "@/lib/missionTypes"
import {
  isTauri,
  isTerminalCardState,
  loadLedger,
  listRecentDeliveries,
  type CardState,
  type LedgerEntry,
  type RecentDelivery,
} from "@/lib/db"
import { feedbackLesson } from "@/lib/learning"
import { nativeNotify } from "@/lib/notify"
import { hasAssistantReply } from "@/lib/presets"
import { useApp } from "@/store/app"
import { useCards } from "@/store/cards"
import { useChat, hasExecutorTurn } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { ownerByRunId, useInteractions } from "@/store/interactions"
import { useMission } from "@/store/mission"
import { usePresets } from "@/store/presets"
import {
  cancelDeskTurn,
  DESK_TITLE_PREFIX,
  ensureDeskConversation,
  sendFromDesk,
} from "@/lib/fleet/send"
import { OFFICE_AGENTS, type OfficeAgentId } from "@/lib/fleet/types"
import { perfSpan } from "@/lib/fleet/perf"

// ─────────────────────────────────────────────────────────── shape do snapshot
// A onda 2 (página do celular) constrói EM CIMA deste shape — mudar é breaking.
// Nunca inclui paths absolutos do disco (worktree/projectPath ficam fora).

/** Item que PRECISA de você: gate de missão, aprovação de comando, pergunta
 *  estruturada do agente, turno MUDO (watchdog P2) ou card ESTAGNADO do board
 *  (vigia S2.2). `agent` é o ID do registry (a página rotula). */
export interface CompanionAttention {
  /** gate → "gate:<convId>"; approval/question → id do request (responder usa);
   *  stalled → "stalled:<convId>" (parar usa stop_turn com o convId);
   *  card → "card:<cardId>" (informativo; as ações moram na seção Board). */
  id: string
  kind: "gate" | "approval" | "question" | "stalled" | "card"
  /** null = dono irresolvível (pedido sem run_id, ou run já morto). Vale para os
   *  dois kinds: pergunta TAMBÉM carrega run_id (o backend anexa em toda
   *  emissão), então ela chega com conversa e projeto como a aprovação. */
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
  /** question COM opções estruturadas (C2): a página renderiza a ESCOLHA de
   *  verdade (radio/checkbox + texto livre), não só textarea. Omitido quando
   *  nenhuma pergunta tem opções (o fluxo de texto livre segue). */
  choices?: CompanionQuestion[]
  /** approval: comando extraído (Bash) e a tool pedida. */
  command?: string
  toolName?: string
  /** stalled/card: minutos de silêncio ("mudo há X min"). */
  minutes?: number
  /** card: título do card estagnado (a página mostra O QUE está parado). */
  title?: string
}

/** Pergunta estruturada com opções (espelho compacto do Question do
 *  lib/interaction — o snapshot nunca carrega o input cru do agente). */
export interface CompanionQuestion {
  header: string
  question: string
  multiSelect: boolean
  options: { label: string; description: string }[]
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
  /** C2 — turno FINALIZANDO (o CLI está fechando; runId já foi embora): a
   *  página mostra o estado honesto e o Parar não finge que interrompe. */
  finalizing?: boolean
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

/** Card ABERTO do board (S4.5) — terminal (done/cancelled) nunca viaja: done
 *  já aparece como delivery e histórico fechado não é board. */
export interface CompanionCard {
  id: string
  projectId: string
  projectName: string | null
  title: string
  state: CardState
  /** true quando o projeto do card saiu do app (arquivado): a página rotula
   *  "projeto arquivado" e esconde "Iniciar" (defesa de UX — a guarda de
   *  verdade LANÇA no useCards.dispatch, B1). Omitido quando o projeto vive. */
  archived?: boolean
  /** Início do silêncio (vigia S2.2) — transient, some quando o card mexe. */
  stalledSince?: number
  /** RESERVADO: o custo por card mora em turn_costs (query assíncrona do
   *  Painel), não no store — e o snapshot é síncrono/puro sobre getState.
   *  Enquanto o custo não for hidratado no useCards, o campo fica omitido
   *  (nunca inventado). */
  costUsd?: number
}

/** Especialista GLOBAL utilizável em qualquer projeto (C2 · lançar tarefa).
 *  Só os globais viajam: um preset de escopo-projeto só existe no projeto do
 *  desktop carregado e confundiria o celular ("por que sumiu?"). */
export interface CompanionSpecialist {
  id: string
  name: string
  /** Agent (CLI) que encarna a persona — a página mostra e o executor valida. */
  backend: string
  category: string
}

export interface CompanionSnapshot {
  attention: CompanionAttention[]
  running: CompanionRunning[]
  missions: CompanionMission[]
  deliveries: CompanionDelivery[]
  costs: CompanionCosts
  projects: CompanionProject[]
  /** Board (S4.5): opcional no shape (página antiga segue funcionando), mas o
   *  builder sempre emite. */
  cards?: CompanionCard[]
  /** Especialistas globais (C2): opcional no shape, o builder sempre emite. */
  specialists?: CompanionSpecialist[]
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
 *  depende de superfície montada). `extras` = cache assíncrono de ledger/entregas. */
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
    // `ownerByRunId` (qualquer kind), não `convIdForInteraction` (approval-only):
    // o alvo é resolvido UMA vez e usado nos DOIS ramos, então a régua restrita
    // deixava toda PERGUNTA chegar no celular sem conversa, sem projeto e sem
    // agent — justo o que você precisa pra decidir se vale voltar pro computador.
    const target = ownerByRunId(req, chat, missions)
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
      const rawQs = d?.questions ?? []
      // C2 — opções estruturadas viajam quando existem: a ESCOLHA vira
      // botões no celular e a resposta entra pelo mesmo answer_interaction.
      const choices: CompanionQuestion[] = rawQs.map((q) => ({
        header: typeof q.header === "string" ? q.header : "",
        question: typeof q.question === "string" ? q.question : "",
        multiSelect: !!q.multiSelect,
        options: (Array.isArray(q.options) ? q.options : []).map((o) => ({
          label: typeof o.label === "string" ? o.label : "",
          description: typeof o.description === "string" ? o.description : "",
        })),
      }))
      attention.push({
        id: req.id,
        kind: "question",
        convId,
        projectId: pid,
        projectName: nameOf(pid),
        agent: convId ? (chat.byId[convId]?.agent ?? "") : "",
        phase: null,
        phaseLabel: null,
        questions: rawQs.map((q) => q.question),
        ...(choices.some((q) => q.options.length > 0) ? { choices } : {}),
      })
    }
  }

  // turno RUNNING mudo (o watchdog marcou stalledSince): card acionável no
  // celular — "Parar" reaproveita a ação stop_turn já whitelisted no Rust.
  for (const [convId, c] of Object.entries(chat.byId)) {
    if (!c.running || c.stalledSince == null) continue
    attention.push({
      id: `stalled:${convId}`,
      kind: "stalled",
      convId,
      projectId: c.projectId || null,
      projectName: nameOf(c.projectId || null),
      agent: c.agent,
      phase: null,
      phaseLabel: null,
      minutes: Math.max(1, Math.round((Date.now() - c.stalledSince) / 60_000)),
    })
  }

  // ── board (S4.5): cards abertos do useCards + estagnados em attention ──
  const boardCards = useCards.getState().all
  const cards: CompanionCard[] = []
  for (const c of boardCards) {
    if (isTerminalCardState(c.state)) continue
    const cardProjectName = nameOf(c.projectId)
    cards.push({
      id: c.id,
      projectId: c.projectId,
      projectName: cardProjectName,
      title: c.title,
      state: c.state,
      // projeto fora do app = arquivado, marcado EXPLÍCITO (D2): a página
      // rotula e esconde "Iniciar"; a guarda real lança no dispatch (B1).
      ...(cardProjectName == null ? { archived: true } : {}),
      // costUsd OMITIDO de propósito: ver o doc do CompanionCard.
      ...(c.stalledSince != null ? { stalledSince: c.stalledSince } : {}),
    })
    // card ESTAGNADO (vigia S2.2) pede olho também em attention — análogo ao
    // "stalled" de turno acima, com minutes. Informativo: as ações remotas
    // (dispatch/close) moram na seção Board da página.
    if (c.stalledSince != null) {
      attention.push({
        id: `card:${c.id}`,
        kind: "card",
        convId: c.conversationId,
        projectId: c.projectId,
        projectName: nameOf(c.projectId),
        agent: c.assigneeAgent ?? "",
        phase: null,
        phaseLabel: null,
        title: c.title,
        minutes: Math.max(
          1,
          Math.round((Date.now() - c.stalledSince) / 60_000),
        ),
      })
    }
  }

  // ── execução: turnos lineares rodando OU finalizando + missões running ──
  // C2 — finalizando ENTRA no running[] com a marca honesta: o turno ainda
  // não acabou (o CLI está fechando), mas já não é interrompível (runId foi
  // embora no result). Antes ele simplesmente SUMIA do celular.
  const running: CompanionRunning[] = []
  for (const [convId, c] of Object.entries(chat.byId)) {
    if (!c.running && !c.finalizing) continue
    running.push({
      convId,
      projectId: c.projectId || null,
      projectName: nameOf(c.projectId || null),
      kind: "turno",
      agent: c.agent,
      label: titleOf(convId),
      detail: c.finalizing ? "finalizando…" : linearDetail(convId),
      startedAt: c.startedAt,
      ...(c.finalizing ? { finalizing: true } : {}),
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
  // Allowlist EXPLÍCITA de prontidão (Sprint 0): "ready" e "installed-auth-
  // unknown" (auth incerta é usável com aviso — inclui o agy, sem comando de
  // auth). "installed-not-authenticated" (CLI deslogada) fica FORA: deslogado
  // não é usável, e o companion não finge que é.
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

  // ── Especialistas GLOBAIS (C2 · lançar tarefa): valem em qualquer projeto.
  // Escopo-projeto fica FORA (só existe no projeto carregado no desktop; num
  // outro projeto o getAgentDef não o acharia e o lançamento falharia). ──
  const specialists: CompanionSpecialist[] = usePresets
    .getState()
    .list.filter((s) => s.scope === "global")
    .map((s) => ({
      id: s.id,
      name: s.name,
      backend: s.backend,
      category: s.category,
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
    cards,
    specialists,
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

// ─────────────────────────────────────────── resultado de ação (C2, fail-closed)

/** Veredito de uma ação do celular: o 202 do POST é só "aceitei"; ISTO é a
 *  resposta de verdade (lançou / já tinha acabado / projeto sumiu), devolvida
 *  ao aparelho via WS (companion_action_result → {type:"action-result"}). */
export interface CompanionActionResult {
  actionId: string
  kind: string
  ok: boolean
  /** Motivo LEGÍVEL (pt-BR) — obrigatório no fracasso, útil no sucesso. */
  message: string
  /** launch_task ok: a conversa criada (a página navega direto pro fio). */
  convId?: string
  projectId?: string
  agent?: string
}

/** Empurra o veredito pro(s) celular(es). NUNCA silencioso no erro (ADR-017:
 *  o aparelho está esperando a resposta) — sem comando disponível, loga. */
function pushActionResult(result: CompanionActionResult): void {
  invoke("companion_action_result", { result }).catch((e) => {
    console.warn("[companion] não consegui devolver o resultado da ação:", e)
  })
}

/** Veredito HONESTO do stop_turn, computado ANTES do cancelamento: espelha a
 *  semântica do Stop do app (ChatPanel/tray) — disputa Fusion aborta; turno
 *  FINALIZANDO não é interrompível (runId já foi embora); turno morto idem. */
function stopTurnVerdict(convId: string): { ok: boolean; message: string } {
  const fusion = useFusion.getState().byConv[convId]
  if (fusion && (fusion.phase === "running" || fusion.phase === "judging")) {
    return { ok: true, message: "Disputa interrompida." }
  }
  if (fusion?.phase === "promoting") {
    // promoção é one-shot (abort no-opa): não finge que parou — mesma copy do
    // stop da tray.
    return {
      ok: false,
      message: "Disputa promovendo o vencedor, aguarde concluir.",
    }
  }
  const c = useChat.getState().byId[convId]
  if (c?.finalizing) {
    return {
      ok: false,
      message: "O turno já está finalizando, não dá mais para interromper.",
    }
  }
  if (c?.running && c.runId) return { ok: true, message: "Turno interrompido." }
  if (c?.running) {
    return {
      ok: false,
      message:
        "Não consegui interromper este turno pelo celular. Veja o app no Mac.",
    }
  }
  return { ok: false, message: "O turno já não estava em execução." }
}

/** Erro de ação de card vinda do celular (S4.6): o 202 já saiu, então a
 *  resposta honesta volta pelo MESMO envelope do send_message quando o card
 *  TEM conversa — notice persistido + ping, o refetch mostra o motivo. Card
 *  SEM conversa não tem envelope hoje (gap documentado, sem estado novo de
 *  aviso transitório no snapshot): fica console.warn + aviso nativo no
 *  desktop; o celular percebe pelo board que nada mudou. */
async function reportCardActionError(
  cardId: string,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err)
  console.warn("[companion] ação de card falhou:", cardId, message)
  const card = useCards.getState().all.find((c) => c.id === cardId)
  if (card?.conversationId) {
    const convId = card.conversationId
    await useChat.getState().ensureConversationLoaded(card.projectId, convId)
    useChat.getState().handleEvent(convId, { type: "notice", message })
    // mesma disciplina D1 do send_message: ping só DEPOIS do UPSERT commitar.
    await useChat.getState().persist(convId)
    pingConvUpdated(convId)
    return
  }
  void nativeNotify("Companion", `Ação de card do celular falhou: ${message}`)
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
      // veredito ANTES do abort (depois o status já mudou); o abort continua
      // incondicional — parar é sempre gesto seguro (no-op se nada roda).
      const wasRunning =
        useMission.getState().byConv[convId]?.status === "running"
      useMission.getState().abort(convId)
      const actionId = str(p.actionId)
      if (actionId) {
        pushActionResult({
          actionId,
          kind: "stop_mission",
          ok: wasRunning,
          message: wasRunning
            ? "Missão interrompida."
            : "A missão já não estava em execução.",
          convId,
        })
      }
      return
    }
    case "stop_turn": {
      const convId = str(p.convId)
      if (!convId) return
      // C2 — mesma semântica/copy do Stop do app, inclusive "finalizando não
      // é interrompível". O veredito sai ANTES (cancelDeskTurn muda o estado);
      // o cancel continua incondicional (comportamento de sempre, é no-op
      // seguro quando não há o que parar).
      const verdict = stopTurnVerdict(convId)
      await cancelDeskTurn(convId)
      const actionId = str(p.actionId)
      if (actionId) {
        pushActionResult({ actionId, kind: "stop_turn", ...verdict, convId })
      }
      return
    }
    case "send_message": {
      // C3 — veredito honesto de volta pro celular (fecha o furo registrado na
      // revisão C2): com actionId, TODO desfecho vira action-result — recusa
      // com motivo legível, aceite com o convId REAL (a página sem conversa
      // resolvida adota o fio na hora). Sem actionId (página antiga), o
      // comportamento pré-existente segue intacto (rejeição sobe pro catch do
      // listener → aviso nativo no desktop).
      const actionId = str(p.actionId)
      const fail = (message: string): void => {
        console.warn("[companion] send_message recusado:", message)
        if (actionId) {
          pushActionResult({ actionId, kind: "send_message", ok: false, message })
        }
      }
      const projectId = str(p.projectId)
      const agent = str(p.agent)
      const text = str(p.text).trim()
      if (!projectId || !text || !OFFICE_AGENTS.includes(agent as OfficeAgentId)) {
        fail("Pedido malformado. Atualize a página do Companion e tente de novo.")
        return
      }
      const proj = useApp.getState().projects.find((pr) => pr.id === projectId)
      if (!proj) {
        fail("O projeto não existe mais no app.")
        return
      }
      const fleetAgent = agent as OfficeAgentId
      // P5: convId explícito ("abrir conversa" não-mesa no celular) SÓ vale se
      // a conversa pertence às metas do projeto — qualquer outro id cai na
      // conversa de MESA (nunca escreve numa conversa alheia/fantasma). As
      // guardas do sendFromDesk cuidam do resto: ensureConversationLoaded,
      // corrupt, missão rodando, e o agent TRAVADO da conversa VENCE o da ação.
      const wanted = str(p.convId)
      const metas = useChat.getState().conversationsByProject[projectId] ?? []
      const useWanted = !!wanted && metas.some((m) => m.id === wanted)
      const convId = useWanted
        ? wanted
        : await ensureDeskConversation(projectId, fleetAgent)
      // F-A (follow-up S0) — guarda de availability ANTES de despachar: CLI
      // ausente/deslogada não recebe turno. O POST /api/action já devolveu 202
      // (fire-and-forget), então a resposta honesta volta pro celular pelo
      // MESMO envelope do histórico: notice persistido na conversa + ping de
      // conv atualizada (a página refetcha e mostra o motivo). D3: a guarda
      // vale pro agent EFETIVO da conversa resolvida — numa conversa travada o
      // agent DELA vence o da ação (regra do sendFromDesk), e sem essa
      // resolução o toast do desktop fechado seria a única resposta. A mesa já
      // saiu carregada do ensureDeskConversation; o alvo explícito carrega
      // aqui antes de ler o estado.
      if (useWanted) {
        await useChat.getState().ensureConversationLoaded(projectId, convId)
      }
      const conv = useChat.getState().byId[convId]
      // pareceres de conselheiro (advice) NÃO travam o agent do 1º turno (E1).
      const locked = conv != null && hasExecutorTurn(conv.items)
      let effectiveAgent: string = locked ? conv.agent : fleetAgent
      // Preset da conversa manda no agent do 1º turno (mesma resolução do
      // sendFromDesk, inclusive a re-injeção D1: travada SEM resposta).
      if (conv?.presetId && (!locked || !hasAssistantReply(conv.items))) {
        try {
          const preset = await getAgentDef(
            useApp.getState().projects.find((p) => p.id === projectId)?.path ??
              null,
            conv.presetId,
          )
          if (preset) effectiveAgent = preset.backend
        } catch {
          // preset ilegível: o preflight fail-closed do sendFromDesk cobre.
        }
      }
      const dispatchBlock = dispatchBlockReason(
        effectiveAgent,
        useApp.getState().settings.detected ?? {},
      )
      if (dispatchBlock) {
        await useChat.getState().ensureConversationLoaded(projectId, convId)
        useChat.getState().handleEvent(convId, {
          type: "notice",
          message: dispatchBlock,
        })
        // D1: o ping só sai DEPOIS do UPSERT commitar — o refetch do celular
        // lê o SQLite, e conversa idle não gera ping novo depois deste.
        await useChat.getState().persist(convId)
        pingConvUpdated(convId)
        // C3 — além do notice no fio, o motivo volta como veredito direto
        // (a página mostra na hora, sem depender do refetch acertar a conversa).
        fail(dispatchBlock)
        return
      }
      // C3 — mesmo padrão do launch_task: o aceite (start/queued) responde o
      // celular na hora; rejeição interna do sendFromDesk NÃO pode escapar
      // quando há actionId (o celular está esperando o veredito). Sem
      // actionId, a exceção sobe como sempre (aviso nativo no desktop).
      let accepted = false
      try {
        await sendFromDesk({
          convId,
          projectId,
          projectPath: proj.path,
          agent: fleetAgent,
          text,
          attachments: uploadedAttachments(p),
          // onAccepted só viaja COM actionId: sem id não há veredito a devolver
          // e o shape da chamada fica idêntico ao pré-C3 (compat).
          ...(actionId
            ? {
                onAccepted: () => {
                  accepted = true
                  pushActionResult({
                    actionId,
                    kind: "send_message",
                    ok: true,
                    message: "Mensagem enviada.",
                    convId,
                    projectId,
                    agent: effectiveAgent,
                  })
                },
              }
            : {}),
        })
      } catch (e) {
        if (!actionId) throw e
        // aceito ⇒ o ok já saiu e o erro do TURNO aparece no próprio fio
        // (refetch do celular); não-aceito ⇒ o fail() abaixo devolve o motivo.
        console.warn("[companion] send_message: envio rejeitou:", e)
      }
      if (actionId && !accepted) {
        fail("O app não conseguiu iniciar o turno. Veja o desktop para detalhes.")
      }
      return
    }
    case "launch_task": {
      // C2 — lançar tarefa do celular: conversa NOVA pelos MESMOS stores do
      // composer (registerConversation → preset opcional → sendFromDesk; a
      // persona do Especialista entra pelo resolveFirstTurnPersona de sempre).
      // Fail-closed com motivo legível: o veredito volta pro aparelho pelo
      // action-result — o 202 do POST nunca vira sucesso fingido.
      const actionId = str(p.actionId)
      const fail = (message: string): void => {
        console.warn("[companion] launch_task recusado:", message)
        if (actionId) {
          pushActionResult({ actionId, kind: "launch_task", ok: false, message })
        }
      }
      const projectId = str(p.projectId)
      const agent = str(p.agent)
      const text = str(p.text).trim()
      if (
        !projectId ||
        !text ||
        !OFFICE_AGENTS.includes(agent as OfficeAgentId)
      ) {
        fail("Pedido malformado. Atualize a página do Companion e tente de novo.")
        return
      }
      const proj = useApp.getState().projects.find((pr) => pr.id === projectId)
      if (!proj) {
        fail("O projeto não existe mais no app.")
        return
      }
      // Especialista opcional: valida JÁ (arquivo legível no projeto) — o
      // preflight fail-closed do sendFromDesk revalida skills/policy depois.
      const presetId = str(p.presetId)
      let preset: { id: string; name: string; backend: string } | null = null
      if (presetId) {
        try {
          const def = await getAgentDef(proj.path, presetId)
          if (!def) {
            fail("O Especialista escolhido não está disponível neste projeto.")
            return
          }
          preset = { id: def.id, name: def.name, backend: def.backend }
        } catch {
          fail("Não consegui carregar o Especialista escolhido.")
          return
        }
      }
      // F-A — guarda de availability ANTES de criar qualquer coisa: o agent
      // EFETIVO é o backend do Especialista quando há um.
      const effectiveAgent = preset?.backend ?? agent
      const block = dispatchBlockReason(
        effectiveAgent,
        useApp.getState().settings.detected ?? {},
      )
      if (block) {
        fail(block)
        return
      }
      // Conversa nova SEM roubar a seleção do desktop (registerConversation é
      // a action feita p/ superfícies fora do ChatPanel). Título derivado do
      // prompt com a MESMA régua do deriveTitle do persist (44 chars).
      const flat = text.replace(/\s+/g, " ")
      const title = flat.length > 44 ? `${flat.slice(0, 44)}…` : flat
      const convId = crypto.randomUUID()
      try {
        await useChat
          .getState()
          .registerConversation(projectId, convId, title, effectiveAgent)
        await useChat.getState().ensureConversationLoaded(projectId, convId)
        if (preset) {
          await useChat.getState().setConversationPreset(convId, preset)
        }
      } catch (e) {
        console.warn("[companion] launch_task: criação da conversa falhou:", e)
        fail("Não consegui criar a conversa no app.")
        return
      }
      // O aceite (start/queued) responde o celular NA HORA; o await segura o
      // turno inteiro (mesmo padrão do send_message). Se o sendFromDesk
      // abortar numa guarda interna (preset quebrado, corrida), o onAccepted
      // nunca dispara e o fracasso volta honesto. Rejeição (ex.: DB falhou no
      // ensureConversationLoaded interno) NÃO pode escapar: sem o catch, o
      // fail() nunca rodaria e o celular só veria o timeout — revisão C2 §1.
      let accepted = false
      try {
        await sendFromDesk({
          convId,
          projectId,
          projectPath: proj.path,
          agent: agent as OfficeAgentId,
          text,
          attachments: uploadedAttachments(p),
          onAccepted: () => {
            accepted = true
            if (actionId) {
              pushActionResult({
                actionId,
                kind: "launch_task",
                ok: true,
                message: "Tarefa lançada.",
                convId,
                projectId,
                agent: effectiveAgent,
              })
            }
          },
        })
      } catch (e) {
        // aceito ⇒ o ok já saiu e o erro do TURNO aparece na própria conversa
        // (refetch do celular); não-aceito ⇒ o fail() abaixo devolve o veredito.
        console.warn("[companion] launch_task: envio rejeitou:", e)
      }
      if (!accepted) {
        fail("O app não conseguiu iniciar o turno. Veja o desktop para detalhes.")
      }
      return
    }
    case "dispatch_card": {
      // S4.6 — o CELULAR é o humano: o gate humano-only do board proíbe
      // sistema/agente despachando sozinho, não o dono no sofá. A ação passa
      // INTEIRA pelo useCards.dispatch — guardas intactas: backlog-only
      // (lança), anti-duplo-clique (Set em voo) e o fluxo normal de conversa
      // nova; a guarda de availability segue valendo no ENVIO do 1º turno
      // (o dispatch só cria e liga a conversa, não roda agent).
      const cardId = str(p.cardId)
      if (!cardId) {
        console.warn("[companion] dispatch_card malformado — ignorado", p)
        return
      }
      try {
        await useCards.getState().dispatch(cardId)
      } catch (err) {
        await reportCardActionError(cardId, err)
      }
      return
    }
    case "close_card": {
      // S4.6 — fechar card é o gesto humano terminal do board; o celular
      // conta como humano. `state` é enum FECHADO validado no Rust E aqui
      // (defesa em profundidade); a máquina de estados do closeCard decide o
      // resto (transição inválida vira erro reportado).
      const cardId = str(p.cardId)
      const state = str(p.state)
      if (!cardId || (state !== "done" && state !== "cancelled")) {
        console.warn("[companion] close_card malformado — ignorado", p)
        return
      }
      try {
        await useCards.getState().closeCard(cardId, state)
      } catch (err) {
        await reportCardActionError(cardId, err)
      }
      return
    }
    case "feedback_lesson": {
      // P6: 👍/👎 do item de turno concluído no celular — MESMO caminho do
      // ChatPanel (feedbackLesson → reinforceLessons das lições injetadas).
      const convId = str(p.convId)
      const verdict = str(p.verdict)
      if (!convId || (verdict !== "up" && verdict !== "down")) {
        console.warn("[companion] feedback_lesson malformado — ignorado", p)
        return
      }
      await feedbackLesson(convId, verdict)
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

/** Especialistas no snapshot (C2): garante os presets GLOBAIS carregados no
 *  store — headless, o CommandConsole (que faz o load no desktop) pode nunca
 *  montar. Só dispara quando o store ainda não carregou NADA (loaded false):
 *  nunca sobrescreve um load por-projeto já feito pela UI. Falhou → tenta de
 *  novo no próximo push. */
let specialistsRequested = false
function maybeLoadSpecialists(): void {
  if (specialistsRequested || usePresets.getState().loaded) return
  specialistsRequested = true
  void usePresets
    .getState()
    .load(null)
    .catch(() => {
      specialistsRequested = false
    })
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
    maybeLoadSpecialists()
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
    // S4.5 — board no snapshot: mutação de card (estado/estagnação) re-empurra.
    useCards.subscribe(() => schedulePush()),
    // C2 — Especialistas no snapshot: load/CRUD de persona re-empurra.
    usePresets.subscribe(() => schedulePush()),
  )

  let disposed = false
  listen<unknown>("companion://action", (e) => {
    handleCompanionAction(e.payload).catch((err) => {
      // rejeição aqui morreria muda (o 202 já saiu): loga e avisa o humano
      // pelo canal nativo — o celular percebe pela ausência de efeito.
      console.warn("[companion] ação do celular falhou:", err)
      void nativeNotify(
        "Companion",
        "Ação do celular falhou. Veja o app para detalhes.",
      )
    })
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
  specialistsRequested = false
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
  /** C4 — token de PAREAMENTO do QR (uso único, vida curta; rotaciona
   *  sozinho). A credencial definitiva de cada aparelho nunca sai por aqui. */
  pairingToken: string | null
  /** Nº de dispositivos (sockets WS) conectados agora. */
  connectedCount: number
}

/** C4 — aparelho pareado (a credencial NUNCA viaja; só metadados). */
export interface CompanionDeviceInfo {
  id: string
  name: string
  /** Epoch ms do aceite. */
  pairedAt: number
  /** Epoch ms da última requisição autenticada; null = nunca visto pós-boot. */
  lastSeenAt: number | null
}

/** C4 — pedido de pareamento aguardando o gesto humano. */
export interface CompanionPendingPair {
  id: string
  name: string
  requestedAt: number
}

export interface CompanionDevicesInfo {
  devices: CompanionDeviceInfo[]
  pending: CompanionPendingPair[]
  /** true = o token único pré-v2 ainda existe (aparelhos antigos com acesso). */
  legacyActive: boolean
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

/** C4 — aparelhos pareados + pedidos aguardando aceite (null fora do Tauri). */
export async function companionDevices(): Promise<CompanionDevicesInfo | null> {
  if (!isTauri()) return null
  try {
    return await invoke<CompanionDevicesInfo>("companion_list_devices")
  } catch {
    return null
  }
}

/** C4 — GESTO HUMANO do pareamento v2: aceitar cunha o token definitivo do
 *  aparelho (até aqui ele não existe); recusar mata o pedido. */
export async function decideCompanionPairing(
  id: string,
  accept: boolean,
): Promise<void> {
  await invoke("companion_pair_decide", { id, accept })
}

/** C4 — revogação INDIVIDUAL: o aparelho cai no 401 e limpa o storage (C1). */
export async function revokeCompanionDevice(id: string): Promise<void> {
  await invoke("companion_revoke_device", { id })
}

/** C4 — revoga o token ÚNICO legado (pré-v2), valendo na hora: os aparelhos
 *  pareados antes do v2 perdem o acesso; os v2 seguem intactos. */
export async function revokeLegacyCompanionToken(): Promise<void> {
  await invoke("companion_revoke_token")
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
