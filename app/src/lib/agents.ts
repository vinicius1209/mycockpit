// Registry ÚNICO dos agents: ids, rótulos, modelos, esforços, default e
// capacidade de anexo. Os limites de anexo moram em lib/attachments.ts
// (espelham o backend), e as listas curadas de modelo em lib/curatedModels.ts,
// re-exportadas daqui.

import type { Destination } from "@/lib/types"
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
    // claude 2.1.266: não expõe sandbox de SO. Se ganhar sandbox de bash no
    // macOS, é este valor que muda.
    sandboxProprio: "nenhum",
    workMcp: true,
    workMcpGlobalEnv: false,
    // claude 2.1.280 (medido em 22/09/2026): `mcp__<servidor>` no
    // `--disallowedTools` tira TODAS as tools do servidor do `system/init`.
    runMcpDeny: true,
    mcpEscopo: "por-run",
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
    // `--add-dir` por pasta (adapters.rs).
    pastasExtras: true,
    // claude 2.1.220: rate_limits no stdin da statusline por turno (payload
    // real capturado 12/08/2026).
    usageWindow: "statusline",
    // …mas a statusline não roda em `-p`, e o app roda headless: o medidor do
    // claude vem da conta (GET /api/oauth/usage com o bearer do CLI).
    usagePoll: "oauth",
    // claude 2.1.220: hooks maduros, payloads reais capturados 12/08/2026
    // (fixtures em hook_sessions.rs).
    hooksStatus: true,
    // claude 2.1.220: PermissionRequest síncrono (docs 12/08/2026 + Xirp).
    hooksPermission: true,
    hookDialect: "claude-settings",
    // claude 2.1.220: sem subcomando nem lista de modelos em disco. Sem fonte
    // viva ⇒ null, e o catálogo models.dev manda.
    listsModels: null,
    // claude 2.1.220: `-p --output-format json` classifica sozinho (404 real
    // no slug inválido, contextWindow no sucesso — capturado 14/08/2026).
    modelSmoke: "claude-print-json",
    modeloLivre: true,
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
    // "default", não um pin: o Codex sabe o modelo dele da vez, e pinar é
    // assinar um nome que envelhece. Quem quer modelo fixo escolhe no seletor.
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
    // codex 0.153.2: `-s read-only` barra escrita no cwd, fora dele, em
    // `--add-dir`, pelo `apply_patch`, por python3/perl/cp e por processo
    // destacado. Mais apertado que a nossa denylist: dispensar o envelope
    // aperta em vez de afrouxar.
    sandboxProprio: "sistemaOperacional",
    workMcp: true,
    workMcpGlobalEnv: false,
    runMcpDeny: false,
    mcpEscopo: "por-run",
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
    // `--add-dir` como opção do `exec`, vale no resume.
    pastasExtras: true,
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
    // codex 0.147+: `model/list` no app-server devolve os slugs visíveis e
    // escondidos, com `upgrade` nos aposentados e a régua de esforço por
    // modelo. É esta lista, não o bundle, que monta o seletor do Codex.
    listsModels: "codex-app-server",
    // codex 0.147: `exec --json` distingue "o CLI não conhece o slug" (aviso
    // de metadata) de recusa do servidor (capturado 14/08/2026).
    modelSmoke: "codex-exec-json",
    modeloLivre: true,
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
    // agy 1.1.13: tem `--sandbox`, mas a fase 0 mediu o que ele faz quando
    // barra: exit 0, stdout vazio, stderr mudo. Finge que funcionou. Não é
    // garantia — é justamente quem PRECISA do envelope.
    sandboxProprio: "melhorEsforco",
    workMcp: true,
    workMcpGlobalEnv: true,
    runMcpDeny: false,
    mcpEscopo: "global",
    disputes: false,
    structuredOutput: true,
    reportsCost: false,
    cumulativeUsage: true,
    nativeCompact: false,
    // `--add-dir` por pasta.
    pastasExtras: true,
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
    modeloLivre: false,
  },
  {
    id: "opencode",
    label: "OpenCode",
    shortLabel: "OpenCode",
    kind: "agent",
    available: true,
    description: "Multi-provedor: reaproveita assinaturas por OAuth",
    caps: { image: true, pdf: false },
    models: OPENCODE_MODELS,
    efforts: OPENCODE_EFFORTS,
    defaultModel: "default",
    nativeSlash: false,
    nativeCommandSource: null,
    slashEmptyExtra: null,
    systemChannel: false,
    sessionResume: true,
    contextMcp: false,
    // opencode 1.18.21: zero menção a sandbox no `--help` (11/09/2026).
    // Sem fonte auditada, fail-closed.
    sandboxProprio: "nenhum",
    workMcp: false,
    workMcpGlobalEnv: false,
    runMcpDeny: false,
    mcpEscopo: "por-projeto",
    disputes: false,
    structuredOutput: true,
    reportsCost: true,
    cumulativeUsage: false,
    nativeCompact: false,
    // nenhum canal de pasta extra no `run` nem no ACP.
    pastasExtras: false,
    usageWindow: null,
    usagePoll: null,
    hooksStatus: false,
    hooksPermission: false,
    hookDialect: null,
    listsModels: "opencode-models",
    modelSmoke: "opencode-run-json",
    modeloLivre: false,
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
    // one-shot barato: não roda shell, não escreve, não confina.
    sandboxProprio: "nenhum",
    workMcp: false,
    workMcpGlobalEnv: false,
    runMcpDeny: false,
    mcpEscopo: "nenhum",
    disputes: false,
    structuredOutput: false,
    reportsCost: false,
    cumulativeUsage: false,
    nativeCompact: false,
    // sem motor, sem pasta.
    pastasExtras: false,
    usageWindow: null,
    usagePoll: null,
    hooksStatus: false,
    hooksPermission: false,
    hookDialect: null,
    listsModels: null,
    modelSmoke: null,
    modeloLivre: false,
  },
]

const BY_ID = new Map(AGENTS.map((a) => [a.id, a]))

export function agentDef(id: string): AgentDef | undefined {
  return BY_ID.get(id)
}

// Os seletores por capability ("quais motores têm X") moram em
// `lib/agentRoster.ts` — mesma regra, arquivo separado por causa da catraca.

// Disponibilidade e guarda de despacho moram em `lib/agentAvailability.ts`
// (catraca de tamanho); reexportadas aqui para nenhum chamador mudar.
export { availability, dispatchBlockReason, type Availability } from "./agentAvailability"

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

/** O que a lista viva de um motor rendeu: os modelos que ele conhece e, quando
 *  o dialeto diz, os esforços de cada um. Juntos porque vêm da mesma resposta:
 *  caches separados ofereceriam o esforço de um modelo que saiu da lista. */
export interface LiveModels {
  models: AgentModelOption[]
  /** Esforços POR modelo. Slug ausente = o dialeto não fala de esforço para
   *  ele, e a régua estática do registry continua valendo. */
  efforts: Map<string, AgentModelOption[]>
  /** Tudo que o CLI conhece, inclusive o que ele esconde do picker: slug
   *  escondido funciona quando escolhido e não pode ser tratado como
   *  inexistente. */
  known: Set<string>
}

// Cache da lista viva (o que o CLI respondeu). Presente, vence o registry
// estático em agentModels(). Setado só em effects e handlers, nunca em render.
const LIVE = new Map<string, LiveModels>()

/** Registra (ou limpa, com `null`) a lista viva de um agent. */
export function setLiveModels(id: string, live: LiveModels | null) {
  if (!live || live.models.length === 0) LIVE.delete(id)
  else LIVE.set(id, live)
}

// A derivação da lista viva mora em `lib/modelList.ts`; aqui só o cache, e a
// dependência vai num sentido só (registry → catálogo).

// Cache dos modelos que o curador propôs e você aprovou
// (model_proposals status='active'). Entram depois das opções estáticas e
// dinâmicas, sem duplicar value. Carregado no boot e após aprovar.
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
  // Slug que a lista viva não conhece deixa de ser oferecido, venha de onde
  // vier: oferecer o que só produz "model … is not recognized" é teatro. A
  // decisão da pessoa não é apagada (fica no ledger, e `retirementNotices`
  // avisa). Sem lista viva nada é filtrado: "não sei" nunca rebaixa.
  const ofertaveis = live
    ? aprovados.filter((o) => live.known.has(o.value))
    : aprovados
  return mergeModelOptions(
    dedupeModelOptions(live?.models ?? agentDef(id)?.models ?? []),
    ofertaveis,
  )
}

/** A régua de esforço, do modelo quando o CLI a declara e do registry quando
 *  não; sem `model`, a do motor. Por modelo porque o mesmo codex aceita
 *  `ultra` num modelo e recusa acima de `xhigh` em outro. */
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
