import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ConversationMapInputV1 } from "./types"

const h = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock("@/lib/utility/gateway", () => ({ generateUtility: h.generate }))

import { generateConversationMap } from "./generate"

function longInput(): ConversationMapInputV1 {
  const evidence = Array.from({ length: 3 }, (_, index) => ({
    itemId: `u-${index}`,
    role: "user" as const,
    channel: "executor" as const,
    kind: "user",
    text: `Pedido ${index} ${"x".repeat(3_500)}`,
  }))
  return {
    schemaVersion: 1,
    promptVersion: 2,
    locale: "pt-BR",
    mode: "rebase",
    previousMap: null,
    pins: { schemaVersion: 1, revision: 0, constraints: [] },
    turns: evidence.map((item, index) => ({
      id: `t-${index}`,
      openedByItemId: item.itemId,
      terminalItemId: item.itemId,
      status: "unknown" as const,
      itemIds: [item.itemId],
    })),
    evidence,
    canonicalOutcome: { status: "unknown", terminalItemId: "u-2" },
    latestUserItemId: "u-2",
    allowedEvidenceItemIds: evidence.map((item) => item.itemId),
    summarizedThroughItemId: null,
  }
}

const request = {
  attemptId: "attempt",
  locale: "pt-BR",
  routePolicy: "free_only" as const,
  deadlineMs: 45_000,
}

beforeEach(() => {
  h.generate.mockReset()
})

describe("geração em blocos do mapa", () => {
  it("só publica o snapshot depois que todos os blocos passam", async () => {
    h.generate.mockImplementation(async (call: { payload: ConversationMapInputV1 }) => {
      if (!call) throw new Error("transporte chamado sem request")
      const { payload } = call
      const current = payload.evidence.find((item) => item.text)?.itemId ?? ""
      return {
        status: "ok",
        value: {
          currentFocus: {
            text: `Foco ${current}`,
            certainty: "explicit",
            evidenceItemIds: [current],
          },
          explicitGoalCandidate: null,
          directionChanges: [],
          understandings: [],
          constraints: [],
          openThreads: [],
          latestOutcomeSummary: null,
        },
        source: { id: "apple-foundation-model", locality: "device" },
        timing: { startedAt: 1, durationMs: 10 },
      }
    })

    const result = await generateConversationMap({
      mapInput: longInput(),
      request,
      isCurrent: () => true,
    })

    expect(h.generate.mock.calls.length).toBeGreaterThan(1)
    expect(result).toMatchObject({ ok: true, blocks: 3, durationMs: 30 })
  })

  it("descarta a reconstrução inteira quando um bloco é inválido", async () => {
    h.generate
      .mockResolvedValueOnce({
        status: "ok",
        value: {
          currentFocus: null,
          explicitGoalCandidate: null,
          directionChanges: [],
          understandings: [],
          constraints: [],
          openThreads: [],
          latestOutcomeSummary: null,
        },
        source: { id: "apple-foundation-model", locality: "device" },
        timing: { startedAt: 1, durationMs: 10 },
      })
      .mockResolvedValueOnce({
        status: "ok",
        value: { campoInventado: true },
        source: { id: "apple-foundation-model", locality: "device" },
        timing: { startedAt: 1, durationMs: 10 },
      })

    await expect(
      generateConversationMap({
        mapInput: longInput(),
        request,
        isCurrent: () => true,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid_response" })
  })

  it("não inicia o bloco seguinte depois que a entrada fica obsoleta", async () => {
    let current = true
    h.generate.mockImplementation(async () => {
      current = false
      return {
        status: "cancelled",
        source: { id: "apple-foundation-model", locality: "device" },
        timing: { startedAt: 1, durationMs: 5 },
        fallbackReason: "cancelled",
      }
    })

    const result = await generateConversationMap({
      mapInput: longInput(),
      request,
      isCurrent: () => current,
    })
    expect(result).toMatchObject({ ok: false, reason: "stale" })
    expect(h.generate).toHaveBeenCalledTimes(1)
  })
})
