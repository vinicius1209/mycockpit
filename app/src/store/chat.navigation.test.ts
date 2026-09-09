import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ isTauri: () => false }))
vi.mock("@/lib/db/conversations", () => ({
  listConversations: vi.fn(async () => []),
  loadConversation: vi.fn(async () => null),
  createConversation: vi.fn(async () => {}),
  saveConversation: vi.fn(async () => {}),
  persistConversationOrder: vi.fn(async () => {}),
}))

import {
  listConversations,
  loadConversation,
} from "@/lib/db/conversations"
import { useChat } from "./chat"

const meta = {
  id: "c1",
  title: "Conversa",
  updatedAt: 10,
  color: null,
  worktreePath: null,
  agent: "codex",
}

beforeEach(() => {
  vi.clearAllMocks()
  useChat.setState({
    projectId: null,
    activeId: null,
    conversations: [],
    conversationsByProject: {},
    byId: {},
  })
})

describe("navegação single-flight", () => {
  it("troca o shell imediatamente e compartilha a leitura de metas", async () => {
    let release!: (value: (typeof meta)[]) => void
    vi.mocked(listConversations).mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve }),
    )
    const opening = useChat.getState().openProject("p1")
    const expanding = useChat.getState().loadProjectConversations("p1")
    expect(useChat.getState().projectId).toBe("p1")
    expect(useChat.getState().activeId).toBeNull()
    expect(listConversations).toHaveBeenCalledTimes(1)
    release([meta])
    await Promise.all([opening, expanding])
    expect(useChat.getState().activeId).toBe("c1")
  })

  it("compartilha a hidratação da mesma conversa", async () => {
    useChat.setState({ conversationsByProject: { p1: [meta] } })
    let release!: (value: null) => void
    vi.mocked(loadConversation).mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve }),
    )
    const opening = useChat.getState().openProject("p1")
    const ensuring = useChat.getState().ensureConversationLoaded("p1", "c1")
    expect(loadConversation).toHaveBeenCalledTimes(1)
    release(null)
    await Promise.all([opening, ensuring])
    expect(useChat.getState().byId.c1?.projectId).toBe("p1")
  })
})
