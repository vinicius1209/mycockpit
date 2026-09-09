import { saveConversationItemChanges } from "@/lib/db/conversationItems"
import type { ChatItem } from "@/store/chat"

interface PersistableConversation {
  items: ChatItem[]
  corrupt?: boolean
}

interface ChatLookup {
  byId: Record<string, PersistableConversation>
}

/** Fila incremental por conversa. Isolada do store para manter a redução de
 * eventos legível e impedir que a catraca de tamanho volte a crescer. */
export function createItemPersistence(get: () => ChatLookup) {
  const timers: Record<string, ReturnType<typeof setTimeout>> = {}
  const dirtyPositions = new Map<string, Set<number>>()
  const dirtyCounts = new Map<string, number>()
  const ready = new Set<string>()
  const tails = new Map<string, Promise<void>>()

  const queue = (
    convId: string,
    items: readonly ChatItem[],
    positions: readonly number[],
    forceAll = false,
  ): Promise<void> => {
    const snapshot = [...items]
    const selected = forceAll
      ? snapshot.map((_, position) => position)
      : [...positions]
    const previous = tails.get(convId) ?? Promise.resolve()
    const write = previous
      .catch(() => {})
      .then(async () => {
        const replaceAll = !ready.has(convId)
        const revision = await saveConversationItemChanges(
          convId,
          snapshot,
          replaceAll ? snapshot.map((_, position) => position) : selected,
          replaceAll,
        )
        if (revision != null) ready.add(convId)
      })
      .catch((error) => {
        console.warn("[chat] persistência incremental indisponível", error)
        const dirty = dirtyPositions.get(convId) ?? new Set<number>()
        for (const position of selected) dirty.add(position)
        dirtyPositions.set(convId, dirty)
        dirtyCounts.set(convId, snapshot.length)
      })
      .finally(() => {
        if (tails.get(convId) === write) tails.delete(convId)
      })
    tails.set(convId, write)
    return write
  }

  const flushDirty = (convId: string): Promise<void> => {
    const conversation = get().byId[convId]
    if (!conversation || conversation.corrupt) return Promise.resolve()
    const positions = [...(dirtyPositions.get(convId) ?? [])]
    const countChanged = dirtyCounts.has(convId)
    dirtyPositions.delete(convId)
    dirtyCounts.delete(convId)
    if (!positions.length && !countChanged) return Promise.resolve()
    return queue(convId, conversation.items, positions)
  }

  const cancel = (convId: string) => {
    if (!timers[convId]) return
    clearTimeout(timers[convId])
    delete timers[convId]
  }

  return {
    schedule(convId: string, positions: readonly number[], itemCount: number) {
      const dirty = dirtyPositions.get(convId) ?? new Set<number>()
      for (const position of positions) dirty.add(position)
      dirtyPositions.set(convId, dirty)
      dirtyCounts.set(convId, itemCount)
      if (timers[convId]) return
      timers[convId] = setTimeout(() => {
        delete timers[convId]
        void flushDirty(convId)
      }, 1200)
    },
    cancel,
    async flush(convId: string) {
      cancel(convId)
      await flushDirty(convId)
      await tails.get(convId)
    },
    async replaceAll(convId: string, items: readonly ChatItem[]) {
      cancel(convId)
      dirtyPositions.delete(convId)
      dirtyCounts.delete(convId)
      await queue(
        convId,
        items,
        items.map((_, position) => position),
        true,
      )
    },
  }
}
