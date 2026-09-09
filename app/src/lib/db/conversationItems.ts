import { invoke } from "@tauri-apps/api/core"
import { getDb, isTauri } from "@/lib/db"
import { ensureConversationItemTables } from "@/lib/db/schema"
import type { ChatItem } from "@/store/chat"

interface IncrementalSnapshot {
  revision: number
  items: string[]
}

export interface ItemChange {
  position: number
  itemId: string
  itemJson: string
}

/** Identidades React preservadas pelo reducer viram um change-set barato. */
export function changedItemPositions(
  before: readonly ChatItem[],
  after: readonly ChatItem[],
): number[] {
  const positions: number[] = []
  for (let position = 0; position < after.length; position++) {
    if (before[position] !== after[position]) positions.push(position)
  }
  return positions
}

export function itemChanges(
  items: readonly ChatItem[],
  positions: readonly number[],
): ItemChange[] {
  return [...new Set(positions)]
    .filter((position) => position >= 0 && position < items.length)
    .sort((a, b) => a - b)
    .map((position) => ({
      position,
      itemId: items[position].id,
      itemJson: JSON.stringify(items[position]),
    }))
}

async function ensureTables(): Promise<boolean> {
  const db = await getDb()
  if (!db) return false
  await ensureConversationItemTables(db)
  return true
}

/** Um invoke, uma transação SQLite. `replaceAll` é usado uma vez por conversa
 * na primeira escrita da nova fonte; depois somente posições alteradas cruzam
 * a ponte JS/Rust. */
export async function saveConversationItemChanges(
  conversationId: string,
  items: readonly ChatItem[],
  positions: readonly number[],
  replaceAll: boolean,
): Promise<number | null> {
  if (!(await ensureTables())) return null
  const selected = replaceAll
    ? items.map((_, position) => position)
    : positions
  return invoke<number>("save_conversation_item_changes", {
    conversationId,
    changes: itemChanges(items, selected),
    itemCount: items.length,
    replaceAll,
  })
}

/** Fonte incremental preferida quando sua revisão/contagem foi publicada
 * atomicamente. Falha de comando ou JSON degrada para o snapshot legado. */
export async function loadConversationItemSnapshot(
  conversationId: string,
): Promise<ChatItem[] | null> {
  if (!isTauri()) return null
  try {
    if (!(await ensureTables())) return null
    const snapshot = await invoke<IncrementalSnapshot | null>(
      "load_conversation_items",
      { conversationId },
    )
    if (!snapshot) return null
    return snapshot.items.map((item) => JSON.parse(item) as ChatItem)
  } catch (error) {
    console.warn("[conversation-items] snapshot incremental indisponível", error)
    return null
  }
}
