import { create } from "zustand"
import { persist } from "zustand/middleware"

export type NotifKind =
  | "run_done"
  | "run_error"
  | "limit"
  | "gate"
  /** Pedido de permissão: o turno está PARADO esperando aprovar/negar. */
  | "approval"
  /** Pergunta estruturada (`ask_user`): o turno está PARADO esperando resposta.
   *  Irmão do approval — a diferença é que aqui o modelo quer CONTEÚDO, não
   *  autorização (ver docs/interactive-input.md). */
  | "question"
  /** Algo aconteceu sem você (ADR-261): o navegador caiu, uma atualização
   *  chegou. O toast some; a cópia fica aqui. */
  | "evento"

export interface Notification {
  id: string
  kind: NotifKind
  title: string
  subtitle: string
  /** (M2) O que o turno FEZ, quando ele rodou em background e o helper
   *  respondeu a tempo. Opcional: item antigo (já persistido) e turno de
   *  primeiro plano simplesmente não têm — e o sino não desenha linha vazia. */
  body?: string
  projectId: string
  convId?: string
  /** O que gerou o aviso, quando ele fala de trabalho de uma conversa. É o que
   *  o sino usa para agrupar e rotular (ADR-271); item sem origem é de antes
   *  dela ou não é trabalho de conversa. */
  origem?: "turno" | "missao" | "trabalho"
  ts: number
  read: boolean
}

interface NotifState {
  items: Notification[]
  push: (n: Omit<Notification, "id" | "ts" | "read">) => void
  markRead: (id: string) => void
  markAllRead: () => void
  /** Tudo da conversa vira visto: ela está na sua frente (ADR-271). */
  markConvRead: (convId: string) => void
  /** Remove UMA notificação do feed (dispensar individual). */
  remove: (id: string) => void
  clear: () => void
  /** Devolve itens tirados (o desfazer do limpar), sem duplicar. */
  restore: (items: Notification[]) => void
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
      markConvRead: (convId) =>
        set((s) =>
          s.items.some((x) => x.convId === convId && !x.read)
            ? {
                items: s.items.map((x) =>
                  x.convId === convId && !x.read ? { ...x, read: true } : x,
                ),
              }
            : s,
        ),
      remove: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
      clear: () => set({ items: [] }),
      restore: (items) =>
        set((s) => {
          const ids = new Set(s.items.map((x) => x.id))
          return {
            items: [...s.items, ...items.filter((x) => !ids.has(x.id))]
              .sort((a, b) => b.ts - a.ts)
              .slice(0, MAX),
          }
        }),
    }),
    { name: "mc.notifs", version: 1 },
  ),
)
