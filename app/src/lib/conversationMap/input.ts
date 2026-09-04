import type { ChatItem } from "@/store/chat"
import { settledConversationTurns } from "./facts"
import type {
  ConversationMapInputV1,
  ConversationMapPinsV1,
  EvidenceChannel,
  EvidenceRole,
  SemanticConversationMapV1,
  SemanticEvidenceItem,
} from "./types"

const SEGMENT_CHARS = 4_000
export const CONVERSATION_MAP_BLOCK_BYTES = 7_000

function referencedItemIds(map: SemanticConversationMapV1 | null): Set<string> {
  const ids = new Set<string>()
  if (!map) return ids
  const claims = [
    map.currentFocus,
    map.explicitGoal,
    map.latestOutcomeSummary,
    ...map.understandings,
    ...map.constraints,
    ...map.openThreads,
  ]
  for (const claim of claims) {
    for (const ref of claim?.evidence ?? []) ids.add(ref.itemId)
  }
  for (const direction of map.directionChanges) {
    for (const ref of direction.evidence) ids.add(ref.itemId)
  }
  return ids
}

export function referencedConversationMapItemIds(
  map: SemanticConversationMapV1 | null,
): Set<string> {
  return referencedItemIds(map)
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

/**
 * Divide a evidência preferencialmente em fronteiras de turno. Um turno maior
 * que a janela cai para seus segmentos já normalizados, sem cortar texto nem
 * trocar o id do item. A função só planeja blocos; snapshots intermediários
 * continuam fora do banco.
 */
export function conversationMapEvidenceBlocks(
  input: ConversationMapInputV1,
  maxBytes = CONVERSATION_MAP_BLOCK_BYTES,
): SemanticEvidenceItem[][] {
  if (!input.evidence.length) return []
  const assigned = new Set<number>()
  const groups: SemanticEvidenceItem[][] = []
  for (const turn of input.turns) {
    const ids = new Set(turn.itemIds)
    const group: SemanticEvidenceItem[] = []
    input.evidence.forEach((item, index) => {
      if (!assigned.has(index) && ids.has(item.itemId)) {
        assigned.add(index)
        group.push(item)
      }
    })
    if (group.length) groups.push(group)
  }
  const outsideTurns = input.evidence.filter((_, index) => !assigned.has(index))
  if (outsideTurns.length) groups.unshift(outsideTurns)

  const blocks: SemanticEvidenceItem[][] = []
  let current: SemanticEvidenceItem[] = []
  const flush = () => {
    if (current.length) blocks.push(current)
    current = []
  }
  for (const group of groups) {
    if (encodedBytes([...current, ...group]) <= maxBytes) {
      current.push(...group)
      continue
    }
    flush()
    if (encodedBytes(group) <= maxBytes) {
      current = [...group]
      continue
    }
    for (const segment of group) {
      if (current.length && encodedBytes([...current, segment]) > maxBytes) flush()
      current.push(segment)
    }
  }
  flush()
  return blocks
}

function identity(item: ChatItem): {
  role: EvidenceRole
  channel: EvidenceChannel
} {
  if (item.kind === "user") {
    return { role: "user", channel: item.advisorTo ? "advisor" : "executor" }
  }
  if (item.kind === "text") return { role: "assistant", channel: "executor" }
  if (item.kind === "advice") return { role: "assistant", channel: "advisor" }
  if (item.kind === "note") return { role: "user", channel: "app" }
  return { role: "system", channel: "app" }
}

function semanticText(item: ChatItem): string | null {
  switch (item.kind) {
    case "user":
    case "text":
    case "note":
      return item.text.trim() || null
    case "advice":
      return item.text.trim() || null
    case "planGate":
      return `${item.decision ?? "pending"}: ${item.text}`
    case "error":
      return item.message.trim() || null
    case "limit":
      return item.message.trim() || null
    case "cancelled":
      return "Turno cancelado"
    case "result":
      return item.ok ? "Turno concluído" : "Turno encerrado com falha"
    case "tool":
      return `Ferramenta ${item.name}: ${item.result ? (item.result.ok ? "concluída" : "falhou") : "sem desfecho"}`
    case "notice":
      return null
  }
}

export function evidenceFromItems(items: readonly ChatItem[]): SemanticEvidenceItem[] {
  const evidence: SemanticEvidenceItem[] = []
  for (const item of items) {
    const text = semanticText(item)
    if (!text) continue
    const who = identity(item)
    const segments = Math.max(1, Math.ceil(text.length / SEGMENT_CHARS))
    for (let index = 0; index < segments; index++) {
      evidence.push({
        itemId: item.id,
        ...who,
        kind: item.kind,
        ts: item.ts,
        text: text.slice(index * SEGMENT_CHARS, (index + 1) * SEGMENT_CHARS),
        ...(segments > 1
          ? { metadata: { segmentIndex: index, segmentCount: segments } }
          : {}),
      })
    }
  }
  return evidence
}

export function buildConversationMapInput(args: {
  items: readonly ChatItem[]
  running: boolean
  finalizing: boolean
  promptVersion: number
  mode: "incremental" | "rebase"
  previousMap: SemanticConversationMapV1 | null
  pins: ConversationMapPinsV1
  summarizedThroughItemId: string | null
  now?: number
}): ConversationMapInputV1 {
  const runtime = { running: args.running, finalizing: args.finalizing }
  const turns = settledConversationTurns(args.items, runtime, args.now)
  const watermarkIndex = args.summarizedThroughItemId
    ? args.items.findIndex((item) => item.id === args.summarizedThroughItemId)
    : -1
  const nextItems =
    args.mode === "rebase" ? args.items : args.items.slice(watermarkIndex + 1)
  const priorIds = referencedItemIds(args.previousMap)
  const priorItems =
    args.mode === "incremental"
      ? args.items.filter(
          (item, index) => index <= watermarkIndex && priorIds.has(item.id),
        )
      : []
  // O payload incremental carrega só a cauda nova mais as fontes ainda citadas
  // pelo mapa anterior. Assim o modelo pode preservar uma afirmação sem receber
  // o histórico inteiro, e o validador continua fechando a allowlist.
  const evidence = evidenceFromItems([...priorItems, ...nextItems])
  const lastTurn = turns.at(-1)
  const latestUserItemId = [...evidence]
    .reverse()
    .find((item) => item.role === "user" && item.channel === "executor")
    ?.itemId ?? null
  return {
    schemaVersion: 1,
    promptVersion: args.promptVersion,
    locale: "pt-BR",
    mode: args.mode,
    previousMap: args.previousMap,
    pins: args.pins,
    turns: turns.filter((turn) =>
      turn.itemIds.some((id) => nextItems.some((item) => item.id === id)),
    ),
    evidence,
    canonicalOutcome: lastTurn
      ? { status: lastTurn.status, terminalItemId: lastTurn.terminalItemId }
      : null,
    latestUserItemId,
    allowedEvidenceItemIds: [...new Set(evidence.map((item) => item.itemId))],
    summarizedThroughItemId: args.summarizedThroughItemId,
  }
}
