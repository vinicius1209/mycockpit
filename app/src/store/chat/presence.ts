import type { ConvState } from "@/store/chat"

export interface ConversationPresence {
  pilotId: string | null
  guests: { id: string; name: string }[]
}

/** Presença real: piloto carimbado e personas que já deram parecer. */
export function conversationPresence(
  conv: Pick<ConvState, "presetId" | "items">,
): ConversationPresence {
  const pilotId = conv.presetId ?? null
  const guests = new Map<string, string>()
  for (const item of conv.items) {
    if (item.kind !== "advice" || item.personaId === pilotId) continue
    if (!guests.has(item.personaId)) guests.set(item.personaId, item.personaName)
  }
  return {
    pilotId,
    guests: [...guests].map(([id, name]) => ({ id, name })),
  }
}

/** Próximo turno precisa reapresentar a persona depois da troca de volante. */
export function needsPersonaReinject(
  conv: Pick<ConvState, "presetId" | "presetDigest" | "items">,
): boolean {
  const hasExecutorTurn = conv.items.some(
    (item) =>
      item.kind !== "advice" &&
      !(item.kind === "user" && item.advisorTo),
  )
  return (
    conv.presetId != null &&
    (conv.presetDigest == null || conv.presetDigest === "") &&
    hasExecutorTurn
  )
}
