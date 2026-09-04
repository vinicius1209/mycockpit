import { stableClaimId } from "./hash"
import type {
  DirectionChange,
  EvidenceRef,
  SemanticClaim,
  SemanticConversationMapV1,
  SemanticEvidenceItem,
  WireClaimV1,
  WireConversationMapV1,
  WireDirectionChangeV1,
} from "./types"

const CLAIM_MAX = 180
const DIRECTION_MAX = 90
const MAX_EVIDENCE = 3
const MAX_LIST = 5

export type ConversationMapValidation =
  | { ok: true; value: SemanticConversationMapV1 }
  | { ok: false; error: string }

function normalizeText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const text = value
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return text && text.length <= max ? text : null
}

function isWireClaim(value: unknown): value is WireClaimV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const claim = value as Partial<WireClaimV1>
  return (
    typeof claim.text === "string" &&
    (claim.certainty === "explicit" || claim.certainty === "inferred") &&
    Array.isArray(claim.evidenceItemIds) &&
    claim.evidenceItemIds.every((id) => typeof id === "string")
  )
}

function evidenceRefs(
  ids: readonly string[],
  evidenceById: Map<string, SemanticEvidenceItem>,
): EvidenceRef[] | null {
  const unique = [...new Set(ids)]
  if (!unique.length || unique.length > MAX_EVIDENCE) return null
  const refs: EvidenceRef[] = []
  for (const itemId of unique) {
    const item = evidenceById.get(itemId)
    if (!item) return null
    refs.push({ itemId, role: item.role, channel: item.channel })
  }
  return refs
}

async function claimFromWire(
  kind: string,
  value: unknown,
  evidenceById: Map<string, SemanticEvidenceItem>,
): Promise<SemanticClaim | null> {
  if (!isWireClaim(value)) return null
  const text = normalizeText(value.text, CLAIM_MAX)
  const evidence = evidenceRefs(value.evidenceItemIds, evidenceById)
  if (!text || !evidence) return null
  if (value.certainty === "explicit" && !evidence.some((ref) => ref.role === "user")) {
    return null
  }
  return {
    id: await stableClaimId(kind, text, evidence.map((ref) => ref.itemId)),
    text,
    certainty: value.certainty,
    evidence,
  }
}

async function requiredClaim(
  kind: string,
  value: unknown,
  evidenceById: Map<string, SemanticEvidenceItem>,
): Promise<SemanticClaim> {
  const claim = await claimFromWire(kind, value, evidenceById)
  if (!claim) throw new Error(`${kind}: claim inválido`)
  return claim
}

async function directionFromWire(
  value: unknown,
  evidenceById: Map<string, SemanticEvidenceItem>,
): Promise<DirectionChange | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const direction = value as Partial<WireDirectionChangeV1>
  const from = normalizeText(direction.from, DIRECTION_MAX)
  const to = normalizeText(direction.to, DIRECTION_MAX)
  if (!from || !to || !Array.isArray(direction.evidenceItemIds)) return null
  // `from` e `to` são copy de produto. Repetir ids da allowlist produz uma
  // trajetória tecnicamente citada, mas ilegível e semanticamente falsa.
  if (evidenceById.has(from) || evidenceById.has(to)) return null
  const evidence = evidenceRefs(direction.evidenceItemIds, evidenceById)
  if (!evidence) return null
  // Rumo é decisão da pessoa. Saída do executor ou fato do app pode provar
  // desfecho, nunca uma mudança de escopo solicitada.
  if (
    evidence.some((ref) => ref.role !== "user") ||
    new Set(evidence.map((ref) => ref.itemId)).size < 2
  ) {
    return null
  }
  return {
    id: await stableClaimId(
      "direction",
      `${from}\u0000${to}`,
      evidence.map((ref) => ref.itemId),
    ),
    from,
    to,
    evidence,
  }
}

export async function validateConversationMap(
  raw: unknown,
  evidence: readonly SemanticEvidenceItem[],
  expected?: {
    currentFocusItemId: string | null
    latestOutcomeItemId: string | null
  },
): Promise<ConversationMapValidation> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "resposta não é um objeto" }
  }
  const wire = raw as Partial<WireConversationMapV1>
  const keys = Object.keys(wire)
  const expectedKeys = new Set([
    "currentFocus",
    "explicitGoalCandidate",
    "directionChanges",
    "understandings",
    "constraints",
    "openThreads",
    "latestOutcomeSummary",
  ])
  if (keys.some((key) => !expectedKeys.has(key))) {
    return { ok: false, error: "resposta contém campos desconhecidos" }
  }
  const directionWire = wire.directionChanges ?? []
  const understandingWire = wire.understandings ?? []
  const constraintWire = wire.constraints ?? []
  const openThreadWire = wire.openThreads ?? []
  const lists = [directionWire, understandingWire, constraintWire, openThreadWire]
  if (lists.some((list) => !Array.isArray(list))) {
    return { ok: false, error: "resposta contém lista inválida" }
  }
  if (
    directionWire.length > 4 ||
    understandingWire.length > MAX_LIST ||
    constraintWire.length > MAX_LIST ||
    openThreadWire.length > MAX_LIST
  ) {
    return { ok: false, error: "resposta excede a cardinalidade" }
  }

  const evidenceById = new Map(evidence.map((item) => [item.itemId, item]))
  try {
    const currentFocus =
      wire.currentFocus == null
        ? null
        : await requiredClaim("current_focus", wire.currentFocus, evidenceById)
    if (
      currentFocus &&
      expected?.currentFocusItemId &&
      !currentFocus.evidence.some(
        (ref) => ref.itemId === expected.currentFocusItemId,
      )
    ) {
      throw new Error("foco atual não cita o pedido humano mais recente")
    }
    const goalCandidate =
      wire.explicitGoalCandidate == null
        ? null
        : await requiredClaim(
            "explicit_goal",
            wire.explicitGoalCandidate,
            evidenceById,
          )
    const explicitGoal =
      goalCandidate?.certainty === "explicit" &&
      goalCandidate.evidence.some((ref) => ref.role === "user")
        ? goalCandidate
        : null
    const latestOutcomeSummary =
      wire.latestOutcomeSummary == null
        ? null
        : await requiredClaim(
            "latest_outcome",
            wire.latestOutcomeSummary,
          evidenceById,
        )
    if (
      latestOutcomeSummary &&
      expected?.latestOutcomeItemId &&
      !latestOutcomeSummary.evidence.some(
        (ref) => ref.itemId === expected.latestOutcomeItemId,
      )
    ) {
      throw new Error("desfecho não cita o evento terminal mais recente")
    }
    const directionChanges = await Promise.all(
      directionWire.map((item) => directionFromWire(item, evidenceById)),
    )
    if (directionChanges.some((item) => !item)) throw new Error("direção inválida")
    const convertList = (kind: string, values: unknown[]) =>
      Promise.all(values.map((item) => requiredClaim(kind, item, evidenceById)))
    const value: SemanticConversationMapV1 = {
      schemaVersion: 1,
      currentFocus,
      explicitGoal,
      directionChanges: directionChanges as DirectionChange[],
      understandings: await convertList("understanding", understandingWire),
      constraints: await convertList("constraint", constraintWire),
      openThreads: await convertList("open_thread", openThreadWire),
      latestOutcomeSummary,
    }
    const claimIds = [
      value.currentFocus,
      value.explicitGoal,
      value.latestOutcomeSummary,
      ...value.understandings,
      ...value.constraints,
      ...value.openThreads,
    ]
      .filter((claim): claim is SemanticClaim => claim != null)
      .map((claim) => claim.id)
    if (new Set(claimIds).size !== claimIds.length) {
      return { ok: false, error: "resposta repete a mesma afirmação" }
    }
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
    if (bytes > 32 * 1024) return { ok: false, error: "resposta excede 32 KiB" }
    return { ok: true, value }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "resposta inválida",
    }
  }
}
