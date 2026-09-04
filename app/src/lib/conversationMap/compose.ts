import type {
  ConversationMapPinsV1,
  ConversationMapSemanticStatus,
  ConversationMapView,
  DeterministicConversationFacts,
  SemanticConversationMapV1,
} from "./types"

export function composeConversationMapView(args: {
  facts: DeterministicConversationFacts
  semantic: SemanticConversationMapV1 | null
  pins: ConversationMapPinsV1
  semanticStatus: ConversationMapSemanticStatus
  generatedAt?: number | null
  staleSettledTurns?: number
}): ConversationMapView {
  const hasPins = !!(
    args.pins.currentFocus ||
    args.pins.explicitGoal ||
    args.pins.constraints.length
  )
  return {
    facts: args.facts,
    currentFocus: args.pins.currentFocus ?? args.semantic?.currentFocus ?? null,
    explicitGoal: args.pins.explicitGoal ?? args.semantic?.explicitGoal ?? null,
    directionChanges: args.semantic?.directionChanges ?? [],
    understandings: args.semantic?.understandings ?? [],
    constraints: [
      ...args.pins.constraints,
      ...(args.semantic?.constraints ?? []),
    ],
    openThreads: args.semantic?.openThreads ?? [],
    latestOutcomeSummary: args.semantic?.latestOutcomeSummary ?? null,
    provenance: {
      mode: args.semantic
        ? hasPins
          ? "semantic_with_pins"
          : "semantic"
        : "facts_only",
      generatedAt: args.generatedAt ?? null,
      staleSettledTurns: args.staleSettledTurns ?? 0,
      semanticStatus: args.semanticStatus,
    },
  }
}
