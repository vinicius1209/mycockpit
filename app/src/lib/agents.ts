// Registry ÚNICO dos agents (fonte de verdade da UI: ids, rótulos, modelos,
// efforts, default e capacidade de anexo). Antes isto vivia espalhado em 5 lugares
// (lib/agent.ts AGENT_LABELS, store/fusion.ts AGENT_LABEL, FusionArena AGENTS,
// CommandConsole DESTINATIONS/MODELS/EFFORTS/DEFAULT_MODEL, attachments.ts AGENT_CAPS)
// e divergia em silêncio. Os limites de tamanho/contagem de anexo continuam em
// lib/attachments.ts (espelham o backend), aqui é só a IDENTIDADE do agent.

import type { Destination } from "@/lib/types"

export interface AgentModelOption {
  value: string
  label: string
}

export interface AgentDef {
  id: string
  /** Rótulo longo ("Claude Code"), TitleBar, MessageList, DESTINATIONS, liga. */
  label: string
  /** Rótulo curto ("Claude"), candLabel do Fusion (desambigua repetidos). */
  shortLabel: string
  kind: "agent" | "model"
  available: boolean
  hint?: string
  /** Capacidade de anexo (espelha `supports_attachment` no trait Rust). */
  caps: { image: boolean; pdf: boolean }
  /** Opções de modelo (vazio = agent sem flag de modelo). 1ª = "default". */
  models: AgentModelOption[]
  /** Opções de effort (vazio = sem flag). 1ª = "default". */
  efforts: AgentModelOption[]
  /** Modelo pré-selecionado (o default observado). null = "default". */
  defaultModel: string | null
}

const CLAUDE_MODELS: AgentModelOption[] = [
  { value: "default", label: "modelo" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
]
const CODEX_MODELS: AgentModelOption[] = [
  { value: "default", label: "modelo" },
  { value: "gpt-5.5", label: "gpt-5.5" },
  { value: "o3", label: "o3" },
]
const CLAUDE_EFFORTS: AgentModelOption[] = [
  { value: "default", label: "effort" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
  { value: "max", label: "max" },
]
const CODEX_EFFORTS: AgentModelOption[] = [
  { value: "default", label: "effort" },
  { value: "minimal", label: "minimal" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
]

/** A liga de agents. Ordem = ordem de exibição no seletor de destino. */
export const AGENTS: AgentDef[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    shortLabel: "Claude",
    kind: "agent",
    available: true,
    hint: "Agent",
    caps: { image: true, pdf: true },
    models: CLAUDE_MODELS,
    efforts: CLAUDE_EFFORTS,
    defaultModel: "opus",
  },
  {
    id: "codex",
    label: "Codex",
    shortLabel: "Codex",
    kind: "agent",
    available: true,
    hint: "Agent",
    caps: { image: true, pdf: false },
    models: CODEX_MODELS,
    efforts: CODEX_EFFORTS,
    defaultModel: "gpt-5.5",
  },
  {
    id: "opencode",
    label: "OpenCode",
    shortLabel: "OpenCode",
    kind: "agent",
    available: false,
    hint: "em breve",
    caps: { image: false, pdf: false },
    models: [],
    efforts: [],
    defaultModel: null,
  },
  {
    id: "model",
    label: "Modelo direto",
    shortLabel: "Modelo direto",
    kind: "model",
    available: false,
    hint: "em breve",
    caps: { image: false, pdf: false },
    models: [],
    efforts: [],
    defaultModel: null,
  },
]

const BY_ID = new Map(AGENTS.map((a) => [a.id, a]))

export function agentDef(id: string): AgentDef | undefined {
  return BY_ID.get(id)
}

/** Destinos do console de comando (deriva direto do registry). */
export const DESTINATIONS: Destination[] = AGENTS.map((a) => ({
  id: a.id,
  label: a.label,
  kind: a.kind,
  available: a.available,
  hint: a.hint,
}))

/** Agents selecionáveis na liga do Fusion (disponíveis + kind agent). */
export const LEAGUE_AGENTS = AGENTS.filter(
  (a) => a.available && a.kind === "agent",
)

/** Destinos da liga (subconjunto de DESTINATIONS), p/ o AgentSelect na Arena. */
export const LEAGUE_DESTINATIONS: Destination[] = DESTINATIONS.filter(
  (d) => d.available && d.kind === "agent",
)

export function agentModels(id: string): AgentModelOption[] {
  return agentDef(id)?.models ?? []
}
export function agentEfforts(id: string): AgentModelOption[] {
  return agentDef(id)?.efforts ?? []
}
/** Modelo pré-selecionado de um agent ("default" se nenhum). */
export function defaultModelFor(id: string): string {
  return agentDef(id)?.defaultModel ?? "default"
}
/** Capacidade de anexo de um agent (fallback nega tudo). */
export function agentCaps(id: string): { image: boolean; pdf: boolean } {
  return agentDef(id)?.caps ?? { image: false, pdf: false }
}
