import { invoke, Channel } from "@tauri-apps/api/core"

/** Eventos normalizados emitidos pelo backend (espelha AgentEvent no Rust). */
export type AgentEvent =
  | { type: "session"; session_id: string; model: string | null; tools: number }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown }
  | { type: "result"; ok: boolean; text: string | null; cost_usd: number | null }
  | { type: "done"; code: number | null }

/** Dispara o Claude Code na pasta `cwd` e streama eventos via Channel. */
export async function runClaude(
  prompt: string,
  cwd: string,
  resume: string | null,
  permission: string,
  onEvent: (e: AgentEvent) => void,
): Promise<void> {
  const channel = new Channel<AgentEvent>()
  channel.onmessage = onEvent
  await invoke("run_claude", { prompt, cwd, resume, permission, onEvent: channel })
}

export interface ContextFile {
  name: string
  exists: boolean
  content: string | null
}

export interface ProjectContext {
  files: ContextFile[]
  has_claude_dir: boolean
}

export async function readProjectContext(path: string): Promise<ProjectContext> {
  return invoke<ProjectContext>("read_project_context", { path })
}
