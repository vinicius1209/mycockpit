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
  /** Linha secundária no seletor rico (padrão blocks.so ai-02). */
  description?: string
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
  /** Descrição curta (linha secundária no seletor rico). */
  description?: string
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
  { value: "default", label: "modelo", description: "Padrão do Claude Code" },
  { value: "opus", label: "Opus", description: "O mais capaz" },
  { value: "sonnet", label: "Sonnet", description: "Rápido e equilibrado" },
  { value: "haiku", label: "Haiku", description: "Mais rápido e barato" },
]
const CODEX_MODELS: AgentModelOption[] = [
  { value: "default", label: "modelo", description: "Padrão do Codex" },
  { value: "gpt-5.5", label: "gpt-5.5", description: "Mais capaz" },
  { value: "o3", label: "o3", description: "Raciocínio forte" },
]
const CLAUDE_EFFORTS: AgentModelOption[] = [
  { value: "default", label: "effort", description: "Padrão do modelo" },
  { value: "low", label: "low", description: "Rápido, mais raso" },
  { value: "medium", label: "medium", description: "Equilíbrio" },
  { value: "high", label: "high", description: "Raciocina mais fundo" },
  { value: "xhigh", label: "xhigh", description: "Bem mais fundo" },
  { value: "max", label: "max", description: "Esforço máximo" },
]
const CODEX_EFFORTS: AgentModelOption[] = [
  { value: "default", label: "effort", description: "Padrão do modelo" },
  { value: "minimal", label: "minimal", description: "Mínimo" },
  { value: "low", label: "low", description: "Rápido, mais raso" },
  { value: "medium", label: "medium", description: "Equilíbrio" },
  { value: "high", label: "high", description: "Raciocina mais fundo" },
  { value: "xhigh", label: "xhigh", description: "Bem mais fundo" },
]

/** A liga de agents. Ordem = ordem de exibição no seletor de destino. */
export const AGENTS: AgentDef[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    shortLabel: "Claude",
    kind: "agent",
    available: true,
    description: "CLI da Anthropic",
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
    description: "CLI da OpenAI",
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
    description: "Ainda não integrado",
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
    description: "Chamar um modelo sem agent",
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
  description: a.description,
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
