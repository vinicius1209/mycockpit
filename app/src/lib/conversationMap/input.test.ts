import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import {
  buildConversationMapInput,
  conversationMapEvidenceBlocks,
  evidenceFromItems,
} from "./input"
import {
  EMPTY_CONVERSATION_MAP_PINS,
  type SemanticConversationMapV1,
} from "./types"

describe("entrada semântica do mapa", () => {
  it("não envia output bruto de ferramenta", () => {
    const tool: ChatItem = {
      kind: "tool",
      id: "tool-real",
      name: "Read",
      input: { file_path: "/segredo" },
      result: { ok: true, text: "TOKEN-QUE-NAO-PODE-VIAJAR", lines: 1 },
    }
    const [evidence] = evidenceFromItems([tool])

    expect(evidence.text).toBe("Ferramenta Read: concluída")
    expect(JSON.stringify(evidence)).not.toContain("TOKEN-QUE-NAO-PODE-VIAJAR")
    expect(JSON.stringify(evidence)).not.toContain("/segredo")
  })

  it("segmenta um item grande sem perder sua identidade", () => {
    const evidence = evidenceFromItems([
      { kind: "user", id: "grande", text: "á".repeat(8_001) },
    ])

    expect(evidence).toHaveLength(3)
    expect(new Set(evidence.map((item) => item.itemId))).toEqual(new Set(["grande"]))
    expect(evidence.map((item) => item.metadata?.segmentIndex)).toEqual([0, 1, 2])
  })

  it("envia somente itens posteriores ao watermark no incremento", () => {
    const input = buildConversationMapInput({
      items: [
        { kind: "user", id: "u1", text: "Primeiro", ts: 1 },
        { kind: "result", id: "r1", ok: true, ts: 2 },
        { kind: "user", id: "u2", text: "Segundo", ts: 3 },
        { kind: "result", id: "r2", ok: true, ts: 4 },
      ],
      running: false,
      finalizing: false,
      promptVersion: 1,
      mode: "incremental",
      previousMap: null,
      pins: EMPTY_CONVERSATION_MAP_PINS,
      summarizedThroughItemId: "r1",
      now: 5,
    })

    expect(input.allowedEvidenceItemIds).toEqual(["u2", "r2"])
    expect(input.turns).toMatchObject([{ terminalItemId: "r2" }])
  })

  it("mantém na allowlist as fontes ainda citadas pelo mapa anterior", () => {
    const previousMap: SemanticConversationMapV1 = {
      schemaVersion: 1,
      currentFocus: {
        id: "claim",
        text: "Primeiro",
        certainty: "explicit",
        evidence: [{ itemId: "u1", role: "user", channel: "executor" }],
      },
      explicitGoal: null,
      directionChanges: [],
      understandings: [],
      constraints: [],
      openThreads: [],
      latestOutcomeSummary: null,
    }
    const input = buildConversationMapInput({
      items: [
        { kind: "user", id: "u1", text: "Primeiro", ts: 1 },
        { kind: "result", id: "r1", ok: true, ts: 2 },
        { kind: "user", id: "u2", text: "Segundo", ts: 3 },
        { kind: "result", id: "r2", ok: true, ts: 4 },
      ],
      running: false,
      finalizing: false,
      promptVersion: 1,
      mode: "incremental",
      previousMap,
      pins: EMPTY_CONVERSATION_MAP_PINS,
      summarizedThroughItemId: "r1",
      now: 5,
    })

    expect(input.allowedEvidenceItemIds).toEqual(["u1", "u2", "r2"])
  })

  it("divide conversa longa sem perder segmentos nem identidade", () => {
    const items: ChatItem[] = Array.from({ length: 4 }, (_, index) => ({
      kind: "user" as const,
      id: `u-${index}`,
      text: `pedido ${index} ${"x".repeat(3_500)}`,
      ts: 1_000 + index * 1_000,
    }))
    const input = buildConversationMapInput({
      items,
      running: false,
      finalizing: false,
      promptVersion: 2,
      mode: "rebase",
      previousMap: null,
      pins: EMPTY_CONVERSATION_MAP_PINS,
      summarizedThroughItemId: null,
      now: 10_000,
    })
    const blocks = conversationMapEvidenceBlocks(input, 5_000)

    expect(blocks.length).toBeGreaterThan(1)
    expect(blocks.flat().map((item) => item.itemId)).toEqual(
      input.evidence.map((item) => item.itemId),
    )
    expect(blocks.flat().map((item) => item.text).join(""))
      .toBe(input.evidence.map((item) => item.text).join(""))
  })
})
