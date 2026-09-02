import type { AgentEvent } from "@/lib/agent"
import type { ChatItem, ConvState } from "@/store/chat"

export const acceptedRunEvent: AgentEvent = {
  type: "run_manifest",
  manifest: {
    schemaVersion: 5,
    agentId: "test",
    managedExternalMcp: true,
    sources: [],
    instructions: [],
    resources: [],
    unobservedResources: false,
    notices: [],
    omissions: [],
  },
}

export function userItem(text: string): ChatItem {
  return { kind: "user", id: "u", text }
}

/** Resposta do agent, prova de que o primeiro prompt chegou ao processo. */
export function assistantItem(text: string): ChatItem {
  return { kind: "text", id: "t", text }
}

export function conversationFixture(
  partial: Partial<ConvState> = {},
): ConvState {
  return {
    projectId: "p1",
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [],
    sessionId: null,
    model: null,
    streamingTextId: null,
    running: false,
    finalizing: false,
    runId: null,
    startedAt: null,
    suggestions: [],
    suggesting: false,
    ...partial,
  }
}
