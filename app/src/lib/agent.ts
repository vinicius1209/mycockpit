import { invoke, Channel } from "@tauri-apps/api/core"
import type { Attachment } from "@/lib/attachments"
import { agentDef } from "@/lib/agents"

/** Proveniência do custo (espelha CostSource no Rust). */
export type CostSource = "reported" | "estimated" | "unknown"

/** Eventos normalizados emitidos pelo backend (espelha AgentEvent no Rust). */
export type AgentEvent =
  | { type: "session"; session_id: string; model: string | null; tools: number }
  | { type: "text"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; ok: boolean; text: string; lines: number }
  | { type: "context_usage"; tokens: number }
  | { type: "limit_reached"; message: string; reset_hint: string | null }
  | {
      type: "result"
      ok: boolean
      text: string | null
      cost_usd: number | null
      cost_source: CostSource
      input_tokens: number
      output_tokens: number
      cache_read: number
      cache_creation: number
    }
  | { type: "error"; message: string }
  | { type: "notice"; message: string }
  | { type: "cancelled" }
  | { type: "done"; code: number | null }
  | { type: "unknown"; raw: unknown }

/** Dispara um agent de código (`agent` = claude-code | codex | opencode) na pasta
 *  `cwd` e streama eventos via Channel. */
export async function runAgent(
  runId: string,
  convId: string,
  agent: string,
  model: string | null,
  effort: string | null,
  prompt: string,
  cwd: string,
  resume: string | null,
  permission: string,
  attachments: Attachment[],
  onEvent: (e: AgentEvent) => void,
): Promise<void> {
  const channel = new Channel<AgentEvent>()
  channel.onmessage = onEvent
  await invoke("run_agent", {
    runId,
    convId,
    agent,
    model,
    effort,
    prompt,
    cwd,
    resume,
    permission,
    attachments,
    onEvent: channel,
  })
}

/** Cancela um run em andamento (H1). */
export async function cancelAgent(runId: string): Promise<void> {
  await invoke("cancel_agent", { runId })
}

/** Rótulo de exibição de um agent (id → nome). Fonte única: lib/agents. */
export function agentLabel(agent: string): string {
  return agentDef(agent)?.label ?? agent
}

/** Helper one-shot (Sprint 3): roda um modelo barato e retorna o texto puro. */
export async function suggest(
  model: string,
  cwd: string,
  prompt: string,
): Promise<string> {
  return invoke<string>("suggest", { model, cwd, prompt })
}
