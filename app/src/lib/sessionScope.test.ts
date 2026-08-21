// M3: o modo é da CONVERSA, e o projeto é o DEFAULT de quem não decidiu.
//
// Antes, o mesmo controle mudava o PROJETO inteiro sem dizer, e o "Planejar"
// não sobrevivia a restart (não havia coluna). Estes testes fixam o escopo e a
// herança — que é onde um erro sairia caro: uma conversa "Liberado" herdada por
// engano num projeto "Só lê" é permissão que ninguém pediu.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { useChat, type ConvState } from "@/store/chat"

vi.mock("@/lib/db", async (o) => ({
  ...(await o<typeof import("@/lib/db")>()),
  isTauri: () => false,
}))

const P = "p1"
const base = {
  projectId: P,
  agent: "claude-code",
  reqModel: null,
  effort: null,
  worktreePath: null,
  items: [],
  sessionId: null,
  model: null,
  contextTokens: 0,
  streamingTextId: null,
  running: false,
  finalizing: false,
  runId: null,
  startedAt: null,
  suggestions: [],
  suggesting: false,
} as unknown as ConvState

beforeEach(() => {
  const metas = [
    { id: "c1", title: "a", updatedAt: 0, color: null, worktreePath: null, agent: "claude-code" },
    { id: "c2", title: "b", updatedAt: 0, color: null, worktreePath: null, agent: "claude-code" },
  ]
  useChat.setState({
    projectId: P,
    activeId: "c1",
    conversations: metas,
    conversationsByProject: { [P]: metas },
    byId: { c1: { ...base }, c2: { ...base } },
  })
})

describe("setSessionMode", () => {
  it("grava o modo NESTA conversa", () => {
    useChat.getState().setSessionMode("c1", "liberado")
    expect(useChat.getState().byId.c1.sessionMode).toBe("liberado")
  })

  it("NÃO vaza para as outras conversas do projeto", () => {
    // O comportamento antigo era o oposto: o controle mudava o projeto, e com
    // ele toda conversa que herdava.
    useChat.getState().setSessionMode("c1", "liberado")
    expect(useChat.getState().byId.c2.sessionMode ?? null).toBeNull()
  })

  it("`null` volta a HERDAR o projeto (é o que aprovar o plano faz)", () => {
    useChat.getState().setSessionMode("c1", "plan")
    useChat.getState().setSessionMode("c1", null)
    expect(useChat.getState().byId.c1.sessionMode ?? null).toBeNull()
  })

  it("conversa nova nasce sem modo próprio (herda)", () => {
    expect(useChat.getState().byId.c2.sessionMode ?? null).toBeNull()
  })

  it("gravar o mesmo modo duas vezes não recria a conversa", () => {
    // A referência estável é o que segura o memo por item do fio.
    useChat.getState().setSessionMode("c1", "auto")
    const antes = useChat.getState().byId.c1
    useChat.getState().setSessionMode("c1", "auto")
    expect(useChat.getState().byId.c1).toBe(antes)
  })

  it("conversa que não existe não quebra nem cria linha", () => {
    useChat.getState().setSessionMode("fantasma", "liberado")
    expect(useChat.getState().byId.fantasma).toBeUndefined()
  })
})
