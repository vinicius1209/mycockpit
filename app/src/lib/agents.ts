// Registry ÚNICO dos agents (fonte de verdade da UI: ids, rótulos, modelos,
// efforts, default e capacidade de anexo). Antes isto vivia espalhado em 5 lugares
// (lib/agent.ts AGENT_LABELS, store/fusion.ts AGENT_LABEL, FusionArena AGENTS,
// CommandConsole DESTINATIONS/MODELS/EFFORTS/DEFAULT_MODEL, attachments.ts AGENT_CAPS)
// e divergia em silêncio. Os limites de tamanho/contagem de anexo continuam em
// lib/attachments.ts (espelham o backend), aqui é só a IDENTIDADE do agent.
//
// As LISTAS CURADAS de modelo/effort e os remaps de valor legado moraram aqui
// até o arquivo estourar a guarda de tamanho; hoje vivem em lib/curatedModels.ts
// e são RE-EXPORTADAS daqui (quem já importava de "@/lib/agents" não mudou).

import type { Destination } from "@/lib/types"
import type { AgentProbe } from "@/lib/detect"
import {
  AGY_MODELS,
  CLAUDE_EFFORTS,
  CLAUDE_MODELS,
  OPENCODE_MODELS, OPENCODE_EFFORTS,
  CODEX_EFFORTS,
  CODEX_MODELS,
  type AgentModelOption,
} from "@/lib/curatedModels"

export type { AgentModelOption } from "@/lib/curatedModels"
export { normalizeAgyModel, normalizeModelValue } from "@/lib/curatedModels"
export { agentToolingCaps } from "@/lib/agentTooling"
import type { AgentDef } from "./agentDefinition"
export type { AgentDef } from "./agentDefinition"

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
    workMcp: true,
    workMcpGlobalEnv: false,
    disputes: true,
    // claude 2.1.220: `--output-format stream-json` emite evento por ação.
    structuredOutput: true,
    // o `result` traz `total_cost_usd` pronto ⇒ CostSource::Reported.
    reportsCost: true,
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
    // claude 2.1.220: não há subcomando de modelos nem lista oficial em disco
    // (`claude --help` verificado 14/08/2026). Sem fonte viva ⇒ null, e o
    // catálogo models.dev segue mandando (§M1 do plano previu exatamente isso).
    listsModels: null,
    // claude 2.1.220: `-p --output-format json` classifica sozinho (404 real
    // no slug inválido, contextWindow no sucesso — capturado 14/08/2026).
    modelSmoke: "claude-print-json",
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
    // "default" e não um pin: o Codex sabe qual é o modelo dele da vez, e
    // pinar aqui é assinar um nome que envelhece — este campo dizia
    // `gpt-5.6-sol` no dia em que o CLI já abria em `gpt-6-astra`. Quem quer um
    // modelo fixo escolhe no seletor (e a escolha trava na conversa); quem não
    // escolhe herda o default do CLI, que é o comportamento honesto.
    defaultModel: "default",
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
    workMcp: true,
    workMcpGlobalEnv: false,
    disputes: true,
    // codex 0.146: `exec --json` é JSONL de eventos (item por ferramenta).
    structuredOutput: true,
    // …mas não vem dólar: o custo do codex é ESTIMADO por tokens (o `~` do
    // fmtCost), nunca reportado pelo CLI.
    reportsCost: false,
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
    // codex 0.147: `model/list` no app-server read-only devolveu os 6 visíveis
    // (+2 hidden) e marcou gpt-5.4/gpt-5.4-mini com `upgrade` — aposentadoria
    // anunciada pelo próprio CLI (capturado 14/08/2026). Em 0.153.4 a mesma
    // chamada trouxe 8 slugs com `gpt-6-astra` como default e a régua de
    // esforço POR modelo (fixture em src-tauri/fixtures) — é esta lista, e não
    // o bundle, que monta o seletor do Codex.
    listsModels: "codex-app-server",
    // codex 0.147: `exec --json` distingue "o CLI não conhece o slug" (aviso
    // de metadata) de recusa do servidor (capturado 14/08/2026).
    modelSmoke: "codex-exec-json",
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
    // agy 1.1.13 (medido 14/08/2026, evidência campo a campo em AGY_CAPS):
    // `--conversation <ID>` retoma, o `-p` é `--output-format stream-json` com
    // um step por ação, e o `result.usage` é o acumulado da CONVERSA (ADR-033).
    sessionResume: true,
    contextMcp: false,
    workMcp: true,
    workMcpGlobalEnv: true,
    disputes: false,
    structuredOutput: true,
    reportsCost: false,
    cumulativeUsage: true,
    nativeCompact: false,
    // agy 1.1.13: `-p "/usage"` devolve `command.data` (grupos × buckets, com
    // fração, janela e reset) e não gasta turno nenhum. Medido 16/08/2026.
    usageWindow: "print",
    usagePoll: "print",
    // agy 1.1.12: grupos nomeados em ~/.gemini/config/hooks.json (doc
    // embarcada + grupo vivo do Orca, 12/08/2026); Stop só roda ≥1.1.10 e o
    // instalador Rust confere a versão.
    hooksStatus: true,
    // agy 1.1.12: permissão via PreToolUse.decision (doc embarcada).
    hooksPermission: true,
    hookDialect: "agy-config-hooks",
    // agy 1.1.13: `agy models` lista 14 slugs em TSV (capturado 14/08/2026).
    listsModels: "agy-models",
    // agy 1.1.13: recusa slug desconhecido LOCALMENTE, sem chamada e sem custo.
    modelSmoke: "agy-print-json",
  },
  {
    id: "opencode",
    label: "OpenCode",
    shortLabel: "OpenCode",
    kind: "agent",
    available: true,
    description: "Multi-provedor: reaproveita assinaturas por OAuth",
    caps: { image: false, pdf: false },
    models: OPENCODE_MODELS,
    efforts: OPENCODE_EFFORTS,
    defaultModel: "default",
    nativeSlash: false,
    nativeCommandSource: null,
    slashEmptyExtra: null,
    systemChannel: false,
    sessionResume: true,
    contextMcp: false,
    workMcp: false,
    workMcpGlobalEnv: false,
    disputes: false,
    structuredOutput: true,
    reportsCost: true,
    cumulativeUsage: false,
    nativeCompact: false,
    usageWindow: null,
    usagePoll: null,
    hooksStatus: false,
    hooksPermission: false,
    hookDialect: null,
    listsModels: "opencode-models",
    modelSmoke: "opencode-run-json",
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
    workMcp: false,
    workMcpGlobalEnv: false,
    disputes: false,
    structuredOutput: false,
    reportsCost: false,
    cumulativeUsage: false,
    nativeCompact: false,
    usageWindow: null,
    usagePoll: null,
    hooksStatus: false,
    hooksPermission: false,
    hookDialect: null,
    listsModels: null,
    modelSmoke: null,
  },
]

const BY_ID = new Map(AGENTS.map((a) => [a.id, a]))

export function agentDef(id: string): AgentDef | undefined {
  return BY_ID.get(id)
}

// Os seletores por capability ("quais motores têm X") moram em
// `lib/agentRoster.ts` — mesma regra, arquivo separado por causa da catraca.

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

/** O que a LISTA VIVA de um motor rendeu: os modelos que ele conhece agora e,
 *  quando o dialeto fala disso, os esforços que cada modelo aceita.
 *
 *  As duas metades andam JUNTAS de propósito. São derivadas da mesma resposta,
 *  e guardá-las em dois caches independentes é convidar o seletor a oferecer o
 *  esforço de um modelo que não está mais na lista do outro. */
export interface LiveModels {
  models: AgentModelOption[]
  /** Esforços POR modelo. Slug ausente = o dialeto não fala de esforço para
   *  ele, e a régua estática do registry continua valendo. */
  efforts: Map<string, AgentModelOption[]>
  /** TUDO que o CLI declarou conhecer, inclusive o que ele esconde do picker
   *  dele. "Conhecer" é mais largo que "oferecer" de propósito: um slug
   *  escondido funciona quando você o escolhe, e não pode ser tratado como
   *  inexistente. */
  known: Set<string>
}

// Cache module-level da lista VIVA (o que o CLI respondeu em runtime). Quando
// presente pra um agent, ganha do registry estático em agentModels(). Setado só
// em effects/handlers (boot do App, "Verificar agora"), nunca em render.
const LIVE = new Map<string, LiveModels>()

/** Registra (ou limpa, com `null`) a lista viva de um agent. */
export function setLiveModels(id: string, live: LiveModels | null) {
  if (!live || live.models.length === 0) LIVE.delete(id)
  else LIVE.set(id, live)
}

// (A DERIVAÇÃO mora em `lib/modelList.ts`: converter a lista viva de um CLI em
// opções do picker é trabalho do módulo da lista viva, não do registry. A
// dependência é só num sentido — registry → catálogo — e é por isso que aqui só
// mora o cache, nunca o parse.)

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
export function dedupeModelOptions(options: AgentModelOption[]): AgentModelOption[] {
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
  const live = LIVE.get(id)
  const aprovados = APPROVED_MODELS.get(id) ?? []
  // Slug que a lista viva NÃO conhece deixa de ser oferecido, venha ele de onde
  // vier. Foi assim que `gpt-5.6` e `gpt-realtime-2.1` (propostos pelo curador
  // a partir do catálogo de API, aprovados no gate) ficaram meses no seletor
  // sem o CLI aceitar nenhum dos dois: oferecer o que só produz "model … is not
  // recognized" é teatro, não oferta.
  //
  // A decisão da pessoa NÃO é apagada: a linha segue no ledger com o motivo, e
  // o aviso do sumiço sai por `retirementNotices`. Sem lista viva (motor sem
  // fonte, ou sonda que falhou) nada é filtrado — "não sei" nunca rebaixa.
  const ofertaveis = live
    ? aprovados.filter((o) => live.known.has(o.value))
    : aprovados
  return mergeModelOptions(
    dedupeModelOptions(live?.models ?? agentDef(id)?.models ?? []),
    ofertaveis,
  )
}

/** A régua de esforço, do modelo quando o CLI a declara e do registry quando
 *  não. O `model` é opcional porque nem toda superfície tem um escolhido (e
 *  "Padrão" não é modelo): sem ele, a régua é a do motor, como sempre foi.
 *
 *  Por que POR MODELO: em 09/09/2026 o mesmo codex aceitava `ultra` no
 *  gpt-6-astra e recusava acima de `xhigh` no gpt-5.5. Uma régua só por motor
 *  não podia estar certa nos dois, e o erro só aparecia quando o turno morria. */
export function agentEfforts(id: string, model?: string | null): AgentModelOption[] {
  const vivos = model ? LIVE.get(id)?.efforts.get(model) : undefined
  return vivos ?? agentDef(id)?.efforts ?? []
}
/** Modelo pré-selecionado de um agent ("default" se nenhum). */
export function defaultModelFor(id: string): string {
  return agentDef(id)?.defaultModel ?? "default"
}
/** Capacidade de anexo de um agent (fallback nega tudo). */
export function agentCaps(id: string): { image: boolean; pdf: boolean } {
  return agentDef(id)?.caps ?? { image: false, pdf: false }
}
