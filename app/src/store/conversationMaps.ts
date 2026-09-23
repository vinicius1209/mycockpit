import { create } from "zustand"
import {
  buildConversationMapInput,
  CONVERSATION_MAP_PROMPT_VERSION,
  generateConversationMap,
  conversationMapPayloadStats,
  settledConversationTurns,
  sha256Hex,
  type ConversationMapPinsV1,
  type StoredConversationMap,
} from "@/lib/conversationMap"
import {
  loadConversationMap,
  loadConversationMapPins,
  recordUtilityUsage,
  saveConversationMapIfCurrent,
  saveConversationMapPins,
} from "@/lib/db/conversationMaps"
import {
  cancelUtility,
  createUtilityAttemptId,
} from "@/lib/utility"
import { UTILITY_PROFILES } from "@/lib/utility/profiles"
import { useApp } from "@/store/app"
import type { ChatItem } from "@/store/chat"
import { perfOperation } from "@/lib/fleet/perf"
import {
  emptyPins,
  initialEntry,
  sourceKind,
  turnsAfterWatermark,
  type ConversationMapEntry,
} from "@/store/conversationMaps/entrada"
export type { ConversationMapEntry } from "@/store/conversationMaps/entrada"

const SETTLE_DELAY_MS = 700
const REBASE_AFTER_TURNS = 20

interface RefreshArgs {
  conversationId: string
  projectId: string
  items: readonly ChatItem[]
  running: boolean
  finalizing: boolean
  force?: boolean
}

interface ConversationMapsState {
  byConversation: Record<string, ConversationMapEntry>
  hydrate: (conversationId: string) => Promise<void>
  scheduleRefresh: (args: RefreshArgs) => void
  refreshNow: (args: RefreshArgs) => Promise<void>
  cancelAll: () => void
  replacePins: (
    conversationId: string,
    pins: ConversationMapPinsV1,
  ) => Promise<"saved" | "conflict">
}

const hydratePromises = new Map<string, Promise<void>>()
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
const refreshEpochs = new Map<string, number>()

export const useConversationMaps = create<ConversationMapsState>()((set, get) => ({
  byConversation: {},

  hydrate: async (conversationId) => {
    if (get().byConversation[conversationId]?.hydrated) return
    const current = hydratePromises.get(conversationId)
    if (current) return current
    const promise = (async () => {
      const [stored, pins] = await Promise.all([
        loadConversationMap(conversationId),
        loadConversationMapPins(conversationId),
      ])
      const corrupt = stored === "corrupt" || pins === "corrupt"
      set((state) => ({
        byConversation: {
          ...state.byConversation,
          [conversationId]: {
            ...initialEntry(),
            hydrated: true,
            stored: stored === "corrupt" ? null : stored,
            pins: pins === "corrupt" ? emptyPins() : pins,
            semanticStatus:
              stored && stored !== "corrupt" ? "current" : "absent",
            lastIssue: corrupt ? "corrupt" : null,
          },
        },
      }))
    })().finally(() => hydratePromises.delete(conversationId))
    hydratePromises.set(conversationId, promise)
    return promise
  },

  scheduleRefresh: (args) => {
    refreshEpochs.set(
      args.conversationId,
      (refreshEpochs.get(args.conversationId) ?? 0) + 1,
    )
    const prior = refreshTimers.get(args.conversationId)
    if (prior) clearTimeout(prior)
    const entry = get().byConversation[args.conversationId]
    const stale = turnsAfterWatermark(
      args.items,
      args.running,
      args.finalizing,
      entry?.stored?.summarizedThroughItemId ?? null,
    )
    if (entry) {
      set((state) => ({
        byConversation: {
          ...state.byConversation,
          [args.conversationId]: {
            ...entry,
            staleSettledTurns: stale,
            semanticStatus:
              stale > 0
                ? entry.stored
                  ? "stale"
                  : "queued"
                : entry.stored
                  ? "current"
                  : "absent",
          },
        },
      }))
    }
    if (entry?.generatingAttemptId) {
      void cancelUtility(entry.generatingAttemptId)
    }
    if (args.running || args.finalizing) return
    const timer = setTimeout(() => {
      refreshTimers.delete(args.conversationId)
      void get().refreshNow(args)
    }, args.force ? 0 : SETTLE_DELAY_MS)
    refreshTimers.set(args.conversationId, timer)
  },

  refreshNow: async (args) => {
    await get().hydrate(args.conversationId)
    if (args.running || args.finalizing) return
    const settings = useApp.getState().settings
    const utility = settings.utilityInference
    if (!args.force && !utility.automaticConversationMaps) return
    // Desligado nesta conversa pela pessoa: nem o gatilho de fim de turno nem
    // o manual rodam até ela religar.
    if (utility.conversationMapsOff?.includes(args.conversationId)) return
    const policy = utility.tasks.conversation_map
    if (!policy || policy.route === "off") return
    const entry = get().byConversation[args.conversationId] ?? initialEntry()
    const sizeKey = [
      JSON.stringify(policy),
      CONVERSATION_MAP_PROMPT_VERSION,
      entry.pins.revision,
    ].join(":")
    // Antes de montar a entrada: a conversa grande demais não paga nem a
    // derivação a cada fim de turno.
    if (!args.force && entry.blockedSizeKey === sizeKey) {
      // O agendamento marcou "na fila"; a tela tem de dizer o motivo real.
      set((state) => ({
        byConversation: {
          ...state.byConversation,
          [args.conversationId]: {
            ...entry,
            semanticStatus: entry.stored ? "stale" : "unavailable",
            lastIssue: "input_too_large",
          },
        },
      }))
      return
    }
    const staleTurns = turnsAfterWatermark(
      args.items,
      false,
      false,
      entry.stored?.summarizedThroughItemId ?? null,
    )
    if (entry.stored && staleTurns === 0 && !args.force) {
      set((state) => ({
        byConversation: {
          ...state.byConversation,
          [args.conversationId]: {
            ...entry,
            semanticStatus: "current",
            staleSettledTurns: 0,
          },
        },
      }))
      return
    }
    const allTurns = settledConversationTurns(args.items, {
      running: false,
      finalizing: false,
    })
    if (!allTurns.length) return
    const mode =
      !entry.stored ||
      entry.stored.promptVersion !== CONVERSATION_MAP_PROMPT_VERSION ||
      entry.stored.turnsSinceRebase >= REBASE_AFTER_TURNS ||
      entry.needsRebase
        ? "rebase"
        : "incremental"
    const input = buildConversationMapInput({
      items: args.items,
      running: false,
      finalizing: false,
      promptVersion: CONVERSATION_MAP_PROMPT_VERSION,
      mode,
      previousMap: mode === "incremental" ? entry.stored?.payload ?? null : null,
      pins: entry.pins,
      summarizedThroughItemId:
        mode === "incremental"
          ? entry.stored?.summarizedThroughItemId ?? null
          : null,
    })
    if (!input.evidence.length) return
    const inputDigest = await sha256Hex(
      JSON.stringify({ input, routePolicy: policy.route }),
    )
    const requestEpoch = refreshEpochs.get(args.conversationId) ?? 0
    const pinsRevision = entry.pins.revision
    const policySignature = JSON.stringify(policy)
    const blockedInputKey = [
      inputDigest,
      policySignature,
      CONVERSATION_MAP_PROMPT_VERSION,
      pinsRevision,
    ].join(":")
    if (!args.force && entry.blockedInputKey === blockedInputKey) {
      perfOperation("map.refresh.request", {
        bytes: conversationMapPayloadStats(input).total,
        cache: "hit",
      })({ outcome: "deterministic_failure_deduplicated" })
      return
    }
    const attemptId = createUtilityAttemptId()
    set((state) => ({
      byConversation: {
        ...state.byConversation,
        [args.conversationId]: {
          ...entry,
          semanticStatus: "generating",
          staleSettledTurns: staleTurns,
          generatingAttemptId: attemptId,
          lastIssue: null,
        },
      },
    }))
    const finishPerf = perfOperation("map.refresh.request", {
      bytes: conversationMapPayloadStats(input).total,
      cache: "miss",
    })
    const isCurrent = () => {
      const live = get().byConversation[args.conversationId]
      return (
        live?.generatingAttemptId === attemptId &&
        live.pins.revision === pinsRevision &&
        (refreshEpochs.get(args.conversationId) ?? 0) === requestEpoch &&
        JSON.stringify(
          useApp.getState().settings.utilityInference.tasks.conversation_map,
        ) === policySignature
      )
    }
    const generated = await generateConversationMap({
      mapInput: input,
      request: {
        attemptId,
        locale: "pt-BR",
        routePolicy: policy.route,
        projectId: args.projectId,
        conversationId: args.conversationId,
        deadlineMs: UTILITY_PROFILES.conversation_map.defaultDeadlineMs,
        helperModel: policy.helperModel ?? settings.helperModel,
        remoteAuthorized: policy.remoteConsent != null,
      },
      isCurrent,
      onTransportResult: (result) => {
        if (!result.source) return
        void recordUtilityUsage({
          task: "conversation_map",
          sourceId: result.source.id,
          ok: result.status === "ok",
          costUsd: result.cost?.usd ?? null,
          latencyMs: result.timing.durationMs,
        }).catch((error) =>
          console.warn("[inferência utilitária] uso não persistido", error),
        )
      },
    })
    finishPerf({
      bytes: generated.ok
        ? conversationMapPayloadStats(input).total
        : generated.payloadStats?.total,
      outcome: generated.ok ? "ok" : generated.reason,
    })
    const live = get().byConversation[args.conversationId]
    if (live?.generatingAttemptId !== attemptId) return
    if (
      (refreshEpochs.get(args.conversationId) ?? 0) !== requestEpoch ||
      live.pins.revision !== pinsRevision
    ) {
      set((state) => ({
        byConversation: {
          ...state.byConversation,
          [args.conversationId]: {
            ...live,
            generatingAttemptId: null,
            semanticStatus: live.stored ? "stale" : "queued",
            lastIssue: "stale",
          },
        },
      }))
      return
    }
    if (!generated.ok) {
      const stale = generated.reason === "stale"
      const deterministic =
        generated.reason === "input_too_large" ||
        generated.reason === "invalid_request" ||
        generated.reason === "invalid_response"
      set((state) => ({
        byConversation: {
          ...state.byConversation,
          [args.conversationId]: {
            ...live,
            generatingAttemptId: null,
            semanticStatus: live.stored ? "stale" : stale ? "queued" : "unavailable",
            lastIssue: generated.reason,
            blockedInputKey: deterministic ? blockedInputKey : live.blockedInputKey,
            blockedSizeKey: generated.reason === "input_too_large" ? sizeKey : live.blockedSizeKey,
          },
        },
      }))
      return
    }
    const lastTurn = allTurns.at(-1)!
    const generatedAt = Date.now()
    const row: StoredConversationMap = {
      conversationId: args.conversationId,
      schemaVersion: 1,
      promptVersion: CONVERSATION_MAP_PROMPT_VERSION,
      payload: generated.value,
      summarizedThroughItemId: lastTurn.terminalItemId,
      summarizedThroughTs: lastTurn.endedAt ?? null,
      inputDigest,
      sourceKind: sourceKind(generated.source.locality),
      sourceId: generated.source.id,
      sourceFingerprint: null,
      generationMode: mode,
      generatedAt,
      latencyMs: generated.durationMs,
      turnsSinceRebase:
        mode === "rebase"
          ? 0
          : (entry.stored?.turnsSinceRebase ?? 0) + staleTurns,
      costUsd: generated.cost?.usd ?? null,
      costSource: generated.cost?.source ?? null,
    }
    const saved = await saveConversationMapIfCurrent(
      row,
      entry.stored?.inputDigest ?? null,
    )
    if (saved === "stale") {
      set((state) => ({
        byConversation: {
          ...state.byConversation,
          [args.conversationId]: {
            ...live,
            generatingAttemptId: null,
            semanticStatus: live.stored ? "stale" : "absent",
            lastIssue: "stale",
          },
        },
      }))
      return
    }
    set((state) => ({
      byConversation: {
        ...state.byConversation,
        [args.conversationId]: {
          ...live,
          stored: row,
          generatingAttemptId: null,
          needsRebase: false,
          semanticStatus: "current",
          staleSettledTurns: 0,
          lastIssue: null,
          blockedInputKey: null,
          blockedSizeKey: null,
        },
      },
    }))
  },

  cancelAll: () => {
    for (const entry of Object.values(get().byConversation)) {
      if (entry.generatingAttemptId) void cancelUtility(entry.generatingAttemptId)
    }
    set((state) => ({
      byConversation: Object.fromEntries(
        Object.entries(state.byConversation).map(([conversationId, entry]) => [
          conversationId,
          {
            ...entry,
            generatingAttemptId: null,
            semanticStatus: entry.stored ? "stale" : "absent",
          },
        ]),
      ),
    }))
  },

  replacePins: async (conversationId, pins) => {
    refreshEpochs.set(conversationId, (refreshEpochs.get(conversationId) ?? 0) + 1)
    const entry = get().byConversation[conversationId] ?? initialEntry()
    if (entry.generatingAttemptId) void cancelUtility(entry.generatingAttemptId)
    const result = await saveConversationMapPins(
      conversationId,
      pins,
      entry.pins.revision,
    )
    if (result === "saved") {
      set((state) => ({
        byConversation: {
          ...state.byConversation,
          [conversationId]: {
            ...entry,
            pins,
            generatingAttemptId: null,
            needsRebase: true,
            semanticStatus: entry.stored ? "stale" : "queued",
            lastIssue: null,
            blockedInputKey: null,
            blockedSizeKey: null,
          },
        },
      }))
    } else {
      const current = await loadConversationMapPins(conversationId)
      set((state) => ({
        byConversation: {
          ...state.byConversation,
          [conversationId]: {
            ...entry,
            pins: current === "corrupt" ? entry.pins : current,
            generatingAttemptId: null,
            lastIssue: "conflict",
          },
        },
      }))
    }
    return result
  },
}))

/** Somente testes: timers e dedupe são estado de módulo, não do zustand. */
export function _resetConversationMapsForTests(): void {
  for (const timer of refreshTimers.values()) clearTimeout(timer)
  refreshTimers.clear()
  refreshEpochs.clear()
  hydratePromises.clear()
  useConversationMaps.setState({ byConversation: {} })
}
