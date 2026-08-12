import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"
import { setDynamicModels, agyModelOptions } from "@/lib/agents"

/** Espelha DetectedTool do Rust (detect.rs). auth: "ok"=logado · "missing"=
 *  instalado+deslogado · "unknown"=instalado+auth indeterminada · "na"=n/a.
 *  latest é POR CANAL do binário gerenciado (incidente do sucesso falso: a
 *  "última" vinha do npm, o binário era do brew com teto menor — botão
 *  "Atualizar" eterno). altLatest/altChannel = a última do OUTRO canal, só
 *  informação (trocar de canal é gesto do usuário). */
export interface DetectedTool {
  id: string // "claude-code" | "codex" | "agy" | "git" | "swiftc"
  installed: boolean
  version: string | null
  auth: "ok" | "missing" | "unknown" | "na"
  detail: string | null
  /** Última versão oficial DO CANAL do binário (null = indisponível/offline). */
  latest: string | null
  /** Canal da fonte do latest ("npm" | "homebrew"). */
  latestChannel: string | null
  altLatest: string | null
  altChannel: string | null
}

/** Snapshot leve por ferramenta, persistido em GlobalSettings.detected. */
export interface AgentProbe {
  installed: boolean
  version: string | null
  auth: "ok" | "missing" | "unknown" | "na"
  detail: string | null
  /** Última versão oficial DO CANAL do binário no momento da checagem. */
  latest: string | null
  latestChannel?: string | null
  altLatest?: string | null
  altChannel?: string | null
  checkedAt: number
}

/** Comando de update por agent (fallback pra "copiar e rodar à mão" quando o
 *  "Atualizar agora" não consegue). null = sem canal conhecido. */
export const UPDATE_COMMANDS: Record<string, string | null> = {
  "claude-code": "npm i -g @anthropic-ai/claude-code",
  codex: "brew upgrade codex",
  agy: null,
}

/** Como INSTALAR cada CLI, pra quem ainda não tem nenhuma (passo 1 do
 *  onboarding). Mesma natureza do UPDATE_COMMANDS acima: conhecimento de
 *  pacote é por-provider e mora neste módulo, nunca em código genérico.
 *  Ausente do mapa = sem receita conhecida (a UI diz isso em vez de chutar). */
export const INSTALL_COMMANDS: Record<string, string> = {
  "claude-code": "npm i -g @anthropic-ai/claude-code",
  codex: "brew install codex",
  agy: "https://antigravity.google/cli",
}

/** Comandos por agent×CANAL — espelho do plano por canal do update.rs (o
 *  módulo por-provider legítimo): a notificação de update sugere o comando do
 *  canal DETECTADO do binário, não o npm estático (incidente do "npm i" pra
 *  binário do brew). Conhecimento de pacote é por-provider, mora aqui. */
const CHANNEL_COMMANDS: Record<string, Record<string, string>> = {
  "claude-code": {
    npm: "npm i -g @anthropic-ai/claude-code@latest",
    // o cask chama-se `claude-code`, NÃO `claude` (ver update.rs).
    homebrew: "brew upgrade claude-code",
  },
  codex: {
    npm: "npm i -g @openai/codex@latest",
    homebrew: "brew upgrade codex",
  },
}

/** Comando de update do CANAL detectado (G3.2). null = agent sem comando
 *  conhecido OU canal desconhecido — o caller usa copy neutra ("use o painel
 *  CLIs instaladas") em vez de sugerir o comando errado. Puro, testável. */
export function commandForChannel(
  agent: string,
  channel: string | null | undefined,
): string | null {
  if (!channel) return null
  return CHANNEL_COMMANDS[agent]?.[channel] ?? null
}

// O "Atualizar" virou JOB em background: ver @/lib/updates (store + toasts com
// id estável) e update.rs (registry com dedupe). O UpdateOutcome request-
// response morreu junto com o incidente dos N `brew upgrade` concorrentes.

/** Extrai os segmentos numéricos de uma versão ("v2.1.209 (x)" → [2,1,209]).
 *  null = string sem versão comparável. */
function versionSegments(raw: string | null | undefined): number[] | null {
  if (!raw) return null
  const m = raw.match(/\d+(?:\.\d+)*/)
  if (!m) return null
  return m[0].split(".").map(Number)
}

/** true quando a versão `latest` é MAIOR que a instalada, comparando segmento a
 *  segmento (segmento ausente = 0). Strings não-comparáveis (null, sem dígitos)
 *  → false: nunca acusa update sem certeza. */
export function updateAvailable(p: {
  version: string | null
  latest: string | null
}): boolean {
  const cur = versionSegments(p.version)
  const latest = versionSegments(p.latest)
  if (!cur || !latest) return false
  const len = Math.max(cur.length, latest.length)
  for (let i = 0; i < len; i++) {
    const a = cur[i] ?? 0
    const b = latest[i] ?? 0
    if (b > a) return true
    if (b < a) return false
  }
  return false
}

/** Rótulo "última vX (canal)" da linha do painel. null = sem latest conhecida.
 *  O canal aparece pra versão fazer sentido: "última v2.1.212 (homebrew)" ao
 *  lado de um npm v2.1.220 no aviso de canal cruzado não é contradição. */
export function latestLabel(p: {
  latest: string | null
  latestChannel?: string | null
}): string | null {
  if (!p.latest) return null
  return `última v${p.latest}${p.latestChannel ? ` (${p.latestChannel})` : ""}`
}

/** Linha informativa de canal CRUZADO: o outro canal tem versão MAIOR que o
 *  teto do canal do binário. Só informação pra decisão humana — trocar de
 *  canal é gesto do usuário, nunca botão. null = nada a dizer. */
export function crossChannelNote(p: {
  latest: string | null
  latestChannel?: string | null
  altLatest?: string | null
  altChannel?: string | null
}): string | null {
  if (!p.latest || !p.latestChannel || !p.altLatest || !p.altChannel) return null
  if (!updateAvailable({ version: p.latest, latest: p.altLatest })) return null
  return `o canal ${p.altChannel} tem v${p.altLatest}; este binário é ${p.latestChannel} (teto v${p.latest})`
}

/** Roda a detecção (comando Rust em paralelo). Fora do Tauri devolve []. */
export async function detectAgents(): Promise<DetectedTool[]> {
  if (!isTauri()) return []
  try {
    return await invoke<DetectedTool[]>("detect_agents")
  } catch {
    return []
  }
}

/** Converte a lista detectada num mapa de snapshots (p/ persistir/consumir). */
export function toProbeMap(
  tools: DetectedTool[],
  now: number,
): Record<string, AgentProbe> {
  const out: Record<string, AgentProbe> = {}
  for (const t of tools) {
    out[t.id] = {
      installed: t.installed,
      version: t.version,
      auth: t.auth,
      detail: t.detail,
      latest: t.latest ?? null,
      latestChannel: t.latestChannel ?? null,
      altLatest: t.altLatest ?? null,
      altChannel: t.altChannel ?? null,
      checkedAt: now,
    }
  }
  return out
}

/** Linhas do `agy models` via Rust. Vazio = falha/indisponível (o chamador
 *  mantém a lista estática). */
export async function listAgyModels(): Promise<string[]> {
  if (!isTauri()) return []
  try {
    const lines = await invoke<string[]>("list_agy_models")
    if (!Array.isArray(lines)) return []
    return lines.map((l) => String(l).trim()).filter(Boolean)
  } catch {
    return []
  }
}

/** Busca os modelos reais do agy e alimenta o cache dinâmico consultado por
 *  agentModels("agy"). Falha → não mexe (o estático continua valendo). */
export async function refreshAgyModels(): Promise<void> {
  const lines = await listAgyModels()
  if (lines.length > 0) setDynamicModels("agy", agyModelOptions(lines))
}
