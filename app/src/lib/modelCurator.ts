// Camada C da inteligência de modelos: CURADOR com gate humano.
// Roda no máx. 1x/semana (lastCuratorRun): pega o snapshot do catálogo
// (models.dev via Rust), filtra modelos NOVOS (release_date ≤ 60 dias) de
// anthropic/openai que ainda NÃO estão nos pickers nem em model_proposals,
// pede rótulo+descrição pro helper barato (MESMO caminho das sugestões:
// comando `suggest`, modelo haiku) e grava como status='proposed'. NADA entra
// no picker sem aprovação humana em Configurações ▸ Agents (gate → 'active',
// que o agentModels() mescla via cache de aprovados).

import { appDataDir } from "@tauri-apps/api/path"
import { generateUtilityText } from "@/lib/utility"
import {
  AGENTS,
  agentModels,
  setApprovedModels,
  type AgentModelOption,
} from "@/lib/agents"
import { getModelsCatalog, type CatalogModel } from "@/lib/catalog"
import { isTauri } from "@/lib/db"
import { listModelProposals, insertModelProposals } from "@/lib/modelLedger"
import { extractJson } from "@/lib/format"
import { useApp } from "@/store/app"
import { useNotifs } from "@/store/notifications"

/** Intervalo mínimo entre rodadas do curador (1x/semana). */
export const CURATOR_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
/** Janela de "modelo novo": release_date nos últimos N dias. */
export const CURATOR_WINDOW_DAYS = 60

/** Providers do catálogo cobertos → agent dono do picker. */
const PROVIDER_TO_AGENT: Record<string, "claude-code" | "codex"> = {
  anthropic: "claude-code",
  openai: "codex",
}
export const CURATED_AGENTS = ["claude-code", "codex"] as const

/** Reduz um id anthropic do catálogo ("claude-sonnet-4-5-20250929") ao alias
 *  simples que o Claude Code aceita em `--model` ("sonnet"). null = não reduz
 *  (família desconhecida → o value proposto vira o id completo). */
export function anthropicAlias(id: string): string | null {
  const lower = id.toLowerCase()
  if (!lower.startsWith("claude")) return null
  const m = lower.match(/opus|sonnet|haiku|fable/)
  return m ? m[0] : null
}

export interface CuratorCandidate {
  agent: "claude-code" | "codex"
  /** O que iria em `--model` (alias anthropic reduzido ou id openai direto). */
  value: string
  model: CatalogModel
}

/** Filtro PURO de candidatos: providers cobertos, release_date dentro da
 *  janela, fora dos pickers atuais (por value) e fora de model_proposals
 *  (qualquer status — dispensado não volta). `proposedKeys` = "agent:value". */
export function filterCandidates(
  catalog: CatalogModel[],
  now: number,
  pickerValues: Record<string, ReadonlySet<string>>,
  proposedKeys: ReadonlySet<string>,
): CuratorCandidate[] {
  const windowMs = CURATOR_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const out: CuratorCandidate[] = []
  const seen = new Set<string>()
  for (const m of catalog) {
    const agent = PROVIDER_TO_AGENT[m.provider]
    if (!agent) continue
    if (!m.release_date) continue // sem data → não dá pra afirmar que é novo
    const ts = Date.parse(m.release_date)
    if (Number.isNaN(ts) || now - ts > windowMs) continue
    const value =
      agent === "claude-code" ? (anthropicAlias(m.id) ?? m.id) : m.id
    const key = `${agent}:${value}`
    if (seen.has(key)) continue // dois releases da mesma família → 1 candidato
    if (pickerValues[agent]?.has(value)) continue // já está no picker
    if (proposedKeys.has(key)) continue // já proposto/ativo/dispensado
    seen.add(key)
    out.push({ agent, value, model: m })
  }
  return out
}

/** Prompt do curador: contexto de id+preços do catálogo, resposta JSON pura. */
export function buildCuratorPrompt(candidates: CuratorCandidate[]): string {
  const lines = candidates.map((c) => {
    const m = c.model
    return `- value: "${c.value}" · nome: ${m.name} (id ${m.id}) · entrada US$${m.input ?? "?"}/M tokens · saída US$${m.output ?? "?"}/M tokens · contexto ${m.context ?? "?"} tokens · lançado em ${m.release_date}`
  })
  return `Você cura o seletor de modelos de um cockpit de agents de código. Para CADA modelo abaixo, gere um rótulo curto (2–3 palavras) e uma descrição em pt-BR de ~8 palavras focada em custo/uso.

Modelos candidatos:
${lines.join("\n")}

Responda APENAS com um array JSON, um item por modelo, no formato:
[{"value":"<value exato acima>","label":"<rótulo curto>","description":"<~8 palavras, custo/uso>"}]
Nada além do JSON.`
}

export interface CuratorProposal {
  value: string
  label: string
  description: string
}

/** Valida o JSON do curador: array de {value,label,description} com strings e
 *  value ∈ candidatos conhecidos. Malformado/inesperado → [] (silêncio). */
export function parseCuratorProposals(
  raw: string,
  allowedValues: ReadonlySet<string>,
): CuratorProposal[] {
  const arr = extractJson<unknown>(raw, "array")
  if (!Array.isArray(arr)) return []
  const out: CuratorProposal[] = []
  const seen = new Set<string>()
  for (const it of arr) {
    if (typeof it !== "object" || it === null) continue
    const { value, label, description } = it as Record<string, unknown>
    if (
      typeof value !== "string" ||
      typeof label !== "string" ||
      typeof description !== "string"
    )
      continue
    const v = value.trim()
    const l = label.trim()
    if (!v || !l || !allowedValues.has(v) || seen.has(v)) continue
    seen.add(v)
    out.push({ value: v, label: l, description: description.trim() })
  }
  return out
}

/** Entrada do catálogo correspondente a uma proposta (pro preço na UI). Para o
 *  claude-code o value pode ser um alias — compara também pelo id reduzido. */
export function catalogEntryFor(
  catalog: CatalogModel[],
  agent: string,
  value: string,
): CatalogModel | undefined {
  if (agent === "claude-code")
    return catalog.find(
      (m) =>
        m.provider === "anthropic" &&
        (m.id === value || anthropicAlias(m.id) === value),
    )
  return catalog.find((m) => m.provider === "openai" && m.id === value)
}

/** Carrega os modelos ATIVOS (status='active') pro cache module-level que o
 *  agentModels() mescla no picker. Chamado no boot, após Aprovar e ao fim de
 *  uma rodada que promoveu.
 *
 *  Varre TODOS os agents do registry, não a dupla curada: desde o M3 quem entra
 *  no seletor também pode ter vindo da lista viva do próprio CLI, e um par de
 *  ids escrito à mão aqui faria a promoção de um terceiro motor sumir sem
 *  ninguém perceber. Agent sem linha ativa recebe [] (limpa o cache), que é o
 *  que faz "Tirar do seletor" ter efeito imediato. */
export async function reloadActiveProposals(): Promise<void> {
  if (!isTauri()) return
  const active = await listModelProposals("active")
  for (const def of AGENTS) {
    setApprovedModels(
      def.id,
      active
        .filter((p) => p.agent === def.id)
        .map(
          (p): AgentModelOption => ({
            value: p.value,
            label: p.label,
            description: p.description,
          }),
        ),
    )
  }
}

/** Rodada do curador (best-effort, self-gated). NUNCA roda com o helper global
 *  desligado (settings.helperModel null) — é um run LLM pago, opt-out claro. */
export async function runModelCurator(): Promise<void> {
  if (!isTauri()) return
  const { settings, setSettings, activeProjectId } = useApp.getState()
  if (!settings.helperModel) return // helper global OFF → curador nunca roda
  const now = Date.now()
  if (now - (settings.lastCuratorRun ?? 0) < CURATOR_INTERVAL_MS) return
  const catalog = await getModelsCatalog()
  if (catalog.length === 0) return // sem snapshot → tenta no próximo boot
  // Marca o run JÁ: mesmo com falha adiante, não martela o LLM a cada boot.
  setSettings({ lastCuratorRun: now })
  const proposals = await listModelProposals()
  const proposedKeys = new Set(proposals.map((p) => `${p.agent}:${p.value}`))
  const pickerValues = Object.fromEntries(
    CURATED_AGENTS.map((a) => [a, new Set(agentModels(a).map((o) => o.value))]),
  )
  const candidates = filterCandidates(catalog, now, pickerValues, proposedKeys)
  if (candidates.length === 0) return
  let raw: string
  try {
    // MESMO caminho de invocação das sugestões (comando `suggest`, claude -p
    // barato); cwd neutro = app_data_dir (existe sempre; nada de projeto).
    raw = await generateUtilityText({
      task: "model_curator",
      model: "haiku",
      cwd: await appDataDir(),
      prompt: buildCuratorPrompt(candidates),
    })
  } catch {
    return // best-effort: sem helper agora, tenta na próxima semana
  }
  const agentByValue = new Map(candidates.map((c) => [c.value, c.agent]))
  const parsed = parseCuratorProposals(raw, new Set(agentByValue.keys()))
  if (parsed.length === 0) return // resposta malformada → descarte silencioso
  await insertModelProposals(
    parsed.map((p) => ({ agent: agentByValue.get(p.value)!, ...p })),
  )
  useNotifs.getState().push({
    kind: "run_done",
    title: `🆕 ${parsed.length} ${parsed.length === 1 ? "modelo novo proposto" : "modelos novos propostos"}`,
    subtitle: "Revisar em Configurações ▸ Agents",
    projectId: activeProjectId ?? "",
  })
}
