import { create } from "zustand"
import { persist } from "zustand/middleware"

export type NotifKind = "run_done" | "run_error" | "limit"

export interface Notification {
  id: string
  kind: NotifKind
  title: string
  subtitle: string
  projectId: string
  convId?: string
  ts: number
  read: boolean
}

interface NotifState {
  items: Notification[]
  push: (n: Omit<Notification, "id" | "ts" | "read">) => void
  markRead: (id: string) => void
  markAllRead: () => void
  clear: () => void
}

const MAX = 50 // guarda só os recentes (o feed não é histórico infinito).

export const useNotifs = create<NotifState>()(
  persist(
    (set) => ({
      items: [],
      push: (n) =>
        set((s) => ({
          items: [
            { ...n, id: crypto.randomUUID(), ts: Date.now(), read: false },
            ...s.items,
          ].slice(0, MAX),
        })),
      markRead: (id) =>
        set((s) => ({
          items: s.items.map((x) => (x.id === id ? { ...x, read: true } : x)),
        })),
      markAllRead: () =>
        set((s) => ({ items: s.items.map((x) => ({ ...x, read: true })) })),
      clear: () => set({ items: [] }),
    }),
    { name: "mc.notifs", version: 1 },
  ),
)
