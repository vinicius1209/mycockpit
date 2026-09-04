import type { InteractionRequest } from "@/lib/interaction"
import type { AgentTask } from "@/lib/tasks"
import type { DeferredWork } from "@/lib/work"

export type EvidenceRole = "user" | "assistant" | "system"
export type EvidenceChannel = "executor" | "advisor" | "app"
export type ClaimCertainty = "explicit" | "inferred"

export interface EvidenceRef {
  itemId: string
  role: EvidenceRole
  channel: EvidenceChannel
}

export interface SemanticClaim {
  id: string
  text: string
  certainty: ClaimCertainty
  evidence: EvidenceRef[]
}

export interface DirectionChange {
  id: string
  from: string
  to: string
  evidence: EvidenceRef[]
}

export interface WireClaimV1 {
  text: string
  certainty: ClaimCertainty
  evidenceItemIds: string[]
}

export interface WireDirectionChangeV1 {
  from: string
  to: string
  evidenceItemIds: string[]
}

export interface WireConversationMapV1 {
  currentFocus: WireClaimV1 | null
  explicitGoalCandidate: WireClaimV1 | null
  directionChanges: WireDirectionChangeV1[]
  understandings: WireClaimV1[]
  constraints: WireClaimV1[]
  openThreads: WireClaimV1[]
  latestOutcomeSummary: WireClaimV1 | null
}

export interface SemanticConversationMapV1 {
  schemaVersion: 1
  currentFocus: SemanticClaim | null
  explicitGoal: SemanticClaim | null
  directionChanges: DirectionChange[]
  understandings: SemanticClaim[]
  constraints: SemanticClaim[]
  openThreads: SemanticClaim[]
  latestOutcomeSummary: SemanticClaim | null
}

export interface ConversationMapPin {
  id: string
  text: string
  pinnedAt: number
}

export interface ConversationMapPinsV1 {
  schemaVersion: 1
  revision: number
  currentFocus?: ConversationMapPin
  explicitGoal?: ConversationMapPin
  constraints: ConversationMapPin[]
}

export const EMPTY_CONVERSATION_MAP_PINS: ConversationMapPinsV1 = {
  schemaVersion: 1,
  revision: 0,
  constraints: [],
}

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

export type ConversationMapSemanticStatus =
  | "absent"
  | "queued"
  | "generating"
  | "current"
  | "stale"
  | "unavailable"

export interface ConversationMapView {
  facts: DeterministicConversationFacts
  currentFocus: SemanticClaim | ConversationMapPin | null
  explicitGoal: SemanticClaim | ConversationMapPin | null
  directionChanges: DirectionChange[]
  understandings: SemanticClaim[]
  constraints: Array<SemanticClaim | ConversationMapPin>
  openThreads: SemanticClaim[]
  latestOutcomeSummary: SemanticClaim | null
  provenance: {
    mode: "facts_only" | "semantic" | "semantic_with_pins"
    generatedAt: number | null
    staleSettledTurns: number
    semanticStatus: ConversationMapSemanticStatus
  }
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

export interface SemanticEvidenceItem {
  itemId: string
  role: EvidenceRole
  channel: EvidenceChannel
  kind: string
  ts?: number
  text?: string
  metadata?: Record<string, string | number | boolean | null>
}

export interface ConversationMapInputV1 {
  schemaVersion: 1
  promptVersion: number
  locale: "pt-BR"
  mode: "incremental" | "rebase"
  previousMap: SemanticConversationMapV1 | null
  pins: ConversationMapPinsV1
  turns: SettledConversationTurn[]
  evidence: SemanticEvidenceItem[]
  canonicalOutcome: {
    status: CanonicalOutcomeStatus
    terminalItemId: string
  } | null
  latestUserItemId: string | null
  allowedEvidenceItemIds: string[]
  summarizedThroughItemId: string | null
}

export interface StoredConversationMap {
  conversationId: string
  schemaVersion: 1
  promptVersion: number
  payload: SemanticConversationMapV1
  summarizedThroughItemId: string | null
  summarizedThroughTs: number | null
  inputDigest: string
  sourceKind: "device" | "local_process" | "remote"
  sourceId: string
  sourceFingerprint: string | null
  generationMode: "incremental" | "rebase"
  generatedAt: number
  latencyMs: number | null
  turnsSinceRebase: number
  costUsd: number | null
  costSource: "reported" | "estimated" | "unknown" | null
}
