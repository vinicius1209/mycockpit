import { create } from "zustand"
import type { AgentEvent } from "@/lib/agent"
import {
  listConversations as dbList,
  loadConversation as dbLoad,
  createConversation as dbCreate,
  saveConversation as dbSave,
  deleteConversation as dbDelete,
  type ConversationMeta,
} from "@/lib/db"

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "text"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown }
  | {
      kind: "result"
      id: string
      ok: boolean
      text?: string
      costUsd?: number
      model?: string | null
      usage?: {
        input: number
        output: number
        cacheRead: number
        cacheCreation: number
      }
    }
  | { kind: "error"; id: string; message: string }
  | { kind: "cancelled"; id: string }

interface ChatState {
  items: ChatItem[]
  sessionId: string | null
  model: string | null
  /** Id da bolha de texto em streaming (H2). null = nenhuma aberta. */
  streamingTextId: string | null
  running: boolean
  projectId: string | null
  conversationId: string | null
  conversations: ConversationMeta[]
  /** Sugestões dinâmicas pós-turno (Sprint 3). */
  suggestions: string[]
  suggesting: boolean

  setSuggestions: (s: string[]) => void
  setSuggesting: (v: boolean) => void
  openProject: (projectId: string | null) => Promise<void>
  newConversation: (projectId: string) => Promise<void>
  switchConversation: (id: string) => Promise<void>
  removeConversation: (id: string) => Promise<void>
  persist: () => Promise<void>
  start: (text: string) => void
  handleEvent: (e: AgentEvent) => void
  finish: () => void
}

function uid(): string {
  return crypto.randomUUID()
}

/** Título derivado do 1º prompt do usuário (S4). */
function deriveTitle(items: ChatItem[]): string | null {
  const first = items.find((it) => it.kind === "user")
  if (first && first.kind === "user") {
    const t = first.text.trim().replace(/\s+/g, " ")
    return t.length > 44 ? `${t.slice(0, 44)}…` : t
  }
  return null
}

/** Estado base de uma conversa "limpa" (não toca projeto/conversa/lista). */
function freshState() {
  return {
    items: [] as ChatItem[],
    sessionId: null as string | null,
    model: null as string | null,
    streamingTextId: null as string | null,
    running: false,
    suggestions: [] as string[],
    suggesting: false,
  }
}

export const useChat = create<ChatState>((set, get) => ({
  items: [],
  sessionId: null,
  model: null,
  streamingTextId: null,
  running: false,
  projectId: null,
  conversationId: null,
  conversations: [],
  suggestions: [],
  suggesting: false,

  setSuggestions: (suggestions) => set({ suggestions }),
  setSuggesting: (suggesting) => set({ suggesting }),

  // S1/S2 — abre um projeto: carrega a lista de conversas e a mais recente
  // (ou cria a primeira se o projeto ainda não tiver nenhuma).
  openProject: async (projectId) => {
    if (!projectId) {
      set({ ...freshState(), projectId: null, conversationId: null, conversations: [] })
      return
    }
    const list = (await dbList(projectId)) ?? []
    if (list.length === 0) {
      const id = uid()
      await dbCreate(projectId, id)
      set({
        ...freshState(),
        projectId,
        conversationId: id,
        conversations: [{ id, title: null, updatedAt: Date.now() }],
      })
      return
    }
    const conv = await dbLoad(list[0].id)
    set({
      ...freshState(),
      items: conv?.items ?? [],
      sessionId: conv?.sessionId ?? null,
      projectId,
      conversationId: list[0].id,
      conversations: list,
    })
  },

  newConversation: async (projectId) => {
    if (get().running) return
    const id = uid()
    await dbCreate(projectId, id)
    set((s) => ({
      ...freshState(),
      projectId,
      conversationId: id,
      conversations: [
        { id, title: null, updatedAt: Date.now() },
        ...s.conversations,
      ],
    }))
  },

  switchConversation: async (id) => {
    const s = get()
    if (s.running || s.conversationId === id) return
    const conv = await dbLoad(id)
    set({
      ...freshState(),
      items: conv?.items ?? [],
      sessionId: conv?.sessionId ?? null,
      conversationId: id,
    })
  },

  removeConversation: async (id) => {
    await dbDelete(id)
    const s = get()
    const remaining = s.conversations.filter((c) => c.id !== id)
    if (s.conversationId !== id) {
      set({ conversations: remaining })
      return
    }
    // a conversa ativa foi removida → abre a próxima ou cria uma nova
    if (remaining.length > 0) {
      const conv = await dbLoad(remaining[0].id)
      set({
        ...freshState(),
        items: conv?.items ?? [],
        sessionId: conv?.sessionId ?? null,
        conversationId: remaining[0].id,
        conversations: remaining,
      })
    } else if (s.projectId) {
      const id = uid()
      await dbCreate(s.projectId, id)
      set({
        ...freshState(),
        conversationId: id,
        conversations: [{ id, title: null, updatedAt: Date.now() }],
      })
    } else {
      set({ ...freshState(), conversationId: null, conversations: [] })
    }
  },

  // Salva a conversa ativa + atualiza a lista (título + ordem).
  persist: async () => {
    const s = get()
    if (!s.projectId || !s.conversationId) return
    const title = deriveTitle(s.items)
    await dbSave(s.conversationId, s.projectId, title, s.sessionId, s.items)
    const now = Date.now()
    set((st) => ({
      conversations: st.conversations
        .map((c) =>
          c.id === st.conversationId ? { ...c, title, updatedAt: now } : c,
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
    }))
  },

  start: (text) =>
    set((s) => {
      const items = [...s.items, { kind: "user" as const, id: uid(), text }]
      // título imediato na lista a partir do 1º prompt (S4)
      const conversations = s.conversations.map((c) =>
        c.id === s.conversationId && !c.title
          ? { ...c, title: deriveTitle(items) }
          : c,
      )
      return {
        items,
        conversations,
        streamingTextId: null,
        running: true,
        suggestions: [],
        suggesting: false,
      }
    }),

  handleEvent: (e) =>
    set((s) => {
      switch (e.type) {
        case "session":
          return { sessionId: e.session_id, model: e.model }
        // H2 — texto completo do assistant: se já veio por deltas, descarta (dedup);
        // senão (CLI sem partial messages) renderiza.
        case "text":
          if (s.streamingTextId) return { streamingTextId: null }
          return {
            items: [...s.items, { kind: "text", id: uid(), text: e.text }],
          }
        // H2 — delta em streaming: acumula na bolha corrente (cria se não houver).
        case "text_delta":
          if (s.streamingTextId) {
            return {
              items: s.items.map((it) =>
                it.id === s.streamingTextId && it.kind === "text"
                  ? { ...it, text: it.text + e.text }
                  : it,
              ),
            }
          } else {
            const id = uid()
            return {
              items: [...s.items, { kind: "text", id, text: e.text }],
              streamingTextId: id,
            }
          }
        case "tool":
          return {
            items: [
              ...s.items,
              { kind: "tool", id: uid(), name: e.name, input: e.input },
            ],
            streamingTextId: null,
          }
        case "result":
          return {
            items: [
              ...s.items,
              {
                kind: "result",
                id: uid(),
                ok: e.ok,
                text: e.text ?? undefined,
                costUsd: e.cost_usd ?? undefined,
                model: s.model,
                usage: {
                  input: e.input_tokens,
                  output: e.output_tokens,
                  cacheRead: e.cache_read,
                  cacheCreation: e.cache_creation,
                },
              },
            ],
            running: false,
            streamingTextId: null,
          }
        // H3 — erro do processo/agent.
        case "error":
          return {
            items: [
              ...s.items,
              { kind: "error", id: uid(), message: e.message },
            ],
            running: false,
            streamingTextId: null,
          }
        // H1 — run interrompido pelo usuário.
        case "cancelled":
          return {
            items: [...s.items, { kind: "cancelled", id: uid() }],
            running: false,
            streamingTextId: null,
          }
        case "done":
          return { running: false, streamingTextId: null }
        default:
          return {}
      }
    }),

  finish: () => set({ running: false, streamingTextId: null }),
}))
