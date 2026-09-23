import { changedItemPositions, saveConversationItemChanges } from "@/lib/db/conversationItems"
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
  /** O que o último `persistir` gravou de cada conversa. O próximo compara
   *  identidade com ele e grava só as posições que mudaram. Só `persistir`
   *  mexe aqui: a fila de streaming grava um SUBCONJUNTO (o que ela viu mudar
   *  por evento), e usar o snapshot dela esconderia mudança feita por fora
   *  dos eventos (reação, remoção, nota). */
  const ultimoPersistido = new Map<string, readonly ChatItem[]>()

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
    /** O persist da conversa (ADR-230). O primeiro da sessão grava tudo; os
     *  seguintes, só as posições cuja identidade mudou desde o anterior. Antes
     *  todo persist regravava a conversa inteira (1.358 itens, ~3,2 MB pela
     *  ponte na maior), no começo e no fim de cada turno. */
    async persistir(convId: string, items: readonly ChatItem[]) {
      const anterior = ultimoPersistido.get(convId)
      if (!anterior || !ready.has(convId)) {
        ultimoPersistido.delete(convId)
        await this.replaceAll(convId, items)
        if (ready.has(convId)) ultimoPersistido.set(convId, [...items])
        return
      }
      const mudou = new Set<number>(dirtyPositions.get(convId) ?? [])
      for (const position of changedItemPositions(anterior, items)) mudou.add(position)
      cancel(convId)
      dirtyPositions.delete(convId)
      dirtyCounts.delete(convId)
      if (mudou.size === 0 && anterior.length === items.length) return
      const snapshot = [...items]
      await queue(convId, snapshot, [...mudou])
      // Falhou: a fila guardou as posições como sujas, e o próximo persist
      // regrava tudo por segurança.
      if (dirtyPositions.has(convId)) ultimoPersistido.delete(convId)
      else ultimoPersistido.set(convId, snapshot)
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
