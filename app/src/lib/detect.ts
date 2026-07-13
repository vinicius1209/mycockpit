import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"

/** Espelha DetectedTool do Rust (detect.rs). auth: "ok"=logado · "missing"=
 *  instalado+deslogado · "unknown"=instalado+auth indeterminada · "na"=n/a. */
export interface DetectedTool {
  id: string // "claude-code" | "codex" | "agy" | "git" | "swiftc"
  installed: boolean
  version: string | null
  auth: "ok" | "missing" | "unknown" | "na"
  detail: string | null
}

/** Snapshot leve por ferramenta, persistido em GlobalSettings.detected. */
export interface AgentProbe {
  installed: boolean
  version: string | null
  auth: "ok" | "missing" | "unknown" | "na"
  detail: string | null
  checkedAt: number
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
      checkedAt: now,
    }
  }
  return out
}
