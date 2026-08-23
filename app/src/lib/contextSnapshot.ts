import type { AgentEvent } from "@/lib/agent"

export type ContextBasis = "last_call" | "unavailable"

export interface ContextSnapshotState {
  contextTokens?: number
  contextWindow?: number
  contextBasis?: ContextBasis
}

export const EMPTY_CONTEXT_SNAPSHOT: ContextSnapshotState = {
  contextTokens: undefined,
  contextWindow: undefined,
  contextBasis: undefined,
}

export function reduceContextSnapshot(
  event: AgentEvent,
): ContextSnapshotState | null {
  if (event.type === "context_usage") {
    return {
      contextTokens: event.tokens,
      contextWindow: event.window_tokens ?? undefined,
      contextBasis: "last_call",
    }
  }
  if (event.type === "context_unavailable") {
    return { ...EMPTY_CONTEXT_SNAPSHOT, contextBasis: "unavailable" }
  }
  return null
}

export function hydrateContextSnapshot(
  row?: {
    contextTokens: number | null
    contextWindow: number | null
    contextBasis: ContextBasis | null
  } | null,
): ContextSnapshotState {
  if (row?.contextBasis === "unavailable") {
    return { ...EMPTY_CONTEXT_SNAPSHOT, contextBasis: "unavailable" }
  }
  if (row?.contextBasis !== "last_call") return EMPTY_CONTEXT_SNAPSHOT
  return {
    contextTokens: row.contextTokens ?? undefined,
    contextWindow: row.contextWindow ?? undefined,
    contextBasis: "last_call",
  }
}

export function contextSnapshotArgs(
  state: ContextSnapshotState,
): [number | null, number | null, ContextBasis | null] {
  return [
    state.contextTokens ?? null,
    state.contextWindow ?? null,
    state.contextBasis ?? null,
  ]
}
