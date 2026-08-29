import { create } from "zustand"
import { toast } from "sonner"
import type { Attachment } from "@/lib/attachments"
import {
  deleteComposerDraft,
  loadComposerDraft,
  saveComposerDraft,
} from "@/lib/db/conversationDrafts"

export interface ComposerDraft {
  text: string
  attachments: Attachment[]
}

const EMPTY: ComposerDraft = { text: "", attachments: [] }
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const inflight = new Map<string, Promise<void>>()
const writes = new Map<string, Promise<void>>()
const failed = new Set<string>()

export function hasComposerDraft(draft: ComposerDraft | undefined): boolean {
  return !!draft && (!!draft.text.trim() || draft.attachments.length > 0)
}

interface ComposerDraftState {
  byConv: Record<string, ComposerDraft>
  /** Presente significa que `byConv[id]` (inclusive ausente) é autoritativo. */
  loaded: Record<string, true>
  load: (conversationId: string) => Promise<void>
  setText: (conversationId: string, text: string) => void
  setAttachments: (conversationId: string, attachments: Attachment[]) => void
  clear: (conversationId: string) => void
  /** Conversa apagada: limpa memória/timer; o FK recolhe a linha no banco. */
  forget: (conversationId: string) => void
  flush: (conversationId: string) => Promise<void>
}

function announceFailure(conversationId: string): void {
  if (failed.has(conversationId)) return
  failed.add(conversationId)
  toast.error("Não consegui salvar o rascunho.", {
    description: "Ele continua nesta sessão; tente novamente antes de fechar o app.",
  })
}

export const useComposerDrafts = create<ComposerDraftState>((set, get) => {
  const serialWrite = (conversationId: string, write: () => Promise<void>) => {
    const previous = writes.get(conversationId) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(write)
    writes.set(conversationId, current)
    void current.finally(() => {
      if (writes.get(conversationId) === current) writes.delete(conversationId)
    })
    return current
  }

  const persistNow = async (conversationId: string) => {
    const draft = get().byConv[conversationId] ?? EMPTY
    try {
      await serialWrite(conversationId, () => saveComposerDraft(conversationId, draft))
      failed.delete(conversationId)
    } catch {
      announceFailure(conversationId)
    }
  }

  const schedule = (conversationId: string) => {
    const previous = timers.get(conversationId)
    if (previous) clearTimeout(previous)
    timers.set(
      conversationId,
      setTimeout(() => {
        timers.delete(conversationId)
        void persistNow(conversationId)
      }, 400),
    )
  }

  const patch = (conversationId: string, draft: ComposerDraft) => {
    set((state) => ({
      byConv: { ...state.byConv, [conversationId]: draft },
      loaded: { ...state.loaded, [conversationId]: true },
    }))
    schedule(conversationId)
  }

  return {
    byConv: {},
    loaded: {},
    load: async (conversationId) => {
      if (get().loaded[conversationId]) return
      const pending = inflight.get(conversationId)
      if (pending) return pending
      const run = (async () => {
        try {
          const draft = await loadComposerDraft(conversationId)
          // Digitação durante a leitura já marcou o id como carregado e vence.
          if (get().loaded[conversationId]) return
          set((state) => ({
            byConv: draft
              ? { ...state.byConv, [conversationId]: draft }
              : state.byConv,
            loaded: { ...state.loaded, [conversationId]: true },
          }))
        } catch {
          announceFailure(conversationId)
        } finally {
          inflight.delete(conversationId)
        }
      })()
      inflight.set(conversationId, run)
      return run
    },
    setText: (conversationId, text) => {
      const current = get().byConv[conversationId] ?? EMPTY
      patch(conversationId, { ...current, text })
    },
    setAttachments: (conversationId, attachments) => {
      const current = get().byConv[conversationId] ?? EMPTY
      patch(conversationId, { ...current, attachments })
    },
    clear: (conversationId) => {
      const timer = timers.get(conversationId)
      if (timer) clearTimeout(timer)
      timers.delete(conversationId)
      set((state) => {
        const byConv = { ...state.byConv }
        delete byConv[conversationId]
        return { byConv, loaded: { ...state.loaded, [conversationId]: true } }
      })
      void serialWrite(conversationId, () => deleteComposerDraft(conversationId)).catch(
        () => announceFailure(conversationId),
      )
    },
    forget: (conversationId) => {
      const timer = timers.get(conversationId)
      if (timer) clearTimeout(timer)
      timers.delete(conversationId)
      failed.delete(conversationId)
      set((state) => {
        const byConv = { ...state.byConv }
        const loaded = { ...state.loaded }
        delete byConv[conversationId]
        delete loaded[conversationId]
        return { byConv, loaded }
      })
    },
    flush: async (conversationId) => {
      const timer = timers.get(conversationId)
      if (timer) clearTimeout(timer)
      timers.delete(conversationId)
      await persistNow(conversationId)
    },
  }
})
