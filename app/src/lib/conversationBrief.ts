import type { ChatItem } from "@/store/chat"

export interface BriefExcerpt {
  text: string
  ts?: number
}

export interface ConversationBrief {
  title: string | null
  initialRequest: BriefExcerpt | null
  /** Última fala do agente que chegou a um `result.ok`. Texto de streaming
   *  ainda aberto e turno encerrado em falha não viram checkpoint. */
  checkpoint: BriefExcerpt | null
}

/** Normalização só visual. O fio continua sendo a fonte integral; aqui o texto
 *  precisa caber na leitura de relance do painel. */
export function briefExcerpt(text: string, max = 420): string {
  const compact = text.replace(/\s+/g, " ").trim()
  if (compact.length <= max) return compact
  const candidate = compact.slice(0, max - 1).trimEnd()
  const wordBreak = candidate.lastIndexOf(" ")
  const cut =
    wordBreak >= Math.floor(max / 2) ? candidate.slice(0, wordBreak) : candidate
  return `${cut.trimEnd()}…`
}

/** Projeção replay-safe da orientação de uma conversa. Não resume com modelo,
 *  não escolhe objetivo por heurística e não usa texto de turno incompleto. */
export function conversationBrief(
  items: ChatItem[],
  title: string | null,
): ConversationBrief {
  const initial = items.find(
    (item): item is Extract<ChatItem, { kind: "user" }> =>
      item.kind === "user" && !item.advisorTo && !!item.text.trim(),
  )

  let checkpoint: BriefExcerpt | null = null
  let latestTurnText: Extract<ChatItem, { kind: "text" }> | null = null

  for (const item of items) {
    if (item.kind === "user" && !item.advisorTo) {
      latestTurnText = null
      continue
    }
    if (item.kind === "text" && item.text.trim()) {
      latestTurnText = item
      continue
    }
    if (item.kind === "result") {
      if (item.ok) {
        const text = item.text?.trim() || latestTurnText?.text.trim()
        if (text) {
          checkpoint = {
            text: briefExcerpt(text),
            ts: item.ts ?? latestTurnText?.ts,
          }
        }
      }
      latestTurnText = null
      continue
    }
    if (
      item.kind === "error" ||
      item.kind === "limit" ||
      item.kind === "cancelled"
    ) {
      latestTurnText = null
    }
  }

  return {
    title: title?.trim() || null,
    initialRequest: initial
      ? { text: briefExcerpt(initial.text), ts: initial.ts }
      : null,
    checkpoint,
  }
}
