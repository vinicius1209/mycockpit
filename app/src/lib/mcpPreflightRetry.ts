import { startProjectBrowser } from "@/lib/browser"
import type { Attachment } from "@/lib/attachments"
import type { AgentRunConfig } from "@/lib/types"
import type {
  McpPreflightGate,
  McpRecoveryKind,
  McpRunOverride,
} from "@/lib/tooling"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

export interface PreflightRetryRequest {
  text: string
  cfg: AgentRunConfig | undefined
  attachments: Attachment[]
  onAccepted?: () => void
}

export function recoveryOverride(
  gate: McpPreflightGate,
  kind: Extract<McpRecoveryKind, "omit-for-this-run" | "retry-readonly">,
): McpRunOverride | null {
  const recovery = gate.allowedRecoveries.find((item) => item.kind === kind)
  if (!recovery?.sourceId) return null
  return {
    gateFingerprint: gate.fingerprint,
    sourceId: recovery.sourceId,
    kind,
  }
}

export async function startRequiredProjectBrowser(
  projectPath: string,
): Promise<void> {
  await startProjectBrowser(projectPath, true)
}

export type PreflightRetryDispatcher = (
  request: PreflightRetryRequest,
  recoveries?: McpRunOverride[],
) => void

export async function startBrowserAndResumePreflight(
  conversationId: string,
  request: PreflightRetryRequest | undefined,
  retry: PreflightRetryDispatcher,
): Promise<"sent" | "ready" | "missing-project"> {
  const conversation = useChat.getState().byId[conversationId]
  const project = useApp
    .getState()
    .projects.find((candidate) => candidate.id === conversation?.projectId)
  if (!project) return "missing-project"
  await startRequiredProjectBrowser(project.path)
  useChat.getState().clearPreflightGate(conversationId)
  if (!request) return "ready"
  retry(request)
  return "sent"
}

export function recoveryForConversation(
  conversationId: string,
  kind: Extract<McpRecoveryKind, "omit-for-this-run" | "retry-readonly">,
): McpRunOverride | null {
  const gate = useChat.getState().byId[conversationId]?.preflightGate?.gate
  return gate ? recoveryOverride(gate, kind) : null
}
