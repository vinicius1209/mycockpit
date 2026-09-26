import { create } from "zustand"
import { avisar } from "@/lib/avisos"
import type { Attachment } from "@/lib/attachments"
import { comNovaCitacao, type BlocoCitacao, type BlocoDoRascunho } from "@/lib/citacao"
import type { BlocoMarcacao } from "@/lib/marcacao"
import { alternarParecer, type BlocoParecer } from "@/lib/parecerTrazido"
import {
  deleteComposerDraft,
  loadComposerDraft,
  saveComposerDraft,
} from "@/lib/db/conversationDrafts"

export interface ComposerDraft {
  text: string
  attachments: Attachment[]
  mentionValues: string[]
  /** Blocos fora do texto do editor (hoje, citações: capricho PRD R4).
   *  Ausente = nenhum. */
  blocos?: BlocoDoRascunho[]
}

const EMPTY: ComposerDraft = { text: "", attachments: [], mentionValues: [] }
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const inflight = new Map<string, Promise<void>>()
const writes = new Map<string, Promise<void>>()
const failed = new Set<string>()

/** Texto que um gesto de fora do composer (citar arquivo, comentários do diff,
 *  pedir correção) põe no rascunho: vai DEPOIS do que já foi escrito, separado
 *  por uma linha em branco. Trocar o texto inteiro apagava o que a pessoa
 *  estava digitando. */
export function acrescentarAoRascunho(atual: string, texto: string): string {
  if (!atual.trim()) return texto
  return `${atual.trimEnd()}\n\n${texto}`
}

export function hasComposerDraft(draft: ComposerDraft | undefined): boolean {
  return (
    !!draft &&
    (!!draft.text.trim() || draft.attachments.length > 0 || (draft.blocos?.length ?? 0) > 0)
  )
}

interface ComposerDraftState {
  byConv: Record<string, ComposerDraft>
  /** Presente significa que `byConv[id]` (inclusive ausente) é autoritativo. */
  loaded: Record<string, true>
  load: (conversationId: string) => Promise<void>
  setText: (conversationId: string, text: string) => void
  /** Acrescenta ao rascunho sem apagar o que já foi escrito. */
  appendText: (conversationId: string, text: string) => void
  /** Acrescenta uma citação; `false` quando o teto de citações recusou. */
  addCitacao: (conversationId: string, citacao: BlocoCitacao) => boolean
  /** Parecer de conselheiro trazido para o próximo turno (Especialistas E1).
   *  O MESMO gesto traz e tira: clicar de novo não acumula em dobro. */
  alternarParecer: (conversationId: string, bloco: BlocoParecer) => void
  /** Aceite do turno: os pareceres que viajaram saem do rascunho. Explícito
   *  porque nem todo envio limpa o composer (fila, reenvio), e o mesmo parecer
   *  não pode entrar em dois turnos. */
  tirarPareceres: (conversationId: string) => void
  /** Região marcada no navegador vira bloco (navegador R4). */
  addMarcacao: (conversationId: string, marcacao: BlocoMarcacao) => void
  /** Colagem grande vira bloco (capricho R7). */
  addColagem: (conversationId: string, texto: string) => void
  removeBloco: (conversationId: string, index: number) => void
  setBlocos: (conversationId: string, blocos: BlocoDoRascunho[]) => void
  setAttachments: (conversationId: string, attachments: Attachment[]) => void
  setMentionValues: (conversationId: string, mentionValues: string[]) => void
  clear: (conversationId: string) => void
  /** Conversa apagada: limpa memória/timer; o FK recolhe a linha no banco. */
  forget: (conversationId: string) => void
  flush: (conversationId: string) => Promise<void>
}

function announceFailure(conversationId: string): void {
  if (failed.has(conversationId)) return
  failed.add(conversationId)
  avisar.erro("Não consegui salvar o rascunho.", {
    detalhe: "Ele continua nesta sessão; tente novamente antes de fechar o app.",
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
    appendText: (conversationId, text) => {
      const current = get().byConv[conversationId] ?? EMPTY
      patch(conversationId, { ...current, text: acrescentarAoRascunho(current.text, text) })
    },
    addCitacao: (conversationId, citacao) => {
      const current = get().byConv[conversationId] ?? EMPTY
      const { blocos, coube } = comNovaCitacao(current.blocos ?? [], citacao)
      if (coube) patch(conversationId, { ...current, blocos })
      return coube
    },
    alternarParecer: (conversationId, bloco) => {
      const current = get().byConv[conversationId] ?? EMPTY
      patch(conversationId, {
        ...current,
        blocos: alternarParecer(current.blocos, bloco) as BlocoDoRascunho[],
      })
    },
    tirarPareceres: (conversationId) => {
      const current = get().byConv[conversationId] ?? EMPTY
      const blocos = (current.blocos ?? []).filter((b) => b.tipo !== "parecer")
      if (blocos.length === (current.blocos?.length ?? 0)) return
      patch(conversationId, { ...current, blocos })
    },
    addMarcacao: (conversationId, marcacao) => {
      const current = get().byConv[conversationId] ?? EMPTY
      patch(conversationId, { ...current, blocos: [...(current.blocos ?? []), marcacao] })
    },
    addColagem: (conversationId, texto) => {
      const current = get().byConv[conversationId] ?? EMPTY
      const bloco = { tipo: "colagem" as const, id: crypto.randomUUID(), texto }
      patch(conversationId, { ...current, blocos: [...(current.blocos ?? []), bloco] })
    },
    removeBloco: (conversationId, index) => {
      const current = get().byConv[conversationId] ?? EMPTY
      const blocos = (current.blocos ?? []).filter((_, i) => i !== index)
      patch(conversationId, { ...current, blocos })
    },
    setBlocos: (conversationId, blocos) => {
      const current = get().byConv[conversationId] ?? EMPTY
      patch(conversationId, { ...current, blocos })
    },
    setAttachments: (conversationId, attachments) => {
      const current = get().byConv[conversationId] ?? EMPTY
      patch(conversationId, { ...current, attachments })
    },
    setMentionValues: (conversationId, mentionValues) => {
      const current = get().byConv[conversationId] ?? EMPTY
      const previous = current.mentionValues ?? []
      const unique = [...new Set(mentionValues)]
      if (
        unique.length === previous.length &&
        unique.every((value, index) => value === previous[index])
      ) return
      patch(conversationId, { ...current, mentionValues: unique })
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
