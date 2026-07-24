import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"
import { setDynamicModels, agyModelOptions } from "@/lib/agents"

/** Espelha DetectedTool do Rust (detect.rs). auth: "ok"=logado · "missing"=
 *  instalado+deslogado · "unknown"=instalado+auth indeterminada · "na"=n/a. */
export interface DetectedTool {
  id: string // "claude-code" | "codex" | "agy" | "git" | "swiftc"
  installed: boolean
  version: string | null
  auth: "ok" | "missing" | "unknown" | "na"
  detail: string | null
  /** Última versão oficial publicada (null = indisponível/offline). */
  latest: string | null
}

/** Snapshot leve por ferramenta, persistido em GlobalSettings.detected. */
export interface AgentProbe {
  installed: boolean
  version: string | null
  auth: "ok" | "missing" | "unknown" | "na"
  detail: string | null
  /** Última versão oficial conhecida no momento da checagem. */
  latest: string | null
  checkedAt: number
}

/** Comando de update por agent (fallback pra "copiar e rodar à mão" quando o
 *  "Atualizar agora" não consegue). null = sem canal conhecido. */
export const UPDATE_COMMANDS: Record<string, string | null> = {
  "claude-code": "npm i -g @anthropic-ai/claude-code",
  codex: "brew upgrade codex",
  agy: null,
}

/** Resultado do "Atualizar agora" (espelha UpdateOutcome do Rust update.rs). */
export interface UpdateOutcome {
  agent: string
  /** "npm" | "homebrew" | "self-update" | "none" */
  method: string
  command: string
  /** tentou rodar? (false = sem canal OU programa fora do PATH) */
  ran: boolean
  /** saiu com sucesso? (só com ran=true) */
  ok: boolean
  output: string
}

/** Atualiza o CLI do agent in-app: o Rust detecta o método (npm/brew/self-update)
 *  pelo path real e roda o comando certo, com fallback pro comando manual. */
export async function updateAgent(id: string): Promise<UpdateOutcome> {
  return invoke<UpdateOutcome>("update_agent", { agent: id })
}

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
