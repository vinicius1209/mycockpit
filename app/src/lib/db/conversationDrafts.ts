import type { Attachment } from "@/lib/attachments"
import type { BlocoDoRascunho } from "@/lib/citacao"
import { getDb } from "@/lib/db"
import { ensureComposerDraftTables } from "@/lib/db/schema"

export interface PersistedComposerDraft {
  text: string
  attachments: Attachment[]
  mentionValues: string[]
  blocos?: BlocoDoRascunho[]
}

interface DraftRow {
  text: string
  attachments: string
  mention_values: string
  blocos: string
}

/** Só citações bem formadas voltam do banco; o resto é descartado. */
export function parseBlocos(raw: string): BlocoDoRascunho[] {
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter((item): item is BlocoDoRascunho => {
      if (!item || typeof item !== "object") return false
      const b = item as Record<string, unknown>
      if (b.tipo === "citacao") {
        return (
          typeof b.itemId === "string" &&
          typeof b.autor === "string" &&
          typeof b.ts === "number" &&
          typeof b.trecho === "string"
        )
      }
      // Colagem grande (capricho R7): o conteúdo inteiro mora no rascunho.
      return b.tipo === "colagem" && typeof b.id === "string" && typeof b.texto === "string"
    })
  } catch {
    return []
  }
}

function parseStrings(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value)
      ? [...new Set(value.filter((item): item is string => typeof item === "string"))]
      : []
  } catch {
    return []
  }
}

function parseAttachments(raw: string): Attachment[] {
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter(
      (item): item is Attachment =>
        !!item &&
        typeof item === "object" &&
        typeof (item as Attachment).path === "string" &&
        typeof (item as Attachment).name === "string",
    )
  } catch {
    return []
  }
}

export async function loadComposerDraft(
  conversationId: string,
): Promise<PersistedComposerDraft | null> {
  const db = await getDb()
  if (!db) return null
  await ensureComposerDraftTables(db)
  const rows = await db.select<DraftRow[]>(
    "SELECT text, attachments, mention_values, blocos FROM conversation_drafts WHERE conversation_id = $1",
    [conversationId],
  )
  if (!rows.length) return null
  const blocos = parseBlocos(rows[0].blocos ?? "[]")
  return {
    text: rows[0].text,
    attachments: parseAttachments(rows[0].attachments),
    mentionValues: parseStrings(rows[0].mention_values),
    ...(blocos.length > 0 ? { blocos } : {}),
  }
}

export async function saveComposerDraft(
  conversationId: string,
  draft: PersistedComposerDraft,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureComposerDraftTables(db)
  if (!draft.text.trim() && draft.attachments.length === 0 && !draft.blocos?.length) {
    await deleteComposerDraft(conversationId)
    return
  }
  await db.execute(
    `INSERT INTO conversation_drafts (conversation_id, text, attachments, mention_values, blocos, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(conversation_id) DO UPDATE SET
       text = excluded.text,
       attachments = excluded.attachments,
       mention_values = excluded.mention_values,
       blocos = excluded.blocos,
       updated_at = excluded.updated_at`,
    [
      conversationId,
      draft.text,
      JSON.stringify(draft.attachments),
      JSON.stringify(draft.mentionValues),
      JSON.stringify(draft.blocos ?? []),
      Date.now(),
    ],
  )
}

export async function deleteComposerDraft(conversationId: string): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureComposerDraftTables(db)
  await db.execute("DELETE FROM conversation_drafts WHERE conversation_id = $1", [
    conversationId,
  ])
}
