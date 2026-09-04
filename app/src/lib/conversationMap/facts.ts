import type { InteractionRequest } from "@/lib/interaction"
import { briefExcerpt } from "@/lib/conversationBrief"
import { deriveTasks } from "@/lib/tasks"
import type { ChatItem } from "@/store/chat"
import { pendingDeferred } from "@/store/chat/terminalTools"
import type {
  CanonicalOutcomeStatus,
  DeterministicConversationFacts,
  SettledConversationTurn,
} from "./types"

const IDLE_SETTLE_MS = 700

interface RuntimeState {
  running: boolean
  finalizing: boolean
}

function terminalStatus(item: ChatItem): CanonicalOutcomeStatus | null {
  switch (item.kind) {
    case "result":
      return item.ok ? "succeeded" : "failed"
    case "cancelled":
      return "cancelled"
    case "limit":
      return "limited"
    case "error":
      return "failed"
    default:
      return null
  }
}

export function latestCanonicalOutcome(
  items: readonly ChatItem[],
  _runtime: RuntimeState,
): DeterministicConversationFacts["latestOutcome"] {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    const status = terminalStatus(item)
    if (!status) continue
    return {
      terminalItemId: item.id,
      status,
      endedAt: item.ts,
      receipt: null,
    }
  }
  return null
}

export function settledConversationTurns(
  items: readonly ChatItem[],
  runtime: RuntimeState,
  now = Date.now(),
): SettledConversationTurn[] {
  const turns: SettledConversationTurn[] = []
  let openedBy: ChatItem | null = null
  let itemIds: string[] = []

  for (const item of items) {
    if (item.kind === "user" && !item.advisorTo) {
      if (openedBy && itemIds.length) {
        turns.push({
          id: `turn_${openedBy.id}`,
          openedByItemId: openedBy.id,
          terminalItemId: openedBy.id,
          status: "unknown",
          itemIds,
          startedAt: openedBy.ts,
          endedAt: openedBy.ts,
        })
      }
      openedBy = item
      itemIds = [item.id]
      continue
    }
    if (!openedBy) continue
    itemIds.push(item.id)
    const status = terminalStatus(item)
    if (!status) continue
    turns.push({
      id: `turn_${item.id}`,
      openedByItemId: openedBy.id,
      terminalItemId: item.id,
      status,
      itemIds,
      startedAt: openedBy.ts,
      endedAt: item.ts,
    })
    openedBy = null
    itemIds = []
  }

  if (
    openedBy &&
    !runtime.running &&
    !runtime.finalizing &&
    openedBy.kind === "user" &&
    (openedBy.ts == null || now - openedBy.ts >= IDLE_SETTLE_MS)
  ) {
    turns.push({
      id: `turn_${openedBy.id}`,
      openedByItemId: openedBy.id,
      terminalItemId: openedBy.id,
      status: "unknown",
      itemIds,
      startedAt: openedBy.ts,
      endedAt: openedBy.ts,
    })
  }

  return turns
}

export function deterministicConversationFacts(args: {
  conversationId: string
  title: string | null
  items: readonly ChatItem[]
  runtime: RuntimeState
  pendingInteractions?: InteractionRequest[]
}): DeterministicConversationFacts {
  const initial = args.items.find(
    (item): item is Extract<ChatItem, { kind: "user" }> =>
      item.kind === "user" && !item.advisorTo && !!item.text.trim(),
  )
  return {
    conversationId: args.conversationId,
    title: args.title,
    initialSubject: initial
      ? { itemId: initial.id, text: briefExcerpt(initial.text), ts: initial.ts }
      : null,
    latestOutcome: latestCanonicalOutcome(args.items, args.runtime),
    tasks: deriveTasks(args.items as ChatItem[]),
    background: pendingDeferred(args.items as ChatItem[]),
    pendingInteractions: args.pendingInteractions ?? [],
    runtime: args.runtime,
  }
}
