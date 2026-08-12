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
  /** Capacidade de anexo. ⚠️ FONTE DUPLICADA: o gate REAL é
   *  `supports_attachment` no trait Rust (adapters.rs) — é ele que decide o que
   *  o agent recebe. Este espelho existe porque a UI precisa validar o anexo
   *  ANTES do envio (chip vermelho, bloqueio). Mexeu num, mexa no outro: ligar
   *  só o Rust faz o front bloquear o que o backend aceitaria (e vice-versa,
   *  pior: o chip promete e o anexo é descartado no spawn). */
  caps: { image: boolean; pdf: boolean }
  /** Opções de modelo (vazio = agent sem flag de modelo). 1ª = "default". */
  models: AgentModelOption[]
  /** Opções de effort (vazio = sem flag). 1ª = "default". */
  efforts: AgentModelOption[]
  /** Modelo pré-selecionado (o default observado). null = "default". */
  defaultModel: string | null
  // -- Espelho TS das Capabilities do Rust (adapters.rs, G1.2 do
  // capability-registry-plan). COMPORTAMENTO genérico da UI consulta estes
  // campos; o id do agent fica só pra identidade visual (logo/selo). Na
  // dúvida, false/null: degradação honesta, nunca prometer o que não sabe. --
  /** O CLI interpreta `/comando` nativamente: comando de fonte PRÓPRIA viaja
   *  cru; qualquer outra combinação expande app-side (lib/slashCommands). */
  nativeSlash: boolean
  /** Fonte NATIVA de comandos "/" deste motor (valor de SlashCommand.source).
   *  null = motor sem convenção própria (só a casa .mycockpit/commands). */
  nativeCommandSource: string | null
  /** Sufixo do empty-state do "/" citando a convenção nativa (copy pt-BR,
   *  inclui a pontuação final). null = a frase da casa termina em ponto. */
  slashEmptyExtra: string | null
  /** O CLI tem canal SYSTEM são por-run (espelho de `system_channel`, H1 do
   *  prompt-hygiene-plan): doutrina/persona viajam pelo canal, re-enviadas a
   *  cada spawn, NUNCA no corpo do prompt. Teste-gêmeo: agents.channels.test.ts
   *  ↔ `matriz_de_canais_por_agent` no Rust. */
  systemChannel: boolean
  /** Retoma sessão nativa (espelho de `session_resume`). false = todo turno é
   *  sessão fresca → memória sintética no prompt (transcript.ts) e doutrina em
   *  todo turno (doctrine.ts). Decide COMPORTAMENTO no lugar de `id === "agy"`
   *  (H5: agnóstico de nome). */
  sessionResume: boolean
  /** Recebe o MCP read-only `mc-context` (espelho de `context_mcp`). false =
   *  handoff degrada pra ponteiros de ARQUIVO (leitura direta), sem prometer
   *  um MCP que o motor não alcança. */
  contextMcp: boolean
  /** Pode disputar no Fusion: entra como complementar da liga default. O agy
   *  fica de fora porque o read-only dele é best-effort (candidato
   *  especulativo precisa de confinamento real, ADR do FusionRo). */
  disputes: boolean
  /** O usage do fim de turno vem ACUMULADO da thread, não do turno (espelho
   *  de `cumulative_usage`, ADR-033). O runner já normaliza para delta antes
   *  do evento chegar aqui; a UI consulta isto só pra saber de QUAL motor o
   *  histórico gravado ANTES da correção está superestimado (a manutenção de
   *  Configurações). Teste-gêmeo: agents.usage.test.ts ↔
   *  `matriz_cumulative_usage_por_agent` no Rust. */
  cumulativeUsage: boolean
  /** O CLI compacta a PRÓPRIA sessão em modo headless (espelho de
   *  `native_compact`, §7.1): o builtin /compactar manda um turno técnico com
   *  o texto literal "/compact" via resume. false = renovação de sessão com
   *  recap (transplante para si, lib/compact). Teste-gêmeo:
   *  agents.compact.test.ts ↔ `matriz_native_compact_por_agent` no Rust. */
  nativeCompact: boolean
  /** Fonte da JANELA DE USO do plano (% usado + reset — espelho de
   *  `usage_window`, adapters.rs): "statusline" = PUSH (o script instalado
   *  posta pro receptor local a cada turno), "rpc" = POLL (o app pergunta via
   *  probe read-only, política em lib/usageWindow). null = motor sem fonte
   *  auditada → a UI some com pill/toggle (4 camadas do Orca), nunca inventa
   *  percentual. Teste-gêmeo: agents.usageWindow.test.ts ↔
   *  `matriz_usage_window_por_agent` no Rust. */
  usageWindow: "statusline" | "rpc" | null
  /** Dialeto que o POLL do vigia usa pra PERGUNTAR a janela agora (espelho de
   *  `usage_window_poll`, adapters.rs): "oauth" = leitura da conta do
   *  provider, "rpc" = probe read-only do próprio CLI. null = o motor só
   *  recebe push (nada a perguntar). Separado de `usageWindow` porque os dois
   *  divergiram no claude: o que se INSTALA lá é a statusline, mas ela só
   *  dispara em sessão interativa (em `-p` o script nunca roda) e o app roda
   *  tudo em headless, então quem alimenta o medidor é a conta. Quem lê:
   *  duePollAgents em lib/usageWindow. Teste-gêmeo: agents.usageWindow.test.ts
   *  ↔ `matriz_usage_window_por_agent` no Rust. */
  usagePoll: "oauth" | "rpc" | null
  /** Emite eventos de ciclo de vida a scripts externos (espelho de
   *  `hooks_status`, hooks-plan H1): habilita a instalação de hooks em
   *  Configurações e a presença de sessões EXTERNAS no Painel/tray. false =
   *  o card nem mostra a opção; o watchdog segue existindo pra todos.
   *  Teste-gêmeo: agents.hooks.test.ts ↔ `matriz_de_hooks_por_agent`. */
  hooksStatus: boolean
  /** O prompt de permissão do CLI pode ser decidido por hook SÍNCRONO
   *  (espelho de `hooks_permission`, hooks-plan H2): a pendência aparece na
   *  UI/Companion e a decisão volta pro terminal. Timeout ⇒ ask (o prompt
   *  nativo aparece lá — nunca allow fantasma nem deny fabricado). */
  hooksPermission: boolean
  /** Dialeto de instalação/protocolo dos hooks (espelho de `hook_dialect`,
   *  adapters.rs). Consumido só como identidade informativa na UI (o merge
   *  real é do Rust). null = motor sem hooks. */
  hookDialect: "claude-settings" | "codex-hooks-json" | "agy-config-hooks" | null
}

// Aliases do Claude Code ("opus", "sonnet"…) resolvem NO SERVIDOR e mudam com
// versão do CLI/provider/entitlements — `opus` já resolveu p/ 4.7, depois 4.8,
// e desde o claude 2.1.219 (24/jul/2026) → **Opus 5** (novo default Opus). Pin
// confiável = ID COMPLETO. 1M de contexto é DEFAULT no Opus 5/4.8, Sonnet 5 e
// Fable 5 (sem beta header, preço padrão); o sufixo "[1m]" segue aceito e faz o
// init reportar "…[1m]", que o contextWindowFor usa pro anel mostrar 1M — por
// isso os pins abaixo carregam o sufixo.
const CLAUDE_MODELS: AgentModelOption[] = [
  { value: "default", label: "Padrão", pill: "modelo", description: "Deixa o Claude Code escolher" },
  { value: "claude-opus-5[1m]", label: "Opus 5", description: "Pin exato · o Opus mais novo, 1M nativo ($5/$25)" },
  { value: "claude-sonnet-5[1m]", label: "Sonnet 5", description: "Pin exato · 1M nativo, rápido e equilibrado" },
  { value: "fable", label: "Fable", description: "Topo de linha (Fable 5, ~2x o preço do Opus)" },
  { value: "claude-opus-4-8[1m]", label: "Opus 4.8", description: "Pin da geração anterior (1M nativo)" },
  { value: "opus", label: "Opus (alias)", description: "O CLI decide a versão (hoje → Opus 5), pode divergir" },
  { value: "sonnet", label: "Sonnet (alias)", description: "O CLI decide a versão, pode divergir" },
  { value: "haiku", label: "Haiku", description: "Mais rápido e barato (200k)" },
]
// Codex: sem família "-codex" desde o 5.4 (gpt-5.5-codex/5.6-codex NÃO existem);
// `gpt-5.6` puro é ID de API (rejeitado com auth ChatGPT) — os slugs do CLI são
// sol/terra/luna. Catálogo enumerável via `codex debug models` (JSON). Contexto
// DENTRO do Codex = 272k (na API os mesmos modelos têm 1M). gpt-5.3-codex e o3
// saíram do catálogo (400 com auth ChatGPT) — removidos do picker.
const CODEX_MODELS: AgentModelOption[] = [
  { value: "default", label: "Padrão", pill: "modelo", description: "Deixa o Codex escolher (hoje Sol)" },
  { value: "gpt-5.6-sol", label: "Sol (5.6)", description: "Frontier da família 5.6 · o mais capaz" },
  { value: "gpt-5.6-terra", label: "Terra (5.6)", description: "Equilíbrio qualidade/custo da 5.6" },
  { value: "gpt-5.6-luna", label: "Luna (5.6)", description: "Leve e rápido, alto volume" },
  { value: "gpt-5.5", label: "gpt-5.5", description: "Geração anterior, ainda forte" },
  { value: "gpt-5.4", label: "gpt-5.4", description: "Equilibrado, metade do preço do 5.5" },
  { value: "gpt-5.4-mini", label: "gpt-5.4-mini", description: "Pequeno e rápido, alto volume" },
]
const CLAUDE_EFFORTS: AgentModelOption[] = [
  { value: "default", label: "Padrão", pill: "effort", description: "Padrão do modelo" },
  { value: "low", label: "low", description: "Rápido, mais raso" },
  { value: "medium", label: "medium", description: "Equilíbrio" },
  { value: "high", label: "high", description: "Raciocina mais fundo" },
  { value: "xhigh", label: "xhigh", description: "Bem mais fundo" },
  { value: "max", label: "max", description: "Esforço máximo" },
]
// agy: o `value` É a string EXATA que o `agy --model` espera. Slugs só ficaram
// ESTÁVEIS na CLI 1.1.5 (release de 21/07/2026) — antes disso pinagem por nome
// era frágil por design. Lista completa espelha `agy models` 1.1.5 (11 slugs);
// o effort vem embutido no sufixo -high/-medium/-low, sem seletor separado. O
// default de fábrica não é contratual (o agy persiste o último modelo do picker
// no settings dele), então a descrição do "Padrão" não afirma qual modelo é.
const AGY_MODELS: AgentModelOption[] = [
  { value: "default", label: "Padrão", pill: "modelo", description: "Deixa o agy escolher" },
  { value: "gemini-3.6-flash-high", label: "Flash 3.6 (High)", description: "Mais capaz (Google)" },
  { value: "gemini-3.6-flash-medium", label: "Flash 3.6 (Med)", description: "Equilíbrio (Google)" },
  { value: "gemini-3.6-flash-low", label: "Flash 3.6 (Low)", description: "Rápido e barato (Google)" },
  { value: "gemini-3.5-flash-high", label: "Flash 3.5 (High)", description: "Geração anterior, fundo (Google)" },
  { value: "gemini-3.5-flash-medium", label: "Flash 3.5 (Med)", description: "Geração anterior (Google)" },
  { value: "gemini-3.5-flash-low", label: "Flash 3.5 (Low)", description: "Geração anterior, leve (Google)" },
  { value: "gemini-3.1-pro-high", label: "Gemini Pro (High)", description: "Mais capaz (Google)" },
  { value: "gemini-3.1-pro-low", label: "Gemini Pro (Low)", description: "Pro raso, mais rápido (Google)" },
  { value: "claude-sonnet-4-6", label: "Sonnet", description: "Claude via cota Google" },
  { value: "claude-opus-4-6-thinking", label: "Opus", description: "Claude mais capaz, via Google" },
  { value: "gpt-oss-120b-medium", label: "GPT-OSS 120B", description: "Modelo aberto da OpenAI via Google" },
]

/** Valores gravados por versões anteriores do app, antes de `agy models`
 * padronizar seus ids em kebab-case. Mantém conversas antigas executáveis. */
const LEGACY_AGY_MODELS: Record<string, string> = {
  "Gemini 3.5 Flash (Low)": "gemini-3.5-flash-low",
  "Gemini 3.1 Pro (High)": "gemini-3.1-pro-high",
  "Claude Sonnet 4.6 (Thinking)": "claude-sonnet-4-6",
  "Claude Opus 4.6 (Thinking)": "claude-opus-4-6-thinking",
}

/** Normaliza valores persistidos de uma conversa antes que cheguem ao adapter. */
export function normalizeAgyModel(model: string | null): string | null {
  if (!model || model === "default") return model
  return LEGACY_AGY_MODELS[model] ?? model
}

/** Modelos do codex que SAÍRAM do catálogo do CLI (400 com auth ChatGPT desde
 *  jul/2026). Remapeia pro vizinho vivo mais próximo — mesma disciplina do
 *  LEGACY_AGY_MODELS: valor persistido (settings/schedule/conversa) não pode
 *  virar erro fixo em todo envio. */
const LEGACY_CODEX_MODELS: Record<string, string> = {
  "gpt-5.3-codex": "gpt-5.5",
  o3: "gpt-5.5",
}

/** "opus[1m]" saiu do picker: o alias resolvia server-side pra versão da vez
 *  (4.7, depois 4.8, hoje Opus 5) e o pin exato é o conserto. Segue VÁLIDO no
 *  CLI, então o remap é escolha de produto: valor legado converge pro pin que o
 *  picker oferece HOJE como topo (Opus 5). */
const LEGACY_CLAUDE_MODELS: Record<string, string> = {
  "opus[1m]": "claude-opus-5[1m]",
}

/** Normalização de valor persistido de modelo, POR agent.
 *  Ponto único pra UI (display honesto) e pros despachos (schedule/hydrate)
 *  não reenviarem um id morto pra sempre. */
export function normalizeModelValue(
  agent: string,
  model: string | null,
): string | null {
  if (!model || model === "default") return model
  if (agent === "agy") return normalizeAgyModel(model)
  if (agent === "codex") return LEGACY_CODEX_MODELS[model] ?? model
  if (agent === "claude-code") return LEGACY_CLAUDE_MODELS[model] ?? model
  return model
}
// max/ultra são exclusivos da família 5.6 (ultra só Sol/Terra: dispara
// subagentes e consome quota agressivamente); 5.5/5.4 param em xhigh — o
// backend rejeita acima disso, o erro aparece no fio (honesto, sem mascarar).
const CODEX_EFFORTS: AgentModelOption[] = [
  { value: "default", label: "Padrão", pill: "effort", description: "Padrão do modelo" },
  { value: "minimal", label: "minimal", description: "Mínimo" },
  { value: "low", label: "low", description: "Rápido, mais raso" },
  { value: "medium", label: "medium", description: "Equilíbrio" },
  { value: "high", label: "high", description: "Raciocina mais fundo" },
  { value: "xhigh", label: "xhigh", description: "Bem mais fundo" },
  { value: "max", label: "max", description: "Fundo máximo (só família 5.6)" },
  { value: "ultra", label: "ultra", description: "Máximo + subagentes (Sol/Terra; pesa na cota)" },
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
    defaultModel: "claude-opus-5[1m]",
    nativeSlash: true,
    nativeCommandSource: "claude",
    slashEmptyExtra: ", em .claude/commands ou skills em .claude/skills.",
    // claude 2.1.219: --append-system-prompt documentado (canal dos nudges).
    systemChannel: true,
    sessionResume: true,
    contextMcp: true,
    disputes: true,
    // o `result` do stream-json traz usage e USD DO TURNO.
    cumulativeUsage: false,
    // claude 2.1.220: `-p --resume <sid> "/compact"` processa o comando em
    // modo print (empírico 04/08/2026, agent-runner §7.1).
    nativeCompact: true,
    // claude 2.1.220: rate_limits no stdin da statusline por turno (payload
    // real capturado 12/08/2026).
    usageWindow: "statusline",
    // …mas a statusline NÃO roda em `-p` (empírico 12/08/2026) e o app roda
    // tudo headless: quem sustenta o medidor do claude é a conta
    // (GET /api/oauth/usage com o bearer do próprio CLI).
    usagePoll: "oauth",
    // claude 2.1.220: hooks maduros, payloads reais capturados 12/08/2026
    // (fixtures em hook_sessions.rs).
    hooksStatus: true,
    // claude 2.1.220: PermissionRequest síncrono (docs 12/08/2026 + Xirp).
    hooksPermission: true,
    hookDialect: "claude-settings",
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
    defaultModel: "gpt-5.6-sol",
    // `codex exec` NÃO interpreta /prompt (a expansão é nossa, app-side) —
    // mas a convenção de descoberta ~/.codex/prompts existe e entra no "/".
    nativeSlash: false,
    nativeCommandSource: "codex",
    slashEmptyExtra: " ou prompts em ~/.codex/prompts.",
    // codex 0.146: `-c developer_instructions` existe mas não re-aplica no
    // `exec resume` (empírico 03/08/2026) → sem canal system são (§7.1).
    systemChannel: false,
    sessionResume: true,
    contextMcp: true,
    disputes: true,
    // codex 0.146: o `turn.completed.usage` é o total da THREAD (17494 →
    // 35005 em dois turnos triviais via resume, 04/08/2026) → ADR-033.
    cumulativeUsage: true,
    // codex 0.146: `/compact` é só do TUI; `codex exec` não expõe (help
    // verificado 04/08/2026) → /compactar renova a sessão com recap.
    nativeCompact: false,
    // codex 0.146: account/rateLimits/read no app-server read-only (provado
    // na mão 12/08/2026).
    usageWindow: "rpc",
    usagePoll: "rpc",
    // codex 0.146: hooks.json com schema idêntico ao do claude, feature
    // stable, vivo nesta máquina (Xirp/Orca — auditado 12/08/2026).
    hooksStatus: true,
    // codex 0.146: mesmo protocolo (wire schema no binário).
    hooksPermission: true,
    hookDialect: "codex-hooks-json",
  },
  {
    id: "agy",
    label: "Antigravity",
    shortLabel: "agy",
    kind: "agent",
    available: true,
    description: "CLI do Google (cota Google)",
    // Lê imagem e PDF pela ferramenta interna `view_file` (ponteiro no prompt +
    // --add-dir, igual ao Claude). Melhor esforço: já alucinou lendo PDF sem
    // sinalizar — ver AgyAdapter em adapters.rs e o ADR-020.
    caps: { image: true, pdf: true },
    models: AGY_MODELS,
    // O agy não tem eixo de esforço separado: ele vem embutido no id do modelo
    // (`gemini-3.6-flash-low`), por isso a lista é vazia — e por isso o seletor
    // de esforço NÃO deve ser renderizado pra ele (vinha como pílula vazia).
    efforts: [],
    defaultModel: null,
    nativeSlash: false,
    nativeCommandSource: null,
    slashEmptyExtra: null,
    systemChannel: false,
    sessionResume: false,
    contextMcp: false,
    disputes: false,
    cumulativeUsage: false,
    nativeCompact: false,
    usageWindow: null,
    usagePoll: null,
    // agy 1.1.12: grupos nomeados em ~/.gemini/config/hooks.json (doc
    // embarcada + grupo vivo do Orca, 12/08/2026); Stop só roda ≥1.1.10 e o
    // instalador Rust confere a versão.
    hooksStatus: true,
    // agy 1.1.12: permissão via PreToolUse.decision (doc embarcada).
    hooksPermission: true,
    hookDialect: "agy-config-hooks",
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
    nativeSlash: false,
    nativeCommandSource: null,
    slashEmptyExtra: null,
    systemChannel: false,
    sessionResume: false,
    contextMcp: false,
    disputes: false,
    cumulativeUsage: false,
    nativeCompact: false,
    usageWindow: null,
    usagePoll: null,
    hooksStatus: false,
    hooksPermission: false,
    hookDialect: null,
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
    nativeSlash: false,
    nativeCommandSource: null,
    slashEmptyExtra: null,
    systemChannel: false,
    sessionResume: false,
    contextMcp: false,
    disputes: false,
    cumulativeUsage: false,
    nativeCompact: false,
    usageWindow: null,
    usagePoll: null,
    hooksStatus: false,
    hooksPermission: false,
    hookDialect: null,
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

/** Motores cujo usage de fim de turno vem ACUMULADO da thread (ADR-033). Quem
 *  precisa falar desses motores na UI (a manutenção "recalcular custo
 *  estimado") pergunta AQUI em vez de escrever "codex" no meio do código. */
export function cumulativeUsageAgents(): AgentDef[] {
  return AGENTS.filter((a) => a.cumulativeUsage)
}

/** Motores com fonte de JANELA DE USO (medidor de rate limit). Quem monta a
 *  pill/popover/Configurações do medidor pergunta AQUI, nunca por nome — motor
 *  sem fonte nem aparece (1ª camada de esconder do Orca). */
export function usageWindowAgents(): AgentDef[] {
  return AGENTS.filter((a) => a.usageWindow != null)
}

/** Motores com hooks de ciclo de vida instaláveis (hooks-plan H1). Quem monta
 *  o bloco de Configurações e as superfícies de sessão externa pergunta AQUI,
 *  nunca por nome — motor sem hooks nem aparece (degradação honesta pro
 *  watchdog, que continua existindo pra todos). */
export function hooksAgents(): AgentDef[] {
  return AGENTS.filter((a) => a.hooksStatus)
}

/** "ready"=usável · "installed-not-authenticated"=instalado e DESLOGADO
 *  (probe.auth "missing" — NÃO usável até logar) · "installed-auth-unknown"=
 *  instalado, auth incerta (usável com aviso; cobre "unknown" e "na" — o agy
 *  não tem comando de auth e nunca reporta "missing", então "deslogado" não é
 *  prometido pra ele) · "missing"=não instalado · "not-integrated"=o app não
 *  integra. */
export type Availability =
  | "ready"
  | "installed-not-authenticated"
  | "installed-auth-unknown"
  | "missing"
  | "not-integrated"

/** Compõe o registry ESTÁTICO (o app integra este agent?) com a detecção em
 *  RUNTIME (existe nesta máquina?). SEM snapshot → "installed-auth-unknown":
 *  sem evidência a mesa não acende "pronto" (era "ready" e mentia quando o
 *  detect_agents falhava no boot), mas segue USÁVEL — degradação honesta, não
 *  bloqueio de quem nunca rodou a detecção. O registry `AGENTS` segue sendo a
 *  fonte de verdade de identidade/capacidade. */
export function availability(
  id: string,
  detected: Record<string, AgentProbe>,
): Availability {
  const def = agentDef(id)
  if (!def || !def.available) return "not-integrated"
  const probe = detected[id]
  if (!probe) return "installed-auth-unknown"
  if (!probe.installed) return "missing"
  if (probe.auth === "ok") return "ready"
  if (probe.auth === "missing") return "installed-not-authenticated"
  return "installed-auth-unknown"
}

/** Guarda de DESPACHO (follow-up F-A do Sprint 0): motivo pt-BR pra NÃO mandar
 *  um turno pro agent, ou null se o despacho pode seguir. Mandar turno pra CLI
 *  ausente/deslogada só rende erro cru no fim do run — melhor abortar ANTES do
 *  start com o motivo. "ready" e "installed-auth-unknown" passam (auth incerta
 *  é usável com aviso — degradação honesta, inclui o agy e o caso sem probe). */
export function dispatchBlockReason(
  id: string,
  detected: Record<string, AgentProbe>,
): string | null {
  const label = agentDef(id)?.label ?? id
  switch (availability(id, detected)) {
    case "missing":
      return `${label} não está instalado nesta máquina. Instale a CLI para enviar.`
    case "not-integrated":
      return `${label} ainda não é integrado ao app.`
    case "installed-not-authenticated":
      return `${label} está sem login. Entre pelo terminal da CLI e tente de novo.`
    case "ready":
    case "installed-auth-unknown":
      return null
  }
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
  const known = new Map(AGY_MODELS.map((option) => [option.value, option]))
  return dedupeModelOptions([
    AGY_MODELS[0],
    ...lines.map((value) => known.get(value) ?? { value, label: value }),
  ])
}

// Cache module-level de modelos PROPOSTOS pelo curador e APROVADOS pelo humano
// (model_proposals status='active'). Entram DEPOIS das opções estáticas/
// dinâmicas, sem duplicar value. Mesmo padrão do DYNAMIC_MODELS: carregado no
// boot (reloadActiveProposals) e recarregado após aprovar — só em effects/handlers.
const APPROVED_MODELS = new Map<string, AgentModelOption[]>()

/** Registra (ou limpa, com []) os modelos aprovados do curador p/ um agent. */
export function setApprovedModels(id: string, options: AgentModelOption[]) {
  if (options.length === 0) APPROVED_MODELS.delete(id)
  else APPROVED_MODELS.set(id, options)
}

/** Anexa `extra` ao fim de `base` SEM duplicar value (base vence). Puro; com
 *  `extra` vazio devolve `base` inalterado (referência estável). */
export function mergeModelOptions(
  base: AgentModelOption[],
  extra: AgentModelOption[],
): AgentModelOption[] {
  if (extra.length === 0) return base
  const seen = new Set(base.map((o) => o.value))
  const out = [...base]
  for (const o of extra) {
    if (seen.has(o.value)) continue
    seen.add(o.value)
    out.push(o)
  }
  return out
}

/** Remove valores repetidos sem mudar a prioridade: a primeira opção vence. */
function dedupeModelOptions(options: AgentModelOption[]): AgentModelOption[] {
  const seen = new Set<string>()
  for (const option of options) {
    if (seen.has(option.value)) {
      return options.filter((candidate, index) =>
        options.findIndex((first) => first.value === candidate.value) === index,
      )
    }
    seen.add(option.value)
  }
  return options
}

export function agentModels(id: string): AgentModelOption[] {
  return mergeModelOptions(
    dedupeModelOptions(DYNAMIC_MODELS.get(id) ?? agentDef(id)?.models ?? []),
    APPROVED_MODELS.get(id) ?? [],
  )
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
