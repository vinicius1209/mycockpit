// A entrada do mapa por conversa e as contas puras em volta dela. Separado
// do store para ele caber na catraca de tamanho (ADR-230 somou o bloqueio
// por tamanho).

import {
  settledConversationTurns,
  type ConversationMapPinsV1,
  type ConversationMapSemanticStatus,
  type StoredConversationMap,
} from "@/lib/conversationMap"
import type { UtilityFailureCode, UtilityLocality } from "@/lib/utility/types"
import type { ChatItem } from "@/store/chat"

export function emptyPins(): ConversationMapPinsV1 {
  return { schemaVersion: 1, revision: 0, constraints: [] }
}

export interface ConversationMapEntry {
  hydrated: boolean
  stored: StoredConversationMap | null
  pins: ConversationMapPinsV1
  semanticStatus: ConversationMapSemanticStatus
  staleSettledTurns: number
  generatingAttemptId: string | null
  needsRebase: boolean
  lastIssue: UtilityFailureCode | "corrupt" | "conflict" | null
  /** Entrada determinística já recusada nesta sessão. Nunca é persistida. */
  blockedInputKey: string | null
  /** A conversa não coube na fonte mesmo dividindo os blocos. Vale para a
   *  CONVERSA, não para a entrada exata: ela só cresce, e o bloqueio pela
   *  entrada deixava cada turno novo tentar e falhar de novo (23/09/2026:
   *  74 recusas por dia no modelo local). Sai com o gesto "Tentar de novo",
   *  com outra política ou com pinos novos. Nunca é persistido. */
  blockedSizeKey: string | null
}

export function initialEntry(): ConversationMapEntry {
  return {
    hydrated: false,
    stored: null,
    pins: emptyPins(),
    semanticStatus: "absent",
    staleSettledTurns: 0,
    generatingAttemptId: null,
    needsRebase: false,
    lastIssue: null,
    blockedInputKey: null,
    blockedSizeKey: null,
  }
}

export function turnsAfterWatermark(
  items: readonly ChatItem[],
  running: boolean,
  finalizing: boolean,
  watermark: string | null,
): number {
  const turns = settledConversationTurns(items, { running, finalizing })
  if (!watermark) return turns.length
  const index = turns.findIndex((turn) => turn.terminalItemId === watermark)
  return index < 0 ? turns.length : Math.max(0, turns.length - index - 1)
}

export function sourceKind(locality: UtilityLocality): StoredConversationMap["sourceKind"] {
  if (locality === "device") return "device"
  if (locality === "local-process") return "local_process"
  return "remote"
}
