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
  streamingTextId: null,
  running: false,
  projectId: null,

  resetFor: (projectId) =>
    set({
      items: [],
      sessionId: null,
      model: null,
      streamingTextId: null,
      running: false,
      projectId,
    }),

  hydrate: (projectId, items, sessionId) =>
    set({
      items,
      sessionId,
      model: null,
      streamingTextId: null,
      running: false,
      projectId,
    }),

  start: (text) =>
    set((s) => ({
      items: [...s.items, { kind: "user", id: uid(), text }],
      streamingTextId: null,
      running: true,
    })),

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
