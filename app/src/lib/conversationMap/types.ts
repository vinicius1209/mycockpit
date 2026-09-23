import type { InteractionRequest } from "@/lib/interaction"
import type { AgentTask } from "@/lib/tasks"
import type { DeferredWork } from "@/lib/work"

// O que sobrou do mapa da conversa depois do ADR-233: só os fatos
// determinísticos que a aba Conversa usa. Os tipos do resumo saíram com ele.

export type CanonicalOutcomeStatus =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "limited"
  | "interrupted"
  | "unknown"

export interface DeterministicConversationFacts {
  conversationId: string
  title: string | null
  initialSubject: { itemId: string; text: string; ts?: number } | null
  latestOutcome: {
    terminalItemId: string
    status: CanonicalOutcomeStatus
    endedAt?: number
    receipt: string | null
  } | null
  tasks: AgentTask[]
  background: DeferredWork[]
  pendingInteractions: InteractionRequest[]
  runtime: { running: boolean; finalizing: boolean }
}

export interface SettledConversationTurn {
  id: string
  openedByItemId: string | null
  terminalItemId: string
  status: CanonicalOutcomeStatus
  itemIds: string[]
  startedAt?: number
  endedAt?: number
}
