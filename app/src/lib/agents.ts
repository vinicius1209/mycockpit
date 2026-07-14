// Registry ÚNICO dos agents (fonte de verdade da UI: ids, rótulos, modelos,
// efforts, default e capacidade de anexo). Antes isto vivia espalhado em 5 lugares
// (lib/agent.ts AGENT_LABELS, store/fusion.ts AGENT_LABEL, FusionArena AGENTS,
// CommandConsole DESTINATIONS/MODELS/EFFORTS/DEFAULT_MODEL, attachments.ts AGENT_CAPS)
// e divergia em silêncio. Os limites de tamanho/contagem de anexo continuam em
// lib/attachments.ts (espelham o backend), aqui é só a IDENTIDADE do agent.

import type { Destination } from "@/lib/types"
import type { AgentProbe } from "@/lib/detect"

export interface AgentModelOption {
  value: string
  label: string
  /** Rótulo compacto exibido só no trigger (ver RichOption.pill). */
  pill?: string
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

// "opus[1m]" é a variante de contexto 1M do Claude Code: o CLI aceita
// `--model opus[1m]` e o init reporta `claude-opus-4-8[1m]`, então o anel de
// contexto (contextWindowFor) detecta o "1m" e mostra 1M em vez de 200k. Escolha
// por conversa: Opus normal = 200k (default do CLI), Opus 1M = janela grande.
const CLAUDE_MODELS: AgentModelOption[] = [
  { value: "default", label: "Padrão", pill: "modelo", description: "Deixa o Claude Code escolher" },
  { value: "fable", label: "Fable", description: "Topo de linha (Fable 5, ~2x o preço do Opus)" },
  { value: "opus", label: "Opus", description: "O mais capaz do dia a dia (contexto 200k)" },
  { value: "opus[1m]", label: "Opus 1M", description: "Opus com janela de 1M tokens" },
  { value: "sonnet", label: "Sonnet", description: "Rápido e equilibrado" },
  { value: "haiku", label: "Haiku", description: "Mais rápido e barato" },
]
const CODEX_MODELS: AgentModelOption[] = [
  { value: "default", label: "Padrão", pill: "modelo", description: "Deixa o Codex escolher" },
  { value: "gpt-5.6-sol", label: "Sol (5.6)", description: "Frontier da família 5.6 — o mais capaz" },
  { value: "gpt-5.6-terra", label: "Terra (5.6)", description: "Equilíbrio qualidade/custo da 5.6" },
  { value: "gpt-5.6-luna", label: "Luna (5.6)", description: "Leve e rápido, alto volume" },
  { value: "gpt-5.5", label: "gpt-5.5", description: "Geração anterior, ainda forte" },
  { value: "gpt-5.4", label: "gpt-5.4", description: "Equilibrado, metade do preço do 5.5" },
  { value: "gpt-5.3-codex", label: "gpt-5.3-codex", description: "Especializado em código, ótimo custo" },
  { value: "o3", label: "o3", description: "Raciocínio forte (legado)" },
]
const CLAUDE_EFFORTS: AgentModelOption[] = [
  { value: "default", label: "Padrão", pill: "effort", description: "Padrão do modelo" },
  { value: "low", label: "low", description: "Rápido, mais raso" },
  { value: "medium", label: "medium", description: "Equilíbrio" },
  { value: "high", label: "high", description: "Raciocina mais fundo" },
  { value: "xhigh", label: "xhigh", description: "Bem mais fundo" },
  { value: "max", label: "max", description: "Esforço máximo" },
]
// agy: o `value` É a string EXATA que o `agy --model` espera (verificado com
// `agy models`). "default" = deixa o agy escolher (Gemini 3.5 Flash). O effort já
// vem embutido no nome do modelo (Low/High), então o agy não tem seletor de effort.
const AGY_MODELS: AgentModelOption[] = [
  { value: "default", label: "Padrão", pill: "modelo", description: "Deixa o agy escolher (Gemini Flash)" },
  { value: "Gemini 3.5 Flash (Low)", label: "Flash", description: "Rápido e barato (Google)" },
  { value: "Gemini 3.1 Pro (High)", label: "Gemini Pro", description: "Mais capaz (Google)" },
  { value: "Claude Sonnet 4.6 (Thinking)", label: "Sonnet", description: "Claude via cota Google" },
  { value: "Claude Opus 4.6 (Thinking)", label: "Opus", description: "Claude mais capaz, via Google" },
]
const CODEX_EFFORTS: AgentModelOption[] = [
  { value: "default", label: "Padrão", pill: "effort", description: "Padrão do modelo" },
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
    id: "agy",
    label: "Antigravity",
    shortLabel: "agy",
    kind: "agent",
    available: true,
    description: "CLI do Google (cota Google)",
    caps: { image: false, pdf: false },
    models: AGY_MODELS,
    efforts: [],
    defaultModel: null,
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

/** Janela de contexto CONHECIDA do modelo da sessão (tokens). null = não sabe,
 *  e o anel não inventa porcentagem (honesto). O marcador "1m" do Claude
 *  ("claude-…[1m]") indica a janela de 1M. */
export function contextWindowFor(model: string | null): number | null {
  if (!model) return null
  const m = model.toLowerCase()
  if (m.includes("claude")) {
    return m.includes("1m") ? 1_000_000 : 200_000
  }
  return null
}

const BY_ID = new Map(AGENTS.map((a) => [a.id, a]))

export function agentDef(id: string): AgentDef | undefined {
  return BY_ID.get(id)
}

/** "ready"=usável · "installed-auth-unknown"=instalado, auth incerta (usável c/
 *  aviso) · "missing"=não instalado · "not-integrated"=o app não integra. */
export type Availability =
  | "ready"
  | "installed-auth-unknown"
  | "missing"
  | "not-integrated"

/** Compõe o registry ESTÁTICO (o app integra este agent?) com a detecção em
 *  RUNTIME (existe nesta máquina?). SEM snapshot → "ready": degrada ao
 *  comportamento atual (não bloqueia quem nunca rodou a detecção). O registry
 *  `AGENTS` segue sendo a fonte de verdade de identidade/capacidade. */
export function availability(
  id: string,
  detected: Record<string, AgentProbe>,
): Availability {
  const def = agentDef(id)
  if (!def || !def.available) return "not-integrated"
  const probe = detected[id]
  if (!probe) return "ready"
  if (!probe.installed) return "missing"
  return probe.auth === "ok" ? "ready" : "installed-auth-unknown"
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

// Cache module-level de modelos DINÂMICOS (descobertos em runtime, ex.: linhas
// do `agy models`). Quando presente pra um agent, ganha do registry estático em
// agentModels(). Setado só em effects/handlers (boot do App, "Verificar agora").
const DYNAMIC_MODELS = new Map<string, AgentModelOption[]>()

/** Registra (ou limpa, com []) os modelos dinâmicos de um agent. */
export function setDynamicModels(id: string, options: AgentModelOption[]) {
  if (options.length === 0) DYNAMIC_MODELS.delete(id)
  else DYNAMIC_MODELS.set(id, options)
}

/** Converte as linhas do `agy models` em opções de modelo. O `value` é a linha
 *  EXATA que o adapter passa em `agy --model` (mesmo contrato do AGY_MODELS
 *  estático). Preserva a opção "Padrão" na frente (sentinela do composer). */
export function agyModelOptions(lines: string[]): AgentModelOption[] {
  return [AGY_MODELS[0], ...lines.map((l) => ({ value: l, label: l }))]
}

export function agentModels(id: string): AgentModelOption[] {
  return DYNAMIC_MODELS.get(id) ?? agentDef(id)?.models ?? []
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
