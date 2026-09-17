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
import type { CompanionDevicesInfo } from "@/lib/companionAparelhos"
import type { CompanionInfo } from "@/lib/companionEndereco"
import { listen } from "@tauri-apps/api/event"
import { AGENTS, availability } from "@/lib/agents"
import { projectForCwd, sessionPlace } from "@/lib/externalSessions"
import type { ApprovalData, QuestionData } from "@/lib/interaction"
import {
  isTauri,
  loadLedger,
  listRecentDeliveries,
} from "@/lib/db"
import { ledgerCostsForToday } from "@/lib/companionCosts"
export * from "@/lib/companionTypes"
import {
  EMPTY_EXTRAS,
  type CompanionAttention,
  type CompanionExtras,
  type CompanionMission,
  type CompanionQuestion,
  type CompanionRunning,
  type CompanionSnapshot,
  type CompanionSpecialist,
} from "@/lib/companionTypes"
import { useNotifs } from "@/store/notifications"
import { handleCompanionAction } from "@/lib/companionAction"
import { clearPings, pingConvUpdated } from "@/lib/companionPing"
import { turnosRecentes } from "@/lib/lastTurn"
import { fraseDoTurno } from "@/lib/turnReceipt"
import { nativeNotify } from "@/lib/notify"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { ownerByRunId, useInteractions } from "@/store/interactions"
import { useMission } from "@/store/mission"
import { usePresets } from "@/store/presets"
import { DESK_TITLE_PREFIX } from "@/lib/fleet/send"
import { projetosDoCompanion } from "@/lib/companionProjetos"
import { perfSpan } from "@/lib/fleet/perf"

// ─────────────────────────────────────────────────────────── shape do snapshot
// A onda 2 (página do celular) constrói EM CIMA deste shape — mudar é breaking.

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
  const currentTitleOf = (convId: string, projectId?: string) =>
    chat.conversationsByProject[projectId ?? projectOf(convId) ?? ""]?.find(
      (c) => c.id === convId,
    )?.title ??
    Object.values(chat.conversationsByProject).flat().find((c) => c.id === convId)
      ?.title ??
    null
  const titleOf = (convId: string): string => currentTitleOf(convId) ?? "Conversa"

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
      // Permissão de HOOK (H2): sessão EXTERNA do terminal — sem conversa
      // dona por desenho. O celular ainda precisa saber DE ONDE veio: motor
      // e projeto/pasta saem da origem do hook (nunca inventa conversa).
      const hook = d?.hook
      const hookPlace = hook
        ? sessionPlace({ cwd: hook.cwd ?? "" }, app.projects)
        : null
      attention.push({
        id: req.id,
        kind: "approval",
        convId,
        projectId:
          pid ??
          (hook
            ? (projectForCwd(hook.cwd ?? "", app.projects)?.id ?? null)
            : null),
        projectName:
          nameOf(pid) ?? (hookPlace ? `${hookPlace} (terminal)` : null),
        agent:
          phaseRun?.def.agent ??
          (convId
            ? (chat.byId[convId]?.agent ?? "")
            : (hook?.engine ?? "")),
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

  // O Board NÃO viaja pro celular (ADR-041): nem seção de card, nem card
  // estagnado em attention. O board saiu do desktop no ADR-040 por uso zero e
  // manter a única superfície viva no celular era assimetria — e fazia do
  // celular o único lugar do produto capaz de registrar uma entrega. O store
  // de cards segue vivo (fila da faixa, vigia), só não sai daqui.

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

  // ── custos: ledger de hoje (lib/companionCosts) + missões VIVAS (não-done
  // nunca entram no ledger; done viram delivery e já estão lá — dobraria). ──
  const { totalUsd: ledgerUsd, byProject, unpriced } = ledgerCostsForToday(extras.ledger)
  let totalUsd = ledgerUsd
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
  const projects = projetosDoCompanion({
    projects: app.projects,
    usableAgents,
    metasByProject: chat.conversationsByProject,
    prefixoDaMesa: DESK_TITLE_PREFIX,
    rodando: (id) => chat.byId[id]?.running ?? false,
    pedeVoce: new Set(attention.map((a) => a.convId).filter((id): id is string => !!id)),
  })

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
    lastTurns: turnosRecentes(useNotifs.getState().items, 5, currentTitleOf).map((t) => ({
      ...t,
      projectName: nameOf(t.projectId),
      frase: fraseDoTurno(t.receipt, t.ok),
    })),
    deliveries: extras.deliveries.map((d) => ({
      projectId: d.projectId,
      projectName: nameOf(d.projectId),
      task: d.task,
      agent: d.agent,
      costUsd: d.costUsd,
      createdAt: d.createdAt,
    })),
    costs: { totalUsd, byProject, unpriced },
    projects,
    specialists,
  }
}

// ─────────────────────────────────────────────────────── bridge (push + ações)

/** Coalescing do push: no máx. 1 invoke a cada 500ms (≤2Hz). */
const PUSH_MIN_INTERVAL_MS = 500
/** Cache do ledger/entregas: re-lê o DB no máx. a cada 30s. */
const EXTRAS_TTL_MS = 30_000

let started = false
let unsubs: (() => void)[] = []
let pushTimer: ReturnType<typeof setTimeout> | null = null
let lastPushAt = 0
let lastSentKey: string | null = null
let extrasCache: CompanionExtras = EMPTY_EXTRAS
let extrasAt = 0

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
    // O useCards NÃO é assinado (ADR-041): o board saiu do snapshot, então
    // mutação de card não muda nada que o celular veja.
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
  clearPings()
  metasRequested.clear()
  specialistsRequested = false
  lastPushAt = 0
  lastSentKey = null
  extrasCache = EMPTY_EXTRAS
  extrasAt = 0
}

// ─────────────────────────────── servidor (comandos Rust) + gate pelo setting



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
