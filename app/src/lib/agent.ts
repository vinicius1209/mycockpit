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
      input_tokens: number
      output_tokens: number
      cache_read: number
      cache_creation: number
    }
  | { type: "error"; message: string }
  | { type: "cancelled" }
  | { type: "done"; code: number | null }

/** Dispara o Claude Code na pasta `cwd` e streama eventos via Channel. */
export async function runClaude(
  runId: string,
  prompt: string,
  cwd: string,
  resume: string | null,
  permission: string,
  onEvent: (e: AgentEvent) => void,
): Promise<void> {
  const channel = new Channel<AgentEvent>()
  channel.onmessage = onEvent
  await invoke("run_claude", {
    runId,
    prompt,
    cwd,
    resume,
    permission,
    onEvent: channel,
  })
}

/** Cancela um run em andamento (H1). */
export async function cancelClaude(runId: string): Promise<void> {
  await invoke("cancel_claude", { runId })
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
}

export interface ProjectContext {
  files: ContextFile[]
  has_claude_dir: boolean
}

export async function readProjectContext(path: string): Promise<ProjectContext> {
  return invoke<ProjectContext>("read_project_context", { path })
}
