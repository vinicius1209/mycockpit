import { create } from "zustand"
import type { AgentEvent } from "@/lib/agent"

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "text"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown }
  | { kind: "result"; id: string; ok: boolean; costUsd?: number }

interface ChatState {
  items: ChatItem[]
  sessionId: string | null
  running: boolean
  projectId: string | null

  resetFor: (projectId: string | null) => void
  start: (text: string) => void
  handleEvent: (e: AgentEvent) => void
  finish: () => void
}

let counter = 0
function uid(): string {
  counter += 1
  return `i${counter}`
}

export const useChat = create<ChatState>((set) => ({
  items: [],
  sessionId: null,
  running: false,
  projectId: null,

  resetFor: (projectId) =>
    set({ items: [], sessionId: null, running: false, projectId }),

  start: (text) =>
    set((s) => ({
      items: [...s.items, { kind: "user", id: uid(), text }],
      running: true,
    })),

  handleEvent: (e) =>
    set((s) => {
      switch (e.type) {
        case "session":
          return { sessionId: e.session_id }
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
