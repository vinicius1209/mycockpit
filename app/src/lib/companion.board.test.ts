// O Board saiu do Companion (ADR-041): snapshot sem cards, card estagnado fora
// da atenção, ações de card inócuas e a ponte sem assinar o board. Saiu de
// companion.test.ts quando ele bateu no teto da catraca (R3 do
// docs/companion-chat-prd.md); preparo idêntico ao de lá.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import { nativeNotify } from "@/lib/notify"
import { useApp } from "@/store/app"
import { useCards, type CardRow } from "@/store/cards"
import { useChat } from "@/store/chat"
import { useInteractions } from "@/store/interactions"
import { useMission } from "@/store/mission"
import {
  buildCompanionSnapshot,
  startCompanionBridge,
  stopCompanionBridge,
} from "./companion"
import { handleCompanionAction } from "./companionAction"

// Ponte do Tauri mocada (o módulo empurra via invoke e escuta via listen).
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }))
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}))
// isTauri true liga o caminho real do push; loadLedger/listRecentDeliveries
// mocados (o cache de extras não deve bater em DB nos testes).
vi.mock("@/lib/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/db")>()
  return {
    ...mod,
    isTauri: () => true,
    loadLedger: vi.fn(async () => []),
    listRecentDeliveries: vi.fn(async () => []),
    // hidratação de boot do useCards (side-effect do import) não bate em DB
    listCards: vi.fn(async () => []),
  }
})
// Aviso nativo (caminho de erro de ação de card SEM conversa) mocado.
vi.mock("@/lib/notify", () => ({ nativeNotify: vi.fn(async () => {}) }))
// O envio da mesa é testado em send.test.ts — aqui só o ROTEAMENTO.
vi.mock("@/lib/fleet/send", () => ({
  DESK_TITLE_PREFIX: "Mesa · ",
  ensureDeskConversation: vi.fn(async () => "conv-mesa"),
  sendFromDesk: vi.fn(async () => {}),
  cancelDeskTurn: vi.fn(async () => {}),
}))
// O reforço real (registro + reinforceLessons) é testado em learning.test.ts.
vi.mock("@/lib/learning", () => ({ feedbackLesson: vi.fn(async () => {}) }))

function makeCard(partial: Partial<CardRow> & { id: string }): CardRow {
  return {
    projectId: "p1",
    title: `Card ${partial.id}`,
    body: null,
    state: "backlog",
    assigneeAgent: null,
    conversationId: null,
    owner: null,
    pinned: false,
    pinRank: null,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...partial,
  }
}

// ações REAIS do store de cards (restauradas no beforeEach — testes que mocam
// dispatch/closeCard via setState não vazam pros vizinhos)
const cardsOriginal = {
  dispatch: useCards.getState().dispatch,
  closeCard: useCards.getState().closeCard,
}

beforeEach(() => {
  vi.clearAllMocks()
  stopCompanionBridge()
  useApp.setState({
    projects: [
      { id: "p1", name: "alpha", path: "/proj/alpha", createdAt: 1 },
      { id: "p2", name: "beta", path: "/proj/beta", createdAt: 2 },
    ],
  })
  useChat.setState({
    byId: {},
    conversationsByProject: {},
    conversations: [],
    projectId: null,
    activeId: null,
  })
  useMission.setState({ byConv: {} })
  useInteractions.setState({ queue: [] })
  useCards.setState({
    all: [],
    byProject: {},
    loaded: true,
    selectedId: null,
    dispatch: cardsOriginal.dispatch,
    closeCard: cardsOriginal.closeCard,
  })
})

afterEach(() => {
  stopCompanionBridge()
  vi.useRealTimers()
})

describe("o Board não existe mais no Companion", () => {
  it("snapshot não carrega seção de card, nem com o board cheio", () => {
    useCards.setState({
      all: [
        makeCard({ id: "k1", state: "backlog" }),
        makeCard({ id: "k2", state: "working", projectId: "p2" }),
        makeCard({ id: "k3", state: "review" }),
      ],
    })
    const snap = buildCompanionSnapshot()
    expect("cards" in snap).toBe(false)
  })

  it("card estagnado não vira mais item de atenção no celular", () => {
    useCards.setState({
      all: [
        makeCard({
          id: "k9",
          state: "working",
          conversationId: "c-k9",
          assigneeAgent: "codex",
          stalledSince: Date.now() - 5 * 60_000,
        }),
      ],
    })
    const snap = buildCompanionSnapshot()
    // a atenção do celular só fala de gate, aprovação, pergunta e turno mudo;
    // card estagnado segue vivo na fila do desktop (lib/inbox), não aqui.
    expect(snap.attention).toHaveLength(0)
  })

  it("ações de card viraram vocabulário desconhecido: inócuas e só com aviso", async () => {
    const dispatch = vi.fn(async () => "conv-nova")
    const closeCard = vi.fn(async () => {})
    useCards.setState({ dispatch, closeCard })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await handleCompanionAction({ kind: "dispatch_card", cardId: "k1" })
    await handleCompanionAction({ kind: "close_card", cardId: "k1", state: "done" })
    expect(dispatch).not.toHaveBeenCalled()
    expect(closeCard).not.toHaveBeenCalled()
    expect(nativeNotify).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it("mutação no useCards não re-empurra o snapshot (a ponte não assina mais o board)", async () => {
    vi.useFakeTimers()
    startCompanionBridge()
    await vi.advanceTimersByTimeAsync(600)
    const pushes = () =>
      vi
        .mocked(invoke)
        .mock.calls.filter(([cmd]) => cmd === "set_companion_snapshot").length
    const base = pushes()
    useCards.setState({ all: [makeCard({ id: "k1" })], byProject: {} })
    await vi.advanceTimersByTimeAsync(600)
    expect(pushes()).toBe(base)
  })
})
