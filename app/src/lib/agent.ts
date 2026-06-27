import { invoke, Channel } from "@tauri-apps/api/core"

/** Eventos normalizados emitidos pelo backend (espelha AgentEvent no Rust). */
export type AgentEvent =
  | { type: "session"; session_id: string; model: string | null; tools: number }
  | { type: "text"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown }
  | {
      type: "result"
      ok: boolean
      text: string | null
      cost_usd: number | null
      cost_source: "reported" | "estimated" | "unknown"
      input_tokens: number
      output_tokens: number
      cache_read: number
      cache_creation: number
    }
  | { type: "error"; message: string }
  | { type: "cancelled" }
  | { type: "done"; code: number | null }
  | { type: "unknown"; raw: unknown }

/** Dispara um agent de código (`agent` = claude-code | codex | opencode) na pasta
 *  `cwd` e streama eventos via Channel. */
export async function runAgent(
  runId: string,
  agent: string,
  prompt: string,
  cwd: string,
  resume: string | null,
  permission: string,
  onEvent: (e: AgentEvent) => void,
): Promise<void> {
  const channel = new Channel<AgentEvent>()
  channel.onmessage = onEvent
  await invoke("run_agent", {
    runId,
    agent,
    prompt,
    cwd,
    resume,
    permission,
    onEvent: channel,
  })
}

/** Cancela um run em andamento (H1). */
export async function cancelAgent(runId: string): Promise<void> {
  await invoke("cancel_agent", { runId })
}

/** Helper one-shot (Sprint 3): roda um modelo barato e retorna o texto puro. */
export async function suggest(
  model: string,
  cwd: string,
  prompt: string,
): Promise<string> {
  return invoke<string>("suggest", { model, cwd, prompt })
}

export interface ContextFile {
  name: string
  exists: boolean
  content: string | null
  bytes: number
}

export interface ClaudeDir {
  exists: boolean
  agents: number
  commands: number
  skills: number
  plans: number
  hooks: number
  settings: boolean
}

export interface ProjectContext {
  files: ContextFile[]
  claude_dir: ClaudeDir
  mcp_servers: number | null
}

export async function readProjectContext(path: string): Promise<ProjectContext> {
  return invoke<ProjectContext>("read_project_context", { path })
}
