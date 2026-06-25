import { create } from "zustand"
import type { AgentEvent } from "@/lib/agent"

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "text"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown }
  | {
      kind: "result"
      id: string
      ok: boolean
      costUsd?: number
      model?: string | null
      usage?: {
        input: number
        output: number
        cacheRead: number
        cacheCreation: number
      }
    }

interface ChatState {
  items: ChatItem[]
  sessionId: string | null
  model: string | null
  running: boolean
  projectId: string | null

  resetFor: (projectId: string | null) => void
  hydrate: (
    projectId: string | null,
    items: ChatItem[],
    sessionId: string | null,
  ) => void
  start: (text: string) => void
  handleEvent: (e: AgentEvent) => void
  finish: () => void
}

function uid(): string {
  return crypto.randomUUID()
}

export const useChat = create<ChatState>((set) => ({
  items: [],
  sessionId: null,
  model: null,
  running: false,
  projectId: null,

  resetFor: (projectId) =>
    set({ items: [], sessionId: null, model: null, running: false, projectId }),

  hydrate: (projectId, items, sessionId) =>
    set({ items, sessionId, model: null, running: false, projectId }),

  start: (text) =>
    set((s) => ({
      items: [...s.items, { kind: "user", id: uid(), text }],
      running: true,
    })),

  handleEvent: (e) =>
    set((s) => {
      switch (e.type) {
        case "session":
          return { sessionId: e.session_id, model: e.model }
        case "text":
          return { items: [...s.items, { kind: "text", id: uid(), text: e.text }] }
        case "tool":
          return {
            items: [
              ...s.items,
              { kind: "tool", id: uid(), name: e.name, input: e.input },
            ],
          }
        case "result":
          return {
            items: [
              ...s.items,
              {
                kind: "result",
                id: uid(),
                ok: e.ok,
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
          }
        case "done":
          return { running: false }
        default:
          return {}
      }
    }),

  finish: () => set({ running: false }),
}))
