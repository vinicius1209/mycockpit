import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ConversationMapInputV1 } from "./types"

const h = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock("@/lib/utility/gateway", () => ({ generateUtility: h.generate }))

import {
  conversationMapPayloadStats,
  generateConversationMap,
} from "./generate"

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

  it("recusa o payload final grande antes de atravessar a ponte", async () => {
    const input = longInput()
    input.pins.constraints.push({
      id: "pin-grande",
      text: "x".repeat(270_000),
      pinnedAt: 1,
    })

    const result = await generateConversationMap({
      mapInput: input,
      request,
      isCurrent: () => true,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "input_too_large",
      inputDigest: expect.any(String),
      payloadStats: { total: expect.any(Number) },
    })
    expect(conversationMapPayloadStats(input).total).toBeGreaterThan(256 * 1024)
    expect(h.generate).not.toHaveBeenCalled()
  })
})

describe("bloco recusado por tamanho pela fonte", () => {
  // Seis pedidos pequenos cabem num bloco de 7 KB; a janela do modelo local
  // é que não cabe (log de 23/09/2026: `source=apple-foundation-model
  // code=input_too_large`, 74 de 98 chamadas no dia).
  function inputDePedidosCurtos(): ConversationMapInputV1 {
    const base = longInput()
    const evidence = Array.from({ length: 6 }, (_, index) => ({
      itemId: `u-${index}`,
      role: "user" as const,
      channel: "executor" as const,
      kind: "user",
      text: `Pedido ${index} ${"x".repeat(600)}`,
    }))
    return {
      ...base,
      turns: evidence.map((item, index) => ({
        id: `t-${index}`,
        openedByItemId: item.itemId,
        terminalItemId: item.itemId,
        status: "unknown" as const,
        itemIds: [item.itemId],
      })),
      evidence,
      canonicalOutcome: { status: "unknown", terminalItemId: "u-5" },
      latestUserItemId: "u-5",
      allowedEvidenceItemIds: evidence.map((item) => item.itemId),
    }
  }
  const recusa = {
    status: "invalid",
    source: { id: "apple-foundation-model", locality: "device" },
    timing: { startedAt: 1, durationMs: 3 },
    fallbackReason: "input_too_large",
  }
  const mapaVazio = {
    currentFocus: null,
    explicitGoalCandidate: null,
    directionChanges: [],
    understandings: [],
    constraints: [],
    openThreads: [],
    latestOutcomeSummary: null,
  }

  it("divide o bloco ao meio e segue até caber, sem recomeçar a geração", async () => {
    h.generate.mockImplementation(async ({ payload }: { payload: ConversationMapInputV1 }) => {
      const comTexto = payload.evidence.filter((item) => item.text).length
      if (comTexto > 2) return recusa
      return {
        status: "ok",
        value: mapaVazio,
        source: { id: "apple-foundation-model", locality: "device" },
        timing: { startedAt: 1, durationMs: 10 },
      }
    })

    const result = await generateConversationMap({
      mapInput: inputDePedidosCurtos(),
      request,
      isCurrent: () => true,
    })

    expect(result).toMatchObject({ ok: true })
    const tamanhos = h.generate.mock.calls.map(
      ([call]) => (call as { payload: ConversationMapInputV1 }).payload.evidence.filter((item) => item.text).length,
    )
    // 6 recusado → 3 + 3 → 3 recusado → 2 + 1, e o outro 3 igual
    expect(tamanhos).toEqual([6, 3, 2, 1, 3, 2, 1])
  })

  it("um pedido sozinho que não cabe encerra com input_too_large, sem insistir", async () => {
    h.generate.mockResolvedValue(recusa)

    const result = await generateConversationMap({
      mapInput: longInput(),
      request,
      isCurrent: () => true,
    })

    expect(result).toMatchObject({ ok: false, reason: "input_too_large" })
    expect(h.generate).toHaveBeenCalledTimes(1)
  })
})
