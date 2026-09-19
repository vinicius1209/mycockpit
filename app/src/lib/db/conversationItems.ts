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

/**
 * Retrofit PREGUIÇOSO para a fonte itemizada (F3 do PRD da busca no fio).
 *
 * Conversa anterior à migração 48 vive só no blob `conversations.items`. Ela
 * continua respondendo busca (o gateway varre o blob), mas fora do índice, que
 * é mais rápido e casa substring. Aqui ela entra na fonte nova na PRIMEIRA vez
 * que é aberta, e os triggers de `conversation_item_fts` a indexam sozinhos.
 *
 * Por que aqui e não numa migração em SQL: o carregamento PREFERE a fonte
 * itemizada ao blob (`loadConversation`). Um snapshot montado à mão com
 * `json_each` que saísse torto passaria a ser o que a pessoa vê, e o histórico
 * apareceria danificado. Estes `items` são os que acabaram de ser lidos e vão
 * para a tela: o snapshot não tem como divergir do que ela enxerga.
 *
 * Fail-open: falhar aqui não pode atrapalhar abrir a conversa. O blob segue
 * sendo a fonte, a busca segue varrendo, e a próxima abertura tenta de novo.
 * Conversa vazia NÃO é itemizada: gravar `item_count = 0` faria o carregamento
 * preferir uma lista vazia ao blob, e isso é perda de histórico, não retrofit.
 */
export async function itemizarSeFaltando(
  conversationId: string,
  items: readonly ChatItem[],
): Promise<void> {
  if (!isTauri() || items.length === 0) return
  try {
    await saveConversationItemChanges(
      conversationId,
      items,
      items.map((_, position) => position),
      true,
    )
  } catch (error) {
    console.warn("[conversation-items] retrofit adiado", error)
  }
}
