import { beforeEach, describe, expect, it, vi } from "vitest"
import { useChat, type ConvState } from "../chat"
import { cloneTitle } from "./clone"
import { useApp } from "@/store/app"
import { createWorktree } from "@/lib/git"

const h = vi.hoisted(() => ({ tauri: false }))

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>()
  return { ...original, isTauri: () => h.tauri }
})
vi.mock("@/lib/git", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/git")>()),
  createWorktree: vi.fn(),
}))
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock("@/lib/db/conversations", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db/conversations")>()
  return {
    ...original,
    loadConversation: vi.fn(async () => null),
    saveConversation: vi.fn(async () => {}),
    setConversationColor: vi.fn(async () => {}),
  }
})

const PROJECT = "project"
const CONV = "conv-src"

function sourceConv(): ConvState {
  return {
    projectId: PROJECT,
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [
      { kind: "user", id: "u1", text: "primeira pergunta" },
      { kind: "result", id: "r1", ok: true },
      { kind: "user", id: "u2", text: "segunda pergunta" },
      { kind: "result", id: "r2", ok: true },
    ],
    sessionId: "sess-1",
    model: "claude-opus-5",
    contextTokens: 1_000,
    streamingTextId: null,
    running: false,
    finalizing: false,
    runId: null,
    startedAt: null,
    suggestions: [],
    suggesting: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.tauri = false
  useChat.setState({
    projectId: PROJECT,
    activeId: CONV,
    conversations: [
      {
        id: CONV,
        title: "Conversa original",
        updatedAt: 0,
        color: "verde",
        worktreePath: null,
        agent: "claude-code",
      },
    ],
    conversationsByProject: {
      [PROJECT]: [
        {
          id: CONV,
          title: "Conversa original",
          updatedAt: 0,
          color: "verde",
          worktreePath: null,
          agent: "claude-code",
        },
      ],
    },
    byId: { [CONV]: sourceConv() },
  })
})

describe("duplicateConversation", () => {
  it("copia o histórico INTEIRO, ativa a cópia e não herda sessão/model", async () => {
    await useChat.getState().duplicateConversation(CONV)
    const s = useChat.getState()
    const newId = s.activeId
    expect(newId).not.toBe(CONV)
    expect(s.byId[newId!].items).toHaveLength(4)
    expect(s.byId[newId!].sessionId).toBeNull()
    const meta = s.conversationsByProject[PROJECT].find((c) => c.id === newId)
    expect(meta?.title).toBe("Conversa original (cópia)")
    expect(meta?.color).toBe("verde")
  })
})

describe("forkConversationAt", () => {
  it("copia só até o turno escolhido (histórico CURADO, não inteiro)", async () => {
    await useChat.getState().forkConversationAt(CONV, "r1")
    const s = useChat.getState()
    const newId = s.activeId
    expect(newId).not.toBe(CONV)
    expect(s.byId[newId!].items.map((it) => it.id)).toEqual(["u1", "r1"])
    const meta = s.conversationsByProject[PROJECT].find((c) => c.id === newId)
    expect(meta?.title).toBe("Conversa original (fork)")
  })

  it("não herda sessão do CLI da origem (resume conflitaria)", async () => {
    await useChat.getState().forkConversationAt(CONV, "r1")
    const s = useChat.getState()
    expect(s.byId[s.activeId!].sessionId).toBeNull()
  })

  it("item fora do fio carregado: no-op (não força um fork quebrado)", async () => {
    await useChat.getState().forkConversationAt(CONV, "item-que-nao-existe")
    expect(useChat.getState().activeId).toBe(CONV)
  })

  it("conversa não carregada em byId: no-op", async () => {
    await useChat.getState().forkConversationAt("conv-fantasma", "r1")
    expect(useChat.getState().activeId).toBe(CONV)
  })
})

describe("cloneTitle", () => {
  it("primeiro fork não leva número", () => {
    expect(cloneTitle("Conversa", "fork", [])).toBe("Conversa (fork)")
  })

  it("forkar um fork NÃO acumula marcador", () => {
    expect(cloneTitle("Conversa (fork)", "fork", [])).toBe("Conversa (fork)")
  })

  it("título legado com marcador repetido é limpo até a base", () => {
    expect(cloneTitle("Conversa (fork) (fork)", "fork", [])).toBe("Conversa (fork)")
  })

  it("irmão já existente empurra pro próximo número livre", () => {
    const irmaos = ["Conversa (fork)", "Conversa (fork 2)"]
    expect(cloneTitle("Conversa", "fork", irmaos)).toBe("Conversa (fork 3)")
  })

  it("buraco na numeração é reaproveitado (menor livre, não o maior+1)", () => {
    const irmaos = ["Conversa (fork)", "Conversa (fork 3)"]
    expect(cloneTitle("Conversa", "fork", irmaos)).toBe("Conversa (fork 2)")
  })

  it("cópia e fork numeram em faixas separadas", () => {
    const irmaos = ["Conversa (fork)", "Conversa (fork 2)"]
    expect(cloneTitle("Conversa", "cópia", irmaos)).toBe("Conversa (cópia)")
  })

  it("forkar uma cópia troca o marcador (não empilha os dois)", () => {
    expect(cloneTitle("Conversa (cópia)", "fork", [])).toBe("Conversa (fork)")
  })

  it("título que era SÓ marcador não vira string vazia", () => {
    expect(cloneTitle("(fork)", "fork", [])).toBe("Conversa (fork)")
  })

  it("marcador no MEIO do título é preservado (só o fim é sufixo)", () => {
    expect(cloneTitle("Bug do (fork) no git", "fork", [])).toBe(
      "Bug do (fork) no git (fork)",
    )
  })
})

describe("fork isolado em worktree (F2 — paralelo de verdade)", () => {
  beforeEach(() => {
    h.tauri = true
    useApp.setState({
      projects: [{ id: PROJECT, name: "p", path: "/repo", createdAt: 0 }],
    })
  })

  it("cria o worktree para a conversa NOVA (não para a origem)", async () => {
    vi.mocked(createWorktree).mockResolvedValue({
      path: "/repo/.mycockpit/worktrees/abc",
      branch: "mycockpit/abc",
    })
    await useChat.getState().forkConversationAt(CONV, "r1")
    const newId = useChat.getState().activeId!
    expect(newId).not.toBe(CONV)
    expect(createWorktree).toHaveBeenCalledWith("/repo", newId)
  })

  it("o worktree entra no estado da conversa forkada", async () => {
    vi.mocked(createWorktree).mockResolvedValue({
      path: "/repo/.mycockpit/worktrees/abc",
      branch: "mycockpit/abc",
    })
    await useChat.getState().forkConversationAt(CONV, "r1")
    const s = useChat.getState()
    expect(s.byId[s.activeId!].worktreePath).toBe("/repo/.mycockpit/worktrees/abc")
    // a origem NÃO é tocada: ela continua onde estava.
    expect(s.byId[CONV].worktreePath).toBeNull()
  })

  it("FAIL-SOFT: git recusando não desfaz o fork que já existe", async () => {
    vi.mocked(createWorktree).mockRejectedValue(
      "este projeto não é um repositório git",
    )
    await useChat.getState().forkConversationAt(CONV, "r1")
    const s = useChat.getState()
    expect(s.activeId).not.toBe(CONV) // o fork ficou e é a ativa
    expect(s.byId[s.activeId!].items).toHaveLength(2)
    expect(s.byId[s.activeId!].worktreePath).toBeNull() // sem isolamento, honesto
  })

  it("duplicar NÃO isola (é 'quero outra igual', não caminho paralelo)", async () => {
    await useChat.getState().duplicateConversation(CONV)
    expect(createWorktree).not.toHaveBeenCalled()
  })

  it("fora do Tauri não tenta git nenhum", async () => {
    h.tauri = false
    await useChat.getState().forkConversationAt(CONV, "r1")
    expect(createWorktree).not.toHaveBeenCalled()
  })
})
