import { create } from "zustand"
import type { AgentEvent, CostSource } from "@/lib/agent"
import type { Attachment } from "@/lib/attachments"
import { wipeAttachments } from "@/lib/attachments"
import type { FusionCandidate } from "@/store/fusion"
import {
  listConversations as dbList,
  loadConversation as dbLoad,
  createConversation as dbCreate,
  saveConversation as dbSave,
  deleteConversation as dbDelete,
  type ConversationMeta,
} from "@/lib/db"

export type ChatItem =
  | { kind: "user"; id: string; text: string; attachments?: Attachment[] }
  | { kind: "text"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown }
  | {
      kind: "result"
      id: string
      ok: boolean
      text?: string
      costUsd?: number
      costSource?: CostSource
      model?: string | null
      usage?: {
        input: number
        output: number
        cacheRead: number
        cacheCreation: number
      }
      /** Duração total do turno em ms (start→result). */
      durationMs?: number
    }
  | { kind: "error"; id: string; message: string }
  | { kind: "cancelled"; id: string }
  | { kind: "notice"; id: string; message: string }

/** Estado de UMA conversa — vive em byId[convId]; runs em background escrevem aqui. */
export interface ConvState {
  projectId: string
  /** Agent que roda esta conversa (claude-code|codex|…) — trava no 1º run. */
  agent: string
  /** Modelo + effort escolhidos (null = default do CLI) — travam no 1º run. */
  reqModel: string | null
  effort: string | null
  items: ChatItem[]
  sessionId: string | null
  model: string | null
  /** Id da bolha de texto em streaming (H2). null = nenhuma aberta. */
  streamingTextId: string | null
  running: boolean
  /** Turno terminou (Result) mas o processo do CLI ainda finaliza — ex. flush da
   *  sessão do Codex. Bloqueia o próximo send p/ o resume não cair em "session
   *  not found" (corrida: liberar no Result dispara o resume antes do flush). */
  finalizing: boolean
  /** runId do run em andamento (p/ cancelar). */
  runId: string | null
  /** Timestamp (ms) de início do run atual — p/ cronômetro ao vivo. */
  startedAt: number | null
  /** Sugestões dinâmicas pós-turno (Sprint 3). */
  suggestions: string[]
  suggesting: boolean
}

interface ChatState {
  projectId: string | null
  activeId: string | null
  conversations: ConversationMeta[]
  /** Estado de cada conversa carregada (Sprint 4 — runs em background). */
  byId: Record<string, ConvState>
  /** Prompt enfileirado por outra UI (ex.: ⌘K) p/ o ChatPanel disparar. */
  queuedPrompt: string | null

  openProject: (projectId: string | null) => Promise<void>
  newConversation: (projectId: string) => Promise<void>
  switchConversation: (id: string) => Promise<void>
  removeConversation: (id: string) => Promise<void>
  persist: (convId: string) => Promise<void>
  start: (
    convId: string,
    text: string,
    runId: string,
    agent: string,
    model: string | null,
    effort: string | null,
    attachments: Attachment[],
  ) => void
  handleEvent: (convId: string, e: AgentEvent) => void
  finish: (convId: string) => void
  setSuggestions: (convId: string, s: string[]) => void
  setSuggesting: (convId: string, v: boolean) => void
  queuePrompt: (t: string | null) => void
  /** Fusion: add o balão do usuário à conversa + marca running (turno visível). */
  beginFusion: (convId: string, text: string, attachments: Attachment[]) => void
  /** Fusion: promove o vencedor — anexa os itens dele + assume sessão/agent. */
  promoteFusion: (convId: string, winner: FusionCandidate) => Promise<void>
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

function emptyConv(projectId: string): ConvState {
  return {
    projectId,
    agent: "claude-code",
    reqModel: null,
    effort: null,
    items: [],
    sessionId: null,
    model: null,
    streamingTextId: null,
    running: false,
    finalizing: false,
    runId: null,
    startedAt: null,
    suggestions: [],
    suggesting: false,
  }
}

const EMPTY_CONV = emptyConv("")

/** Campos de CONTEÚDO de uma conversa — o que o reducer de itens lê/escreve.
 *  Usado pelo Linear (via reduceEvent) e por cada lane do Fusion. */
export type ItemReducible = Pick<
  ConvState,
  "items" | "streamingTextId" | "model" | "sessionId" | "startedAt"
>

/** Núcleo PURO de itens (T1.1). NÃO mexe em running/finalizing/runId/startedAt —
 *  o controle fica no controlFlow (Linear) ou no status da lane (Fusion). */
export function reduceItems(
  c: ItemReducible,
  e: AgentEvent,
): Partial<ItemReducible> {
  switch (e.type) {
    case "session":
      return { sessionId: e.session_id, model: e.model }
    // H2 — texto completo do assistant: se já veio por deltas, descarta (dedup).
    case "text":
      if (c.streamingTextId) return { streamingTextId: null }
      return { items: [...c.items, { kind: "text", id: uid(), text: e.text }] }
    // H2 — delta em streaming: acumula na bolha corrente (cria se não houver).
    case "text_delta": {
      if (c.streamingTextId) {
        return {
          items: c.items.map((it) =>
            it.id === c.streamingTextId && it.kind === "text"
              ? { ...it, text: it.text + e.text }
              : it,
          ),
        }
      }
      const id = uid()
      return {
        items: [...c.items, { kind: "text", id, text: e.text }],
        streamingTextId: id,
      }
    }
    case "tool":
      return {
        items: [
          ...c.items,
          { kind: "tool", id: uid(), name: e.name, input: e.input },
        ],
        streamingTextId: null,
      }
    case "result":
      return {
        items: [
          ...c.items,
          {
            kind: "result",
            id: uid(),
            ok: e.ok,
            text: e.text ?? undefined,
            costUsd: e.cost_usd ?? undefined,
            costSource: e.cost_source,
            model: c.model,
            usage: {
              input: e.input_tokens,
              output: e.output_tokens,
              cacheRead: e.cache_read,
              cacheCreation: e.cache_creation,
            },
            durationMs: c.startedAt ? Date.now() - c.startedAt : undefined,
          },
        ],
        streamingTextId: null,
      }
    // aviso não-fatal (anexo expirado/não-suportado) — só adiciona a linha.
    case "notice":
      return {
        items: [...c.items, { kind: "notice", id: uid(), message: e.message }],
      }
    case "error":
      return {
        items: [...c.items, { kind: "error", id: uid(), message: e.message }],
        streamingTextId: null,
      }
    case "cancelled":
      return {
        items: [...c.items, { kind: "cancelled", id: uid() }],
        streamingTextId: null,
      }
    case "done":
      return { streamingTextId: null }
    default:
      return {}
  }
}

/** Controle do turno Linear (running/finalizing/runId/startedAt). Só o Linear usa
 *  — a lane do Fusion deriva o status dela explicitamente (handleCandidateEvent). */
function controlFlow(_c: ConvState, e: AgentEvent): Partial<ConvState> {
  switch (e.type) {
    case "result":
      // turno acabou, mas o processo ainda finaliza (flush) → segura até o Done.
      return { running: false, finalizing: true, runId: null, startedAt: null }
    case "error":
    case "cancelled":
      return { running: false, runId: null, startedAt: null }
    case "done":
      return { running: false, finalizing: false, runId: null, startedAt: null }
    default:
      return {}
  }
}

/** Reduz um evento do agent sobre o estado de UMA conversa (Linear). */
function reduceEvent(c: ConvState, e: AgentEvent): Partial<ConvState> {
  return { ...reduceItems(c, e), ...controlFlow(c, e) }
}

export const useChat = create<ChatState>((set, get) => {
  /** Aplica um patch parcial em UMA conversa (no-op se ela não existe mais). */
  const patch = (convId: string, p: Partial<ConvState>) =>
    set((s) => {
      const cur = s.byId[convId]
      if (!cur) return {}
      return { byId: { ...s.byId, [convId]: { ...cur, ...p } } }
    })

  /** Garante que a conversa está carregada em byId (do disco se preciso). */
  const ensureLoaded = async (projectId: string, convId: string) => {
    if (get().byId[convId]) return
    const conv = await dbLoad(convId)
    set((s) =>
      s.byId[convId]
        ? {}
        : {
            byId: {
              ...s.byId,
              [convId]: {
                ...emptyConv(projectId),
                items: conv?.items ?? [],
                sessionId: conv?.sessionId ?? null,
                suggestions: conv?.suggestions ?? [],
                agent: conv?.agent ?? "claude-code",
                reqModel: conv?.reqModel ?? null,
                effort: conv?.effort ?? null,
              },
            },
          },
    )
  }

  return {
    projectId: null,
    activeId: null,
    conversations: [],
    byId: {},
    queuedPrompt: null,

    queuePrompt: (queuedPrompt) => set({ queuedPrompt }),
    setSuggestions: (convId, suggestions) => patch(convId, { suggestions }),
    setSuggesting: (convId, suggesting) => patch(convId, { suggesting }),

    openProject: async (projectId) => {
      if (!projectId) {
        set({ projectId: null, activeId: null, conversations: [] })
        return
      }
      let list = (await dbList(projectId)) ?? []
      if (list.length === 0) {
        const id = uid()
        await dbCreate(projectId, id)
        list = [{ id, title: null, updatedAt: Date.now() }]
        set((s) => ({
          projectId,
          activeId: id,
          conversations: list,
          byId: s.byId[id] ? s.byId : { ...s.byId, [id]: emptyConv(projectId) },
        }))
        return
      }
      // exibe em ordem de criação, mas abre a usada mais recentemente
      const activeId = list.reduce(
        (best, c) => (c.updatedAt > best.updatedAt ? c : best),
        list[0],
      ).id
      set({ projectId, activeId, conversations: list })
      await ensureLoaded(projectId, activeId)
    },

    newConversation: async (projectId) => {
      const id = uid()
      await dbCreate(projectId, id)
      set((s) => ({
        projectId,
        activeId: id,
        conversations: [
          ...s.conversations,
          { id, title: null, updatedAt: Date.now() },
        ],
        byId: { ...s.byId, [id]: emptyConv(projectId) },
      }))
    },

    switchConversation: async (id) => {
      const s = get()
      if (s.activeId === id) return
      set({ activeId: id })
      if (s.projectId) await ensureLoaded(s.projectId, id)
    },

    removeConversation: async (id) => {
      await dbDelete(id)
      void wipeAttachments(id) // apaga os blobs da conversa (privacidade imediata)
      const wasActive = get().activeId === id
      const projectId = get().projectId
      set((s) => {
        const rest = { ...s.byId }
        delete rest[id]
        return {
          byId: rest,
          conversations: s.conversations.filter((c) => c.id !== id),
        }
      })
      if (!wasActive) return
      const remaining = get().conversations
      if (remaining.length > 0) {
        await get().switchConversation(remaining[0].id)
      } else if (projectId) {
        await get().newConversation(projectId)
      } else {
        set({ activeId: null })
      }
    },

    persist: async (convId) => {
      const c = get().byId[convId]
      if (!c) return
      const title = deriveTitle(c.items)
      await dbSave(
        convId,
        c.projectId,
        title,
        c.sessionId,
        c.items,
        c.suggestions,
        c.agent,
        c.reqModel,
        c.effort,
      )
      const now = Date.now()
      // atualiza no lugar — sem reordenar (ordem de criação é estável)
      set((st) => ({
        conversations: st.conversations.map((cv) =>
          cv.id === convId ? { ...cv, title, updatedAt: now } : cv,
        ),
      }))
    },

    start: (convId, text, runId, agent, model, effort, attachments) =>
      set((s) => {
        const cur = s.byId[convId] ?? emptyConv(s.projectId ?? "")
        const items = [
          ...cur.items,
          {
            kind: "user" as const,
            id: uid(),
            text,
            attachments: attachments.length ? attachments : undefined,
          },
        ]
        const conversations = s.conversations.map((c) =>
          c.id === convId && !c.title ? { ...c, title: deriveTitle(items) } : c,
        )
        return {
          conversations,
          byId: {
            ...s.byId,
            [convId]: {
              ...cur,
              agent,
              reqModel: model,
              effort,
              items,
              streamingTextId: null,
              running: true,
              finalizing: false,
              runId,
              startedAt: Date.now(),
              suggestions: [],
              suggesting: false,
            },
          },
        }
      }),

    handleEvent: (convId, e) =>
      set((s) => {
        const cur = s.byId[convId]
        if (!cur) return {}
        return { byId: { ...s.byId, [convId]: { ...cur, ...reduceEvent(cur, e) } } }
      }),

    finish: (convId) =>
      patch(convId, {
        running: false,
        finalizing: false,
        streamingTextId: null,
        runId: null,
      }),

    beginFusion: (convId, text, attachments) =>
      set((s) => {
        const cur = s.byId[convId] ?? emptyConv(s.projectId ?? "")
        const items = [
          ...cur.items,
          {
            kind: "user" as const,
            id: uid(),
            text,
            attachments: attachments.length ? attachments : undefined,
          },
        ]
        const conversations = s.conversations.map((c) =>
          c.id === convId && !c.title ? { ...c, title: deriveTitle(items) } : c,
        )
        return {
          conversations,
          byId: {
            ...s.byId,
            [convId]: { ...cur, items, running: true, finalizing: false },
          },
        }
      }),

    promoteFusion: async (convId, winner) => {
      set((s) => {
        const cur = s.byId[convId]
        if (!cur) return {}
        return {
          byId: {
            ...s.byId,
            [convId]: {
              ...cur,
              items: [...cur.items, ...winner.items],
              sessionId: winner.sessionId,
              agent: winner.agent,
              reqModel: winner.reqModel,
              effort: winner.effort,
              model: winner.model,
              running: false,
              finalizing: false,
            },
          },
        }
      })
      await get().persist(convId)
    },
  }
})

/** A conversa ativa (ou um estado vazio estável se nenhuma). */
export function useActiveConv(): ConvState {
  return useChat((s) => (s.activeId ? s.byId[s.activeId] : undefined) ?? EMPTY_CONV)
}
