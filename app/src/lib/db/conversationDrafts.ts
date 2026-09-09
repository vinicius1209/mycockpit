import type { Attachment } from "@/lib/attachments"
import { getDb } from "@/lib/db"
import { ensureComposerDraftTables } from "@/lib/db/schema"

export interface PersistedComposerDraft {
  text: string
  attachments: Attachment[]
  mentionValues: string[]
}

interface DraftRow {
  text: string
  attachments: string
  mention_values: string
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
    "SELECT text, attachments, mention_values FROM conversation_drafts WHERE conversation_id = $1",
    [conversationId],
  )
  if (!rows.length) return null
  return {
    text: rows[0].text,
    attachments: parseAttachments(rows[0].attachments),
    mentionValues: parseStrings(rows[0].mention_values),
  }
}

export async function saveComposerDraft(
  conversationId: string,
  draft: PersistedComposerDraft,
): Promise<void> {
  const db = await getDb()
  if (!db) return
  await ensureComposerDraftTables(db)
  if (!draft.text.trim() && draft.attachments.length === 0) {
    await deleteComposerDraft(conversationId)
    return
  }
  await db.execute(
    `INSERT INTO conversation_drafts (conversation_id, text, attachments, mention_values, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(conversation_id) DO UPDATE SET
       text = excluded.text,
       attachments = excluded.attachments,
       mention_values = excluded.mention_values,
       updated_at = excluded.updated_at`,
    [
      conversationId,
      draft.text,
      JSON.stringify(draft.attachments),
      JSON.stringify(draft.mentionValues),
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
