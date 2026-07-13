import { invoke, Channel } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
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

/** Aprovação GRANULAR inline (autonomia, Dimensão 1): o pedido que o backend emite
 *  no evento global `approval://request` quando o Claude (modo Padrao) quer usar
 *  uma tool que precisa de OK. O turno FICA PAUSADO até `answerApproval`. Espelha
 *  `ApprovalRequest` no Rust. */
export type ApprovalRequest = {
  /** id do pedido (correlaciona com a resposta). */
  id: string
  /** run que está pausado esperando a decisão. */
  run_id: string
  /** tool que o Claude quer usar (ex. "Bash", "Write"). */
  tool_name: string
  /** comando extraído do input p/ Bash (vazio p/ outras tools). */
  command: string
  /** input cru da tool (a UI mostra o detalhe). */
  input: unknown
}

/** Escuta os pedidos de aprovação inline (evento global do backend). Retorna o
 *  unlisten. O turno do Claude fica bloqueado até responder via `answerApproval`. */
export async function onApprovalRequest(
  cb: (req: ApprovalRequest) => void,
): Promise<UnlistenFn> {
  return listen<ApprovalRequest>("approval://request", (e) => cb(e.payload))
}

/** Entrega a decisão do usuário (Aprovar/Negar) ao backend, que destrava o turno.
 *  `updatedInput` (opcional) sanitiza o input antes de aprovar; `message` (opcional)
 *  vira o motivo do deny mostrado ao Claude. */
export async function answerApproval(
  id: string,
  allow: boolean,
  updatedInput?: unknown,
  message?: string,
): Promise<void> {
  await invoke("answer_approval", {
    id,
    allow,
    updatedInput: updatedInput ?? null,
    message: message ?? null,
  })
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
