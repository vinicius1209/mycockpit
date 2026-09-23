import {
  conversationMapEvidenceBlocks,
  referencedConversationMapItemIds,
} from "./input"
import { sha256Hex } from "./hash"
import { validateConversationMap } from "./validate"
import type {
  ConversationMapInputV1,
  SemanticConversationMapV1,
  SemanticEvidenceItem,
} from "./types"
import { generateUtility } from "@/lib/utility/gateway"
import { UTILITY_PROFILES } from "@/lib/utility/profiles"
import type {
  UtilityFailureCode,
  UtilityRequest,
  UtilityResult,
} from "@/lib/utility/types"

type MapRequestBase = Pick<
  UtilityRequest<ConversationMapInputV1>,
  | "attemptId"
  | "locale"
  | "routePolicy"
  | "projectId"
  | "conversationId"
  | "deadlineMs"
  | "helperModel"
  | "remoteAuthorized"
>

export type ConversationMapGeneration =
  | {
      ok: true
      value: SemanticConversationMapV1
      source: NonNullable<UtilityResult<unknown>["source"]>
      durationMs: number
      cost: UtilityResult<unknown>["cost"]
      blocks: number
    }
  | {
      ok: false
      reason: UtilityFailureCode
      source: UtilityResult<unknown>["source"]
      durationMs: number
      inputDigest?: string
      payloadStats?: ConversationMapPayloadStats
    }

export interface ConversationMapPayloadStats {
  total: number
  previousMap: number
  pins: number
  turns: number
  evidence: number
  allowedEvidenceItemIds: number
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

export function conversationMapPayloadStats(
  input: ConversationMapInputV1,
): ConversationMapPayloadStats {
  return {
    total: encodedBytes(input),
    previousMap: encodedBytes(input.previousMap),
    pins: encodedBytes(input.pins),
    turns: encodedBytes(input.turns),
    evidence: encodedBytes(input.evidence),
    allowedEvidenceItemIds: encodedBytes(input.allowedEvidenceItemIds),
  }
}

/** Quantas vezes uma geração divide bloco recusado por tamanho: cada divisão
 *  é uma chamada a mais ao modelo, e sem teto uma conversa enorme viraria uma
 *  rajada de chamadas. */
const MAX_DIVISOES = 6

function skeletonsFor(
  map: SemanticConversationMapV1 | null,
  allEvidence: readonly SemanticEvidenceItem[],
  excludedIds: ReadonlySet<string>,
): SemanticEvidenceItem[] {
  const wanted = referencedConversationMapItemIds(map)
  const seen = new Set<string>()
  return allEvidence.flatMap((item) => {
    if (
      !wanted.has(item.itemId) ||
      excludedIds.has(item.itemId) ||
      seen.has(item.itemId)
    ) {
      return []
    }
    seen.add(item.itemId)
    return [{ ...item, text: undefined, metadata: { priorEvidence: true } }]
  })
}

/**
 * Processa uma entrada longa em blocos, mas só devolve um snapshot quando
 * todos passaram pelo transporte e pelo validador. O chamador decide se a
 * tentativa ainda é atual entre os blocos.
 */
export async function generateConversationMap(input: {
  mapInput: ConversationMapInputV1
  request: MapRequestBase
  isCurrent: () => boolean
  onTransportResult?: (result: UtilityResult<unknown>) => void
}): Promise<ConversationMapGeneration> {
  const priorIds = referencedConversationMapItemIds(input.mapInput.previousMap)
  const newEvidence = input.mapInput.evidence.filter(
    (item) => !priorIds.has(item.itemId),
  )
  const blocks = conversationMapEvidenceBlocks({
    ...input.mapInput,
    evidence: newEvidence,
  })
  if (!blocks.length) {
    return { ok: false, reason: "invalid_request", source: null, durationMs: 0 }
  }

  let previousMap = input.mapInput.previousMap
  let durationMs = 0
  let source: UtilityResult<unknown>["source"] = null
  let cost: UtilityResult<unknown>["cost"]
  // Bloco que a FONTE recusou por tamanho se divide ao meio e tenta de novo.
  // O teto de bytes é nosso, mas a janela de contexto é do modelo: o da Apple
  // recusava ~3 de cada 4 blocos de 7 KB (23/09/2026: 74 de 98 chamadas por
  // dia), e a geração inteira recomeçava do zero no turno seguinte.
  const fila = [...blocks]
  let divisoes = 0
  while (fila.length) {
    const evidenceChunk = fila.shift()!
    if (!input.isCurrent()) {
      return { ok: false, reason: "stale", source, durationMs }
    }
    const chunkIds = new Set(evidenceChunk.map((item) => item.itemId))
    const evidence = [
      ...skeletonsFor(previousMap, input.mapInput.evidence, chunkIds),
      ...evidenceChunk,
    ].reverse()
    const allowedEvidenceItemIds = [
      ...new Set(evidence.map((item) => item.itemId)),
    ]
    const latestUserItemId = evidence.find(
      (item) => item.role === "user" && item.channel === "executor",
    )?.itemId ?? null
    const canonicalOutcome =
      input.mapInput.canonicalOutcome &&
      allowedEvidenceItemIds.includes(input.mapInput.canonicalOutcome.terminalItemId)
        ? input.mapInput.canonicalOutcome
        : null
    const blockInput: ConversationMapInputV1 = {
      ...input.mapInput,
      previousMap,
      evidence,
      latestUserItemId,
      canonicalOutcome,
      allowedEvidenceItemIds,
      turns: input.mapInput.turns.filter((turn) =>
        turn.itemIds.some((itemId) => chunkIds.has(itemId)),
      ),
    }
    const payloadStats = conversationMapPayloadStats(blockInput)
    const inputDigest = await sha256Hex(
      JSON.stringify({
        input: blockInput,
        routePolicy: input.request.routePolicy,
      }),
    )
    if (payloadStats.total > UTILITY_PROFILES.conversation_map.maxInputBytes) {
      console.warn("[mapa da conversa] entrada excede o perfil", payloadStats)
      return {
        ok: false,
        reason: "input_too_large",
        source,
        durationMs,
        inputDigest,
        payloadStats,
      }
    }
    const result = await generateUtility<typeof blockInput, unknown>({
      ...input.request,
      task: "conversation_map",
      payload: blockInput,
      inputDigest,
    })
    input.onTransportResult?.(result)
    durationMs += result.timing.durationMs
    source = result.source
    cost = result.cost
    if (!input.isCurrent()) {
      return { ok: false, reason: "stale", source, durationMs }
    }
    if (
      result.fallbackReason === "input_too_large" &&
      evidenceChunk.length > 1 &&
      divisoes < MAX_DIVISOES
    ) {
      divisoes += 1
      const meio = Math.ceil(evidenceChunk.length / 2)
      fila.unshift(evidenceChunk.slice(0, meio), evidenceChunk.slice(meio))
      continue
    }
    if (result.status !== "ok" || result.value == null || !result.source) {
      return {
        ok: false,
        reason: result.fallbackReason ?? "process_failed",
        source: result.source,
        durationMs,
        inputDigest,
        payloadStats,
      }
    }
    const validated = await validateConversationMap(result.value, evidence, {
      currentFocusItemId: latestUserItemId,
      latestOutcomeItemId: canonicalOutcome?.terminalItemId ?? null,
    })
    if (!validated.ok) {
      console.warn("[mapa da conversa] resposta rejeitada", validated.error)
      return {
        ok: false,
        reason: "invalid_response",
        source: result.source,
        durationMs,
        inputDigest,
        payloadStats,
      }
    }
    previousMap = validated.value
  }

  return {
    ok: true,
    value: previousMap!,
    source: source!,
    durationMs,
    cost,
    blocks: blocks.length + divisoes,
  }
}
