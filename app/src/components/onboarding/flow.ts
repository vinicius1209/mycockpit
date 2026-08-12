// Núcleo PURO do onboarding (R2 do roadmap). Zero React, zero Tauri: sequência
// de passos com condicionais, contador, resolução de versão de fluxo, latch de
// fechamento e a regra do tema. Tudo o que decide fica aqui para ser testado
// sem montar tela.
//
// Tese: onboarding INSTALA CAPACIDADES. Passo que não instala nada nesta
// máquina não vira bolinha morta, ele SOME do contador (regra do Orca).

import type { AgentDef } from "@/lib/agents"
import type { AgentProbe } from "@/lib/detect"
import { availability } from "@/lib/agents"

/** Passos declarados. A ordem aqui é a ordem na tela. */
export type StepId = "agents" | "theme" | "notifications"

/** O que a máquina permite. Só condições SÍNCRONAS e baratas entram aqui: o
 *  contador não pode mudar no meio do fluxo (§5.3 do STYLEGUIDE, "CTA só
 *  depois do estado assentar" — um "1 de 3" que vira "1 de 2" é a mesma
 *  mentira). Probe assíncrono (detecção de CLI, permissão do SO) alimenta o
 *  CONTEÚDO do passo, nunca a existência dele. */
export interface FlowConditions {
  /** A plataforma entrega notificação de SO (fora do app empacotado: não). */
  canNotify: boolean
}

interface StepDef {
  id: StepId
  when: (c: FlowConditions) => boolean
}

const STEPS: StepDef[] = [
  { id: "agents", when: () => true },
  { id: "theme", when: () => true },
  { id: "notifications", when: (c) => c.canNotify },
]

/** Versão do FLUXO (não do app). Bump = a sequência mudou o suficiente pra que
 *  um `lastCompletedStep` antigo aponte pro passo errado; a retomada volta pro
 *  começo em vez de pular capacidade nova.
 *
 *  DIVERGÊNCIA deliberada do Orca: eles remapeiam índice a índice por versão
 *  (uma tabela de migração que cresce a cada bump); com 3 passos, voltar ao
 *  começo custa menos que manter a tabela e nunca pula capacidade nova. O que
 *  NÃO divergimos: versão de fluxo só decide ONDE retomar, nunca SE reabrir —
 *  quem já concluiu (settings.onboarded) segue concluído em qualquer versão. */
export const FLOW_VERSION = 1

/** Os passos que este usuário vê, nesta máquina, nesta ordem. */
export function visibleSteps(c: FlowConditions): StepId[] {
  return STEPS.filter((s) => s.when(c)).map((s) => s.id)
}

/** "N de M" humano (1-based). index fora da faixa é clampado: contador nunca
 *  mostra "0 de 3" nem "4 de 3". */
export function stepCounter(
  steps: readonly StepId[],
  index: number,
): { position: number; total: number } {
  const total = steps.length
  if (total === 0) return { position: 0, total: 0 }
  const clamped = Math.min(Math.max(index, 0), total - 1)
  return { position: clamped + 1, total }
}

/** true quando o índice é o ÚLTIMO passo visível (o que termina em ação). */
export function isLastStep(steps: readonly StepId[], index: number): boolean {
  return steps.length > 0 && index === steps.length - 1
}

// ---------------------------------------------------------------- persistência

/** Estado do onboarding, SEPARADO das settings do app: progresso de um fluxo
 *  não é preferência do usuário, e misturar os dois faria toda mudança de
 *  fluxo mexer no schema de settings. */
export interface OnboardingRecord {
  flowVersion: number
  /** Índice (0-based) do último passo CONCLUÍDO. -1 = nenhum. */
  lastCompletedStep: number
}

/** Onde retomar. Regras:
 *  - sem registro → começa do zero;
 *  - registro de OUTRA versão de fluxo → começa do zero (os índices antigos não
 *    correspondem aos passos de agora);
 *  - registro válido → o passo seguinte ao último concluído, clampado no
 *    último visível (fluxo que encolheu não deixa o usuário fora da faixa). */
export function resolveStartIndex(
  record: OnboardingRecord | null | undefined,
  total: number,
): number {
  if (total <= 0) return 0
  if (!record || record.flowVersion !== FLOW_VERSION) return 0
  const next = record.lastCompletedStep + 1
  return Math.min(Math.max(next, 0), total - 1)
}

/** Parse defensivo do que veio do disco. Qualquer coisa fora do shape vira
 *  null (= começa do zero), nunca um registro pela metade. */
export function parseRecord(raw: unknown): OnboardingRecord | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (typeof r.flowVersion !== "number" || typeof r.lastCompletedStep !== "number")
    return null
  if (!Number.isFinite(r.flowVersion) || !Number.isFinite(r.lastCompletedStep))
    return null
  return {
    flowVersion: r.flowVersion,
    lastCompletedStep: r.lastCompletedStep,
  }
}

// ------------------------------------------------------------------ latch

/** Latch de idempotência do FECHAMENTO. O fechamento grava estado e dispara
 *  ação (abrir o seletor de projeto); dois disparos (clique duplo, Cmd+Enter
 *  junto com o clique) abririam dois diálogos nativos. `attempt()` passa uma
 *  vez só; `release()` destrava para uma nova tentativa quando a gravação
 *  falhou (senão o usuário fica preso num wizard que não fecha). */
export interface CloseLatch {
  attempt: () => boolean
  release: () => void
  isClosed: () => boolean
}

export function createCloseLatch(): CloseLatch {
  let closed = false
  return {
    attempt: () => {
      if (closed) return false
      closed = true
      return true
    },
    release: () => {
      closed = false
    },
    isClosed: () => closed,
  }
}

// ------------------------------------------------------------------- tema

export type Theme = "dark" | "light"

/** Como o passo foi deixado. */
export type StepExit = "advance" | "back" | "skip"

/** Regra do tema (Orca): a seleção aplica NA HORA (preview ao vivo é o ponto do
 *  passo), mas quem PULA não escolheu nada, então volta o tema de entrada.
 *  Avançar e voltar confirmam a escolha: o usuário viu o preview e seguiu. */
export function themeAfterExit(
  exit: StepExit,
  entryTheme: Theme,
  currentTheme: Theme,
): Theme {
  return exit === "skip" ? entryTheme : currentTheme
}

// -------------------------------------------------------------- atalho

/** Cmd/Ctrl+Enter avança. Duas guardas, na ordem do Orca:
 *  1. campo editável em foco NÃO cede o atalho (nem o Enter puro nem o
 *     Cmd+Enter): quem está digitando é dono do próprio Enter;
 *  2. Enter puro nunca avança, em lugar nenhum. O modificador é obrigatório. */
export function shouldAdvance(e: {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  /** O foco está num input/textarea/contenteditable. */
  editableTarget?: boolean
}): boolean {
  if (e.editableTarget) return false
  if (e.key !== "Enter") return false
  return Boolean(e.metaKey || e.ctrlKey)
}

/** O alvo do evento é um campo editável? (guarda 1 do shouldAdvance) */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== "function") return false
  if (el.isContentEditable) return true
  return Boolean(el.closest("input, textarea, select, [contenteditable]"))
}

// ----------------------------------------------------------------- agentes

/** Divisão do passo 1: o que ESTA máquina tem em destaque, o resto atrás de
 *  "mostrar mais". Detectado = a CLI existe (auth incerta ainda é detectada;
 *  degradação honesta, o passo diz o que falta). Agent não integrado pelo app
 *  não entra em lista nenhuma (§5.1: capability ausente some com o controle). */
export function partitionAgents(
  defs: readonly AgentDef[],
  detected: Record<string, AgentProbe>,
): { found: AgentDef[]; others: AgentDef[] } {
  const found: AgentDef[] = []
  const others: AgentDef[] = []
  for (const d of defs) {
    if (d.kind !== "agent") continue
    const av = availability(d.id, detected)
    if (av === "not-integrated") continue
    // sem snapshot (nunca detectou) NÃO é destaque: destaque exige probe.
    if (detected[d.id]?.installed) found.push(d)
    else others.push(d)
  }
  return { found, others }
}

/** Pré-seleção do agent padrão: o PRIMEIRO detectado, na ordem do registry.
 *  null = nada detectado (o passo mostra o estado honesto e não escolhe por
 *  ninguém). Nunca reescreve uma escolha que o usuário já fez neste fluxo. */
export function preselectAgent(
  found: readonly AgentDef[],
  alreadyPicked: string | null,
): string | null {
  if (alreadyPicked && found.some((d) => d.id === alreadyPicked))
    return alreadyPicked
  return found[0]?.id ?? null
}

// ------------------------------------------------------------ notificações

/** Estado do passo 3, derivado do RESULTADO do envio de teste (o botão É a
 *  sonda: mandar mostra o diálogo do macOS e o retorno diz por onde saiu). */
export type NotifyState =
  | "unknown" // ninguém testou ainda
  | "testing"
  | "native" // saiu pelo plugin do SO, com o nome do Frota
  | "fallback" // saiu pelo osascript (chega como Script Editor)
  | "blocked" // nenhum caminho entregou
  | "unavailable" // fora do app empacotado

/** Espelha lib/notify.NotifyPath. Tipado solto de propósito: caminho novo do
 *  notify não pode quebrar o build do onboarding, vira "blocked" (pessimista,
 *  §6 do STYLEGUIDE: "não sei" nunca degrada pra sucesso). */
export function notifyStateFromPath(path: string): NotifyState {
  switch (path) {
    case "nativo":
      return "native"
    case "osascript":
      return "fallback"
    case "fora-do-app":
      return "unavailable"
    default:
      return "blocked"
  }
}

/** A frase honesta de cada desfecho do teste. */
export function notifyMessage(state: NotifyState): string | null {
  switch (state) {
    case "unknown":
    case "testing":
      return null
    case "native":
      return "Chegou. Os avisos do Frota estão liberados neste Mac."
    case "fallback":
      return "Chegou, mas atribuída ao Script Editor. O macOS não registrou o Frota no Centro de Notificações (build sem assinatura); o aviso funciona assim mesmo."
    case "blocked":
      return "Não chegou. Nem o caminho nativo nem o alternativo entregaram. O sino dentro do app e o ícone da bandeja continuam avisando."
    case "unavailable":
      return "Notificação de sistema só existe no app instalado."
  }
}
