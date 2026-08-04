// Higiene de injeção (H2/H4 do prompt-hygiene-plan) — o ledger efêmero
// `injected` por conversa: `recordInjectedFingerprint` carimba o último
// fingerprint injetado por chave ("doctrine" pelo send; "mcp" pelo evento
// `mcp://announced` do Rust). Mocks no padrão da casa (chat.advice.test.ts).

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))
vi.mock("@/lib/notify", () => ({
  notifyTurnStalled: vi.fn(),
  notifyCardStalled: vi.fn(),
  notifyUnattendedTimeout: vi.fn(),
  notifyApproval: vi.fn(),
  notifyQuestion: vi.fn(),
  nativeNotify: vi.fn(async () => {}),
}))
vi.mock("@/lib/agent", async (io) => ({
  ...(await io<typeof import("@/lib/agent")>()),
  cancelAgent: vi.fn(async () => {}),
  suggest: vi.fn(async () => ""),
}))

import { useChat, type ConvState } from "@/store/chat"

function conv(over: Partial<ConvState> = {}): ConvState {
  return {
    projectId: "p1",
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
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
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useChat.setState({ byId: {} })
})

describe("recordInjectedFingerprint (ledger H2/H4)", () => {
  it("carimba por chave sem apagar as outras (doctrine e mcp convivem)", () => {
    useChat.setState({ byId: { c1: conv() } })
    useChat.getState().recordInjectedFingerprint("c1", "doctrine", "fp-doc-1")
    useChat.getState().recordInjectedFingerprint("c1", "mcp", "fp-mcp-1")
    expect(useChat.getState().byId.c1.injected).toEqual({
      doctrine: "fp-doc-1",
      mcp: "fp-mcp-1",
    })
    // atualização de UMA chave preserva a outra
    useChat.getState().recordInjectedFingerprint("c1", "doctrine", "fp-doc-2")
    expect(useChat.getState().byId.c1.injected).toEqual({
      doctrine: "fp-doc-2",
      mcp: "fp-mcp-1",
    })
  })

  it("mesmo valor é no-op (não recria o objeto da conversa à toa)", () => {
    useChat.setState({ byId: { c1: conv() } })
    useChat.getState().recordInjectedFingerprint("c1", "mcp", "fp-1")
    const antes = useChat.getState().byId.c1
    useChat.getState().recordInjectedFingerprint("c1", "mcp", "fp-1")
    expect(useChat.getState().byId.c1).toBe(antes)
  })

  it("conversa inexistente é no-op (evento de run em background após delete)", () => {
    useChat.getState().recordInjectedFingerprint("fantasma", "mcp", "fp-1")
    expect(useChat.getState().byId.fantasma).toBeUndefined()
  })

  it("é por CONVERSA: carimbar c1 não vaza pra c2", () => {
    useChat.setState({ byId: { c1: conv(), c2: conv() } })
    useChat.getState().recordInjectedFingerprint("c1", "doctrine", "fp-1")
    expect(useChat.getState().byId.c2.injected).toBeUndefined()
  })
})
