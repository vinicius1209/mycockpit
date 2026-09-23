import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatItem } from "@/store/chat"

const h = vi.hoisted(() => ({
  generate: vi.fn(),
  loadMap: vi.fn(),
  loadPins: vi.fn(),
}))

vi.mock("@/lib/conversationMap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/conversationMap")>()),
  generateConversationMap: h.generate,
}))

vi.mock("@/lib/db/conversationMaps", () => ({
  loadConversationMap: h.loadMap,
  loadConversationMapPins: h.loadPins,
  recordUtilityUsage: vi.fn(),
  saveConversationMapIfCurrent: vi.fn(),
  saveConversationMapPins: vi.fn(),
}))

import { DEFAULT_UTILITY_INFERENCE } from "@/lib/utility/types"
import { useApp } from "@/store/app"
import {
  _resetConversationMapsForTests,
  useConversationMaps,
} from "./conversationMaps"

const items: ChatItem[] = [
  { kind: "user", id: "user-1", text: "Continue o trabalho", ts: 1 },
  { kind: "result", id: "result-1", ok: true, ts: 2 },
]

beforeEach(() => {
  _resetConversationMapsForTests()
  h.generate.mockReset()
  h.loadMap.mockResolvedValue(null)
  h.loadPins.mockResolvedValue({ schemaVersion: 1, revision: 0, constraints: [] })
  useApp.setState((state) => ({
    settings: {
      ...state.settings,
      utilityInference: DEFAULT_UTILITY_INFERENCE,
    },
  }))
})

afterEach(() => {
  _resetConversationMapsForTests()
})

describe("dedupe de falha determinística do mapa", () => {
  it("não chama o transporte novamente enquanto a entrada não muda", async () => {
    h.generate.mockResolvedValue({
      ok: false,
      reason: "input_too_large",
      source: null,
      durationMs: 3,
      inputDigest: "bloco-recusado",
      payloadStats: { total: 300_000 },
    })
    const args = {
      conversationId: "conv-1",
      projectId: "project-1",
      items,
      running: false,
      finalizing: false,
    }

    await useConversationMaps.getState().refreshNow(args)
    await useConversationMaps.getState().refreshNow(args)

    expect(h.generate).toHaveBeenCalledTimes(1)
    expect(useConversationMaps.getState().byConversation["conv-1"]).toMatchObject({
      semanticStatus: "unavailable",
      lastIssue: "input_too_large",
      blockedInputKey: expect.any(String),
    })
  })

  it("conversa que não coube na fonte não tenta de novo a cada turno novo", async () => {
    h.generate.mockResolvedValue({
      ok: false,
      reason: "input_too_large",
      source: { id: "apple-foundation-model", locality: "device" },
      durationMs: 3,
    })
    const args = {
      conversationId: "conv-1",
      projectId: "project-1",
      items,
      running: false,
      finalizing: false,
    }
    await useConversationMaps.getState().refreshNow(args)
    // turno novo: a entrada muda, e antes isso bastava para tentar de novo
    const maisUmTurno: ChatItem[] = [
      ...items,
      { kind: "user", id: "user-2", text: "E agora o rodapé", ts: 3 },
      { kind: "result", id: "result-2", ok: true, ts: 4 },
    ]
    await useConversationMaps.getState().refreshNow({ ...args, items: maisUmTurno })

    expect(h.generate).toHaveBeenCalledTimes(1)
    expect(useConversationMaps.getState().byConversation["conv-1"]).toMatchObject({
      semanticStatus: "unavailable",
      lastIssue: "input_too_large",
    })

    await useConversationMaps.getState().refreshNow({ ...args, items: maisUmTurno, force: true })
    expect(h.generate).toHaveBeenCalledTimes(2)
  })

  it("permite repetir pelo gesto explícito de atualizar", async () => {
    h.generate.mockResolvedValue({
      ok: false,
      reason: "invalid_response",
      source: null,
      durationMs: 2,
    })
    const args = {
      conversationId: "conv-1",
      projectId: "project-1",
      items,
      running: false,
      finalizing: false,
    }

    await useConversationMaps.getState().refreshNow(args)
    await useConversationMaps.getState().refreshNow({ ...args, force: true })

    expect(h.generate).toHaveBeenCalledTimes(2)
  })
})
