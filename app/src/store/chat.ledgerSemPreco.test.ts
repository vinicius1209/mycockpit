// ADR-047 no STORE — o turno do Antigravity para de ser invisível no ledger.
//
// Fixture REAL (ADR-016): os `result` gravados na conversa
// ec1642c1-5328-409e-afc8-58e79a3cdca1 (banco do usuário, incidente
// 2026-08-16). Todos com `costSource: "unknown"` e `cost_usd` ausente, porque
// não havia NENHUMA linha google em pricing.rs — e por causa do guard
// `cost_usd != null` nenhum deles virou linha em `turn_costs`: 320 linhas de
// claude-code, 88 de codex, ZERO de agy.
//
// Scaffolding espelha chat.transplant.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { recordTurnCost } from "@/lib/db"
import { useChat, type ConvState } from "./chat"

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>()
  return {
    ...original,
    isTauri: () => false,
    recordTurnCost: vi.fn(async () => {}),
  }
})
vi.mock("@/lib/db/conversations", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db/conversations")>()
  return {
    ...original,
    saveConversation: vi.fn(async () => {}),
  }
})

vi.mock("@/store/cards", () => ({
  useCards: {
    getState: () => ({ noteConversationAgent: vi.fn() }),
  },
}))

const CONV = "ec1642c1-5328-409e-afc8-58e79a3cdca1"

function agyConv(): ConvState {
  return {
    projectId: "mycockpit",
    agent: "agy",
    reqModel: "gemini-3.7-flash-high",
    effort: null,
    worktreePath: null,
    items: [{ kind: "user", id: "u1", text: "ok, eu uso o plano AI pro" }],
    sessionId: "2b859b42-14d7-4a11-965a-f910a080b891",
    model: "gemini-3.7-flash-high",
    streamingTextId: null,
    running: true,
    finalizing: false,
    runId: "run-agy-69",
    startedAt: 1_786_913_442_000,
    suggestions: [],
    suggesting: false,
  }
}

beforeEach(() => {
  vi.mocked(recordTurnCost).mockClear()
  useChat.setState({
    projectId: "mycockpit",
    activeId: CONV,
    conversations: [],
    conversationsByProject: {},
    byId: { [CONV]: agyConv() },
  })
})

describe("ledger de custo com preço desconhecido (ADR-047)", () => {
  it("turno sem preço vira linha com custo NULO e os tokens reais", () => {
    useChat.getState().handleEvent(CONV, {
      type: "result",
      ok: false,
      text: null,
      cost_usd: null,
      cost_source: "unknown",
      input_tokens: 2_399_909,
      output_tokens: 11_098,
      cache_read: 2_101_766,
      cache_creation: 0,
    })

    expect(vi.mocked(recordTurnCost)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recordTurnCost).mock.calls[0][0]).toMatchObject({
      runId: "run-agy-69",
      convId: CONV,
      agent: "agy",
      model: "gemini-3.7-flash-high",
      // NULO, não zero: o app não sabe o preço, e US$ 0,00 seria mentira
      costUsd: null,
      costSource: "unknown",
      input: 2_399_909,
      output: 11_098,
      cache: 2_101_766,
    })
  })

  // O PISO (result que não consumiu nada não vira linha) mora no
  // recordTurnCost, e é provado lá: db.ledgerSemPreco.test.ts.

  it("turno COM preço continua gravando como sempre", () => {
    useChat.getState().handleEvent(CONV, {
      type: "result",
      ok: true,
      text: null,
      cost_usd: 0.4228572,
      cost_source: "estimated",
      input_tokens: 2_399_909,
      output_tokens: 11_098,
      cache_read: 2_101_766,
      cache_creation: 0,
    })
    expect(vi.mocked(recordTurnCost).mock.calls[0][0]).toMatchObject({
      costUsd: 0.4228572,
      costSource: "estimated",
    })
  })
})
