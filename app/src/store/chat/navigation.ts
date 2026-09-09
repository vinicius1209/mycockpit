import { getAgentDef } from "@/lib/agentDefs"
import { normalizeModelValue } from "@/lib/agents"
import { hydrateContextSnapshot } from "@/lib/contextSnapshot"
import {
  createConversation,
  listConversations,
  loadConversation,
  type ConversationMeta,
} from "@/lib/db/conversations"
import { perfOperation } from "@/lib/fleet/perf"
import { useApp } from "@/store/app"
import type { ChatItem, ChatState, ConvState } from "@/store/chat"

type SetChat = (
  patch:
    | Partial<ChatState>
    | ((state: ChatState) => Partial<ChatState>),
) => void

export function createChatNavigation(
  get: () => ChatState,
  set: SetChat,
  helpers: {
    uid: () => string
    emptyConversation: (projectId: string) => ConvState
    markOrphanedProcesses: (items: ChatItem[]) => ChatItem[]
  },
) {
  let generation = 0
  const metaFlights = new Map<string, Promise<ConversationMeta[]>>()
  const conversationFlights = new Map<string, Promise<void>>()
  const projectFlights = new Map<string, { generation: number; promise: Promise<void> }>()

  const loadMeta = (projectId: string): Promise<ConversationMeta[]> => {
    const cached = get().conversationsByProject[projectId]
    if (cached) return Promise.resolve(cached)
    const pending = metaFlights.get(projectId)
    if (pending) return pending
    const finish = perfOperation("navigation.project-list", { cache: "miss" })
    const promise = listConversations(projectId)
      .then((list) => {
        finish({ outcome: "ok" })
        return list ?? []
      })
      .catch((error) => {
        finish({ outcome: "error" })
        throw error
      })
      .finally(() => metaFlights.delete(projectId))
    metaFlights.set(projectId, promise)
    return promise
  }

  const ensureLoaded = (projectId: string, convId: string): Promise<void> => {
    if (get().byId[convId]) return Promise.resolve()
    const pending = conversationFlights.get(convId)
    if (pending) return pending
    const finish = perfOperation("navigation.conversation-load", { cache: "miss" })
    const promise = (async () => {
      const conversation = await loadConversation(convId)
      let presetName: string | null = null
      if (conversation !== "corrupt" && conversation?.presetId) {
        try {
          const path =
            useApp.getState().projects.find((project) => project.id === projectId)
              ?.path ?? null
          presetName =
            (await getAgentDef(path, conversation.presetId))?.name ?? null
        } catch {
          presetName = null
        }
      }
      const state: ConvState =
        conversation === "corrupt"
          ? {
              ...helpers.emptyConversation(projectId),
              corrupt: true,
              items: [
                {
                  kind: "notice",
                  id: helpers.uid(),
                  message:
                    "Histórico desta conversa está corrompido no banco. Envio bloqueado pra não sobrescrever (a linha segue recuperável via SQLite).",
                },
              ],
            }
          : {
              ...helpers.emptyConversation(projectId),
              items: helpers.markOrphanedProcesses(conversation?.items ?? []),
              sessionId: conversation?.sessionId ?? null,
              suggestions: conversation?.suggestions ?? [],
              agent: conversation?.agent ?? "claude-code",
              reqModel: normalizeModelValue(
                conversation?.agent ?? "claude-code",
                conversation?.reqModel ?? null,
              ),
              effort: conversation?.effort ?? null,
              model: conversation?.model ?? null,
              worktreePath: conversation?.worktreePath ?? null,
              presetId: conversation?.presetId ?? null,
              presetDigest: conversation?.presetDigest ?? null,
              presetName,
              ...hydrateContextSnapshot(conversation || null),
              sessionMode:
                (conversation?.sessionMode as ConvState["sessionMode"]) ?? null,
            }
      set((current) =>
        current.byId[convId]
          ? {}
          : { byId: { ...current.byId, [convId]: state } },
      )
      finish({ outcome: "ok" })
    })()
      .catch((error) => {
        finish({ outcome: "error" })
        throw error
      })
      .finally(() => conversationFlights.delete(convId))
    conversationFlights.set(convId, promise)
    return promise
  }

  const openProject = (projectId: string | null): Promise<void> => {
    if (!projectId) {
      generation++
      set({ projectId: null, activeId: null, conversations: [] })
      return Promise.resolve()
    }
    const existing = projectFlights.get(projectId)
    if (existing?.generation === generation) return existing.promise
    const currentGeneration = ++generation
    const cached = get().conversationsByProject[projectId]
    if (get().projectId !== projectId) {
      set({ projectId, activeId: null, conversations: cached ?? [] })
    }
    const finish = perfOperation("navigation.open-project", {
      cache: cached ? "hit" : "miss",
    })
    const promise = (async () => {
      let list = cached ?? (await loadMeta(projectId))
      if (currentGeneration !== generation) return
      if (list.length === 0) {
        const id = helpers.uid()
        await createConversation(projectId, id)
        if (currentGeneration !== generation) return
        list = [
          {
            id,
            title: null,
            updatedAt: Date.now(),
            color: null,
            worktreePath: null,
            agent: null,
          },
        ]
        set((state) => ({
          projectId,
          activeId: id,
          conversations: list,
          conversationsByProject: {
            ...state.conversationsByProject,
            [projectId]: list,
          },
          byId: state.byId[id]
            ? state.byId
            : { ...state.byId, [id]: helpers.emptyConversation(projectId) },
        }))
        return
      }
      const mostRecent = list.reduce(
        (best, conversation) =>
          conversation.updatedAt > best.updatedAt ? conversation : best,
        list[0],
      ).id
      const previous = get()
      const keepActive =
        previous.projectId === projectId &&
        previous.activeId != null &&
        list.some((conversation) => conversation.id === previous.activeId)
      const activeId = keepActive ? previous.activeId! : mostRecent
      set((state) => ({
        projectId,
        activeId,
        conversations: list,
        conversationsByProject: {
          ...state.conversationsByProject,
          [projectId]: list,
        },
      }))
      await ensureLoaded(projectId, activeId)
    })()
      .then(() =>
        finish({ outcome: currentGeneration === generation ? "ok" : "stale" }),
      )
      .catch((error) => {
        finish({ outcome: "error" })
        throw error
      })
      .finally(() => {
        if (projectFlights.get(projectId)?.generation === currentGeneration) {
          projectFlights.delete(projectId)
        }
      })
    projectFlights.set(projectId, { generation: currentGeneration, promise })
    return promise
  }

  return {
    ensureLoaded,
    invalidate: () => {
      generation++
    },
    loadMeta,
    openProject,
  }
}
