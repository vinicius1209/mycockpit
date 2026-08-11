// Hooks/seletores finos do office sobre os stores/lib do app. É o ÚNICO ponto
// da ui/ que "toca" useChat/useMission/useApp — a regra de camadas do §6 manda
// esse acesso viver no bridge/. Tudo aqui é leitura seletiva (byId[convId],
// drafts, gate) ou despacho pontual (setDraft, answerGate); NENHUM dado
// por-frame passa por aqui.
import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { useApp } from "@/store/app"
import { useChat, hasExecutorTurn } from "@/store/chat"
import { useMission } from "@/store/mission"
import { useSchedules } from "@/store/schedules"
import { fmtUntilShort, upcomingScheduled } from "@/lib/schedules"
import type { ChatItem, ConvState } from "@/store/chat"
import type {
  GateAnswer,
  MissionGate,
  MissionPhaseStatus,
  MissionRun,
  MissionStatus,
  RecoveryChoice,
} from "@/lib/missionTypes"
import { presentTool } from "@/lib/toolview"
import {
  AGENTS,
  agentCaps,
  agentDef,
  agentEfforts,
  agentModels,
  defaultModelFor,
  type AgentModelOption,
} from "@/lib/agents"
import { isTauri, type ConversationMeta } from "@/lib/db"
import { buildExecutionPrompt } from "@/lib/planMode"
import type { OfficeAgentId } from "@/lib/fleet/types"
import { DESK_TITLE_PREFIX } from "@/lib/fleet/send"
import { simProjects, simSchedules } from "./sim-data"

// Re-exports utilitários pra ui/ não importar lib do app diretamente.
export { fmtCost } from "@/lib/format"
export { isTauri as officeIsTauri } from "@/lib/db"
export type { ChatItem, ConvState } from "@/store/chat"
export type { MissionGate, RecoveryChoice } from "@/lib/missionTypes"
export type { AgentModelOption } from "@/lib/agents"

/** Nome de exibição ÚNICO do agent no office (cartão da mesa, dock e HUD).
 *  Fonte: `label` do registry lib/agents ("Claude Code", "Codex",
 *  "Antigravity") — o mesmo rótulo do resto do app (TitleBar/MessageList via
 *  lib/agent.agentLabel); o shortLabel ("agy") divergia do cartão da mesa. */
export function deskDisplayName(agent: string): string {
  return agentDef(agent)?.label ?? agent
}

/** Rótulo do agent pra ui/ — alias do nome único (mesa e dock nunca divergem). */
export function agentLabel(id: string): string {
  return deskDisplayName(id)
}

/** Agents selecionáveis no revezamento/recuperação da mesa: disponíveis e kind
 *  "agent" (exclui opencode/model "em breve" e o modelo direto). {id,label} pro
 *  seletor da UI — label = rótulo único do office (lib/agents). */
export function availableAgents(): { id: string; label: string }[] {
  return AGENTS.filter((a) => a.available && a.kind === "agent").map((a) => ({
    id: a.id,
    label: a.label,
  }))
}

/** Modelos de um agent pro seletor de recuperação/revezamento — reusa o registry
 *  (estáticos + dinâmicos do `agy models` + aprovados do curador). A 1ª opção é
 *  sempre "Padrão" (value "default" = deixa o agent escolher). */
export function modelsFor(agentId: string): AgentModelOption[] {
  return agentModels(agentId).map((option) =>
    option.value === "default" ? { ...option, pill: "Padrão" } : option,
  )
}

const OFFICE_EFFORT_LABELS: Record<string, string> = {
  default: "Padrão",
  minimal: "Mínimo",
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  xhigh: "Muito alto",
  max: "Máximo",
}

export function effortsFor(agentId: string): AgentModelOption[] {
  return agentEfforts(agentId).map((option) => {
    const label = OFFICE_EFFORT_LABELS[option.value] ?? option.label
    return { ...option, label, pill: label }
  })
}

/** Modelo pré-selecionado de um agent ("default" se nenhum) — semente do seletor
 *  de modelo do cabeçalho da mesa e do card de recuperação. */
export function defaultModelForAgent(agentId: string): string {
  return defaultModelFor(agentId)
}

/** Cor de identidade do agent em CSS var do tema — versão DOM do
 *  scene/logic.agentColor (mesma régua: claude=brass, codex=running,
 *  agy=success), pra retrato do dock e menu-balão sem hex duplicado. */
export function agentCssColor(agent: string): string {
  switch (agent) {
    case "claude-code":
      return "var(--brass)"
    case "codex":
      return "var(--st-running)"
    case "agy":
      return "var(--st-success)"
    default:
      return "var(--st-idle)"
  }
}

/** Projeto visto pelo office: o mínimo que planta + envio precisam. `path`
 *  vazio no browser puro (fixture O8 — lá não há turno real de qualquer
 *  forma). Estruturalmente compatível com OfficeProjectRef do layout. */
export type OfficeProject = {
  id: string
  name: string
  path: string
  color?: string | null
}

/** Projetos que viram salas: reais no Tauri, fixture no browser puro (O8). */
export function officeProjects(): OfficeProject[] {
  if (isTauri()) return useApp.getState().projects
  return simProjects.map((p) => ({ ...p, path: "" }))
}

/** Versão reativa (rebuild da planta quando a lista de projetos muda). */
export function useOfficeProjects(): OfficeProject[] {
  const appProjects = useApp((s) => s.projects)
  return isTauri() ? appProjects : simProjects.map((p) => ({ ...p, path: "" }))
}

export function officeProjectById(id: string): OfficeProject | undefined {
  return officeProjects().find((p) => p.id === id)
}

/** Chrome do dock (S2 da investigação de perf): visão DISCRETA da conversa da
 *  mesa — tudo que cabeçalho/composer/cards leem, SEM a identidade de `items`.
 *  Assinar o ConvState inteiro re-renderizava o dock TODO (RichSelect,
 *  composer…) a cada text_delta; aqui são escalares + refs estáveis entre
 *  deltas (pendingPlan/autoResume só trocam em transições) via useShallow ⇒
 *  re-render apenas em mudança discreta. A LISTA assina por conta própria
 *  (useDeskItems, no filho DockItemsList do DeskDock). */
export type DeskConvChrome = {
  /** Conversa carregada em byId (false = "Abrindo a conversa da mesa…"). */
  exists: boolean
  running: boolean
  finalizing: boolean
  corrupt: boolean
  /** Carregada e VAZIA (mostra os chips de sugestão). */
  empty: boolean
  /** Modelo/esforço travados (a conversa já tem itens). */
  locked: boolean
  reqModel: string | null
  effort: string | null
  startedAt: number | null
  pendingPlan: ConvState["pendingPlan"]
  autoResume: ConvState["autoResume"]
}

export function useDeskConvChrome(convId: string | null): DeskConvChrome {
  return useChat(
    useShallow((s): DeskConvChrome => {
      const c = convId ? s.byId[convId] : undefined
      return {
        exists: !!c,
        running: c?.running ?? false,
        finalizing: c?.finalizing ?? false,
        corrupt: c?.corrupt ?? false,
        // pareceres de conselheiro (advice) NÃO iniciam a conversa nem travam a
        // identidade do 1º turno (Especialistas E1) — o dock lê executorItems.
        empty: !!c && !hasExecutorTurn(c.items),
        locked: !!c && hasExecutorTurn(c.items),
        reqModel: c?.reqModel ?? null,
        effort: c?.effort ?? null,
        startedAt: c?.startedAt ?? null,
        pendingPlan: c?.pendingPlan,
        autoResume: c?.autoResume,
      }
    }),
  )
}

/** Itens da conversa da mesa — SÓ a lista do dock assina (o streaming troca a
 *  identidade a cada delta; o chrome fica de fora de propósito). */
export function useDeskItems(convId: string | null): ChatItem[] | undefined {
  return useChat((s) => (convId ? s.byId[convId]?.items : undefined))
}

/** Rascunho do composer da mesa — compartilhado com o ChatPanel via
 *  useChat.drafts (nunca se perde ao minimizar/trocar de superfície). */
export function useDeskDraft(convId: string | null): string {
  return useChat((s) => (convId ? (s.drafts[convId] ?? "") : ""))
}

export function setDeskDraft(convId: string, text: string): void {
  useChat.getState().setDraft(convId, text)
}

/** Gate humano da missão da conversa (card de perguntas no dock). Fonte única
 *  = useMission.byConv[convId].gate — sem fila duplicada (§4). */
export function useDeskGate(convId: string | null): MissionGate | null {
  return useMission((s) => (convId ? (s.byConv[convId]?.gate ?? null) : null))
}

/** Responde o gate e RETOMA a missão (answers[i] ↔ gate.questions[i];
 *  em branco = o agente decide). Aceita GateAnswer[] rico (texto + anexos, o
 *  card de decisão) ou string[] legado — o answerGate normaliza. */
export function answerDeskGate(
  convId: string,
  answers: GateAnswer[] | string[],
): void {
  useMission.getState().answerGate(convId, answers)
}

/** Capacidade de anexo do agent da PRÓXIMA fase (o destino dos anexos das
 *  respostas do gate) + rótulo pro aviso do chip. Sem gate/próxima fase ⇒
 *  nega tudo (o filtro REAL é do answerGate — descarta com notice). */
export function useDeskGateCaps(convId: string | null): {
  caps: { image: boolean; pdf: boolean }
  label: string
} {
  const agent = useMission((s) => {
    if (!convId) return null
    const run = s.byConv[convId]
    if (!run?.gate) return null
    return run.phases[run.gate.phase + 1]?.def.agent ?? null
  })
  return {
    caps: agentCaps(agent ?? ""),
    label: agent ? (agentDef(agent)?.label ?? agent) : "o próximo agent",
  }
}

/** Snapshot NÃO-reativo pro coordenador §5.4/Esc: existe draft? turno ativo?
 *  (running OU finalizing contam como turno — mesma régua do send). */
export function dockLeaveCtx(convId: string | null): {
  hasDraft: boolean
  turnActive: boolean
} {
  if (!convId) return { hasDraft: false, turnActive: false }
  const s = useChat.getState()
  const conv = s.byId[convId]
  return {
    hasDraft: (s.drafts[convId] ?? "").trim().length > 0,
    turnActive: !!conv && (conv.running || conv.finalizing),
  }
}

/** CTA do empty state: volta pro painel pra adicionar projeto ("painel" já
 *  existe na união hoje; "office" entra por fora, na lista fechada do §6.1). */
export function exitOfficeToPainel(): void {
  useApp.getState().setViewMode("painel")
}

/** Quadro de avisos: abre a view Agendado do app POR CIMA do office (o
 *  App.tsx esconde o canvas enquanto scheduledOpen — mesmo overlay da
 *  Sidebar). Fechar lá devolve o office intacto. */
export function openScheduledView(): void {
  useApp.getState().setScheduledOpen(true)
}

/** Item do balão do quadro de avisos: nome + "quando" curto (fmtUntilShort —
 *  mesma régua do badge da Sidebar). */
export type BoardScheduleItem = { id: string; name: string; when: string }

/** Os PRÓXIMOS agendamentos pro balão do quadro de avisos (máx. `max`).
 *  Tauri: useSchedules (mesmo dado da Sidebar — upcomingScheduled é o
 *  nextScheduled em lista); browser puro: fixture simSchedules (O8). O
 *  "quando" congela no momento em que o balão abre (o componente monta ao
 *  entrar em alcance) — não há tick por frame aqui. */
export function useBoardSchedules(max = 4): BoardScheduleItem[] {
  const schedules = useSchedules((s) => s.schedules)
  return useMemo(() => {
    const now = Date.now()
    const source = isTauri() ? schedules : simSchedules(now)
    return upcomingScheduled(source, max).map((s) => ({
      id: s.id,
      name: s.name,
      when: fmtUntilShort((s.nextRun as number) - now),
    }))
  }, [schedules, max])
}

/** Cauda (≤90 chars) do último texto do assistente ENQUANTO o turno roda —
 *  balão de streaming do dock minimizado. Seletor estreito POR VALOR: os
 *  overlays (Prompts) não assinam o ConvState inteiro (senão re-render a cada
 *  text_delta com o dock aberto). `enabled=false` (dock aberto) ⇒ null estável
 *  — o histórico do dock já mostra o stream. */
export function useDeskStreamSnippet(
  convId: string | null,
  enabled: boolean,
): string | null {
  return useChat((s) => {
    if (!enabled || !convId) return null
    const c = s.byId[convId]
    if (!c?.running) return null
    for (let i = c.items.length - 1; i >= 0; i--) {
      const it = c.items[i]
      if (it.kind === "text" && it.text) {
        const t = it.text.trim()
        return t.length > 90 ? `…${t.slice(-90)}` : t
      }
    }
    return null
  })
}

/** Título da conversa da mesa com HISTÓRICO (menu-balão: "Continuar · …").
 *  Mesma régua do ensureDeskConversation: meta.agent do agent E título
 *  "Mesa · …", a mais recente. Conversa carregada e VAZIA não conta como
 *  histórico. Seletor por VALOR (string|null) — sem objeto novo por render. */
export function useDeskContinueTitle(
  projectId: string,
  agent: OfficeAgentId,
): string | null {
  return useChat((s) => {
    const list = s.conversationsByProject[projectId] ?? []
    let best: ConversationMeta | null = null
    for (const m of list) {
      if (m.agent !== agent || !m.title?.startsWith(DESK_TITLE_PREFIX)) continue
      if (!best || m.updatedAt > best.updatedAt) best = m
    }
    if (!best) return null
    const loaded = s.byId[best.id]
    if (loaded && loaded.items.length === 0) return null
    return best.title
  })
}

/** Início do turno corrente da conversa (mini-status vivo do menu/dock).
 *  null = sem turno rodando. */
export function useDeskTurnStartedAt(convId: string | null): number | null {
  return useChat((s) => (convId ? (s.byId[convId]?.startedAt ?? null) : null))
}

/** A conversa está numa MISSÃO rodando? (menu-balão vira persona+Acompanhar). */
export function useDeskMissionRunning(convId: string | null): boolean {
  return useMission((s) =>
    convId ? s.byConv[convId]?.status === "running" : false,
  )
}

/** Mesma leitura do useDeskMissionRunning FORA do render (ações da ui/: tecla
 *  E, botão do menu-balão, rail). A ui/ não fala com os stores do app direto —
 *  passa por aqui, que os testes mocam. */
export function deskMissionRunning(convId: string | null): boolean {
  return convId
    ? useMission.getState().byConv[convId]?.status === "running"
    : false
}

/** A conversa EXISTE no store de chat? Leitura não-hook usada antes de a ui/
 *  adotar um convId vindo do snapshot: fora do Tauri o snapshot é fixture
 *  (sim-data) e os ids dela não existem em conversa nenhuma — carimbar um
 *  deles prenderia o dock no "Abrindo a conversa da mesa…". Falso ⇒ o dock
 *  segue pro fallback (ensureDeskConversation). */
export function deskConvExists(convId: string | null): boolean {
  return !!convId && !!useChat.getState().byId[convId]
}

/** A conversa tem uma RECUPERAÇÃO pendente? (uma fase da missão parou num limite
 *  recuperável e o motor aguarda a troca de agent). Espelha o gate: enquanto
 *  true a mesa "levanta a mão" no menu de proximidade (mesmo tratamento). */
export function useDeskMissionRecovery(convId: string | null): boolean {
  return useMission((s) => (convId ? !!s.byConv[convId]?.recovery : false))
}

/** Recuperação: aplica a escolha do usuário (novo agent/modelo/effort) e RE-RODA
 *  a fase que parou. Fonte única = useMission.resolveRecovery (§ motor). */
export function resolveDeskRecovery(
  convId: string,
  choice: RecoveryChoice,
): void {
  useMission.getState().resolveRecovery(convId, choice)
}

/** Recuperação: o usuário desistiu → a missão vai a error (abortRecovery). */
export function abortDeskRecovery(convId: string): void {
  useMission.getState().abortRecovery(convId)
}

// --- painel de missão no dock da mesa (task #14) ----------------------------

/** Fase resumida por VALOR pro painel de missão do DeskDock. */
export type DeskMissionPhaseView = {
  label: string
  agent: string
  status: MissionPhaseStatus
  costUsd: number
}

/** Tool-step recente da fase corrente (label curto do presentTool). */
export type DeskMissionStep = { label: string; done: boolean }

/** Resumo por VALOR da missão que a mesa hospeda — o que o painel compacto do
 *  DeskDock desenha (fases, atividade ao vivo, custo). Sem os ChatItem crus. */
export type DeskMissionView = {
  convId: string
  status: MissionStatus
  /** Índice da fase corrente CLAMPADO ao total (running: sempre válido). */
  current: number
  total: number
  /** Persona pt-BR da fase corrente ("planejador"/"executor"/"revisor"). */
  persona: string
  costTotal: number
  maxCostUsd: number | null
  phases: DeskMissionPhaseView[]
  /** Últimos ≤4 tool-steps da fase corrente (atividade ao vivo mini). */
  steps: DeskMissionStep[]
  /** O que está acontecendo agora (espelho do phaseActivity da timeline). */
  now: string
  /** Início da fase corrente (cronômetro), se já rodou. */
  startedAt: number | null
}

const DESK_MISSION_PERSONA: Record<string, string> = {
  planner: "planejador",
  executor: "executor",
  reviewer: "revisor",
}

/** Reduz o MissionRun ao que o painel do dock precisa (puro; os items da fase
 *  corrente viram ≤4 strings de tool-step — nunca vazam ChatItem crus). */
function buildDeskMissionView(convId: string, run: MissionRun): DeskMissionView {
  const total = run.phases.length
  const cur = Math.max(0, Math.min(run.current, total - 1))
  const phase = run.phases[cur]
  const items = phase?.items ?? []
  const tools = items.filter(
    (i): i is Extract<ChatItem, { kind: "tool" }> => i.kind === "tool",
  )
  const last = items[items.length - 1]
  const now =
    last?.kind === "tool"
      ? presentTool(last.name, last.input).label
      : last?.kind === "text"
        ? "redigindo resposta…"
        : tools.length > 0
          ? "trabalhando…"
          : "preparando…"
  const persona = phase?.def.persona ?? ""
  return {
    convId,
    status: run.status,
    current: cur,
    total,
    persona: DESK_MISSION_PERSONA[persona] ?? persona,
    costTotal: run.costTotal,
    maxCostUsd: run.maxCostUsd,
    phases: run.phases.map((p) => ({
      label: p.def.label,
      agent: p.def.agent,
      status: p.status,
      costUsd: p.costUsd,
    })),
    steps: tools.slice(-4).map((t) => ({
      label: presentTool(t.name, t.input).label,
      done: t.result != null,
    })),
    now,
    startedAt: phase?.startedAt ?? null,
  }
}

/** A missão que a MESA hospeda (desk.convId do snapshot durante fase de
 *  missão), resumida por VALOR: o seletor assina uma STRING (JSON) — os items
 *  da fase corrente coalescem a cada onProgress, e só uma mudança VISÍVEL do
 *  resumo re-renderiza o dock (mesma razão do useMissionTableSig). null =
 *  conversa sem missão (turno linear ou mesa ociosa). */
export function useDeskMissionView(convId: string | null): DeskMissionView | null {
  const sig = useMission((s) => {
    if (!convId) return null
    const run = s.byConv[convId]
    return run ? JSON.stringify(buildDeskMissionView(convId, run)) : null
  })
  return useMemo(
    () => (sig ? (JSON.parse(sig) as DeskMissionView) : null),
    [sig],
  )
}

/** Custo acumulado da missão em voo da conversa (menu-balão), ou null. */
export function useDeskMissionCost(convId: string | null): number | null {
  return useMission((s) => {
    if (!convId) return null
    const run = s.byConv[convId]
    return run && run.status === "running" ? run.costTotal : null
  })
}

/** Aprova o plano pendente da conversa da mesa — MESMOS passos do
 *  handleApprovePlan do ChatPanel (closure privada de lá): valida, monta o
 *  prompt de execução, limpa o pendingPlan e desliga o plan_first. O ENVIO
 *  fica com o chamador (sendFromDesk no dock). null = nada a aprovar. */
export function approveDeskPlan(convId: string): string | null {
  const c = useChat.getState().byId[convId]
  if (!c?.pendingPlan || c.running || c.finalizing) return null
  const prompt = buildExecutionPrompt(c.agent, c.pendingPlan.text)
  useChat.getState().clearPendingPlan(convId)
  useChat.getState().setPlanFirst(convId, false)
  return prompt
}

/** Descarta o plano pendente (mesma ação do "Descartar" do ChatPanel). */
export function discardDeskPlan(convId: string): void {
  useChat.getState().clearPendingPlan(convId)
}
