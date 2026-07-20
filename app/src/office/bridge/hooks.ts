// Hooks/seletores finos do office sobre os stores/lib do app. É o ÚNICO ponto
// da ui/ que "toca" useChat/useMission/useApp — a regra de camadas do §6 manda
// esse acesso viver no bridge/. Tudo aqui é leitura seletiva (byId[convId],
// drafts, gate) ou despacho pontual (setDraft, answerGate); NENHUM dado
// por-frame passa por aqui.
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useMission } from "@/store/mission"
import type { ConvState } from "@/store/chat"
import type { MissionGate, RecoveryChoice } from "@/lib/missionTypes"
import {
  AGENTS,
  agentDef,
  agentModels,
  defaultModelFor,
  type AgentModelOption,
} from "@/lib/agents"
import { isTauri, type ConversationMeta } from "@/lib/db"
import { buildExecutionPrompt } from "@/lib/planMode"
import type { OfficeAgentId } from "../engine/types"
import { DESK_TITLE_PREFIX } from "./send"
import { simProjects } from "./sim-data"

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
  return agentModels(agentId)
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

/** Estado da conversa da mesa. O streaming chega por aqui: o handleEvent do
 *  bridge/send.ts escreve em byId[convId] e o dock re-renderiza. */
export function useDeskConversation(
  convId: string | null,
): ConvState | undefined {
  return useChat((s) => (convId ? s.byId[convId] : undefined))
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
 *  em branco = o agente decide). */
export function answerDeskGate(convId: string, answers: string[]): void {
  useMission.getState().answerGate(convId, answers)
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
