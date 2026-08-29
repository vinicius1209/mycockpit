// Carimbo do agent na META da conversa — é ela que a sidebar lê pro ícone.
// Incidente: conversa nova rodando Antigravity aparecia na lista com o logo do
// Claude Code. Duas frestas: (1) `start` espelhava só o título, então durante o
// turno INTEIRO a meta ficava com o carimbo velho/vazio e a linha caía no
// default global; (2) `setConversationAgent` comparava só com o `byId`, que
// nasce no padrão histórico "claude-code", e engolia o carimbo quando a meta
// ainda estava nula. O ícone tem que dizer quem VAI rodar / rodou.
import { beforeEach, describe, expect, it } from "vitest"
import { useChat, type ConvState, type ChatItem } from "./chat"

const CONV = "c1"
const PROJ = "proj1"

function conv(over: Partial<ConvState> = {}): ConvState {
  return {
    projectId: PROJ,
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

/** Conversa NOVA: a meta nasce sem carimbo (`agent: null`) e o `byId` no
 *  padrão histórico — exatamente o estado do incidente. */
function seed(metaAgent: string | null, items: ChatItem[] = []) {
  useChat.setState({
    projectId: PROJ,
    activeId: CONV,
    conversationsByProject: {
      [PROJ]: [
        {
          id: CONV,
          title: null,
          updatedAt: 0,
          color: null,
          worktreePath: null,
          agent: metaAgent,
        },
      ],
    },
    conversations: [
      {
        id: CONV,
        title: null,
        updatedAt: 0,
        color: null,
        worktreePath: null,
        agent: metaAgent,
      },
    ],
    byId: { [CONV]: conv({ items }) },
  })
}

function metaAgent(): string | null {
  return useChat.getState().conversations[0].agent
}

beforeEach(() => {
  seed(null)
})

describe("useChat.start · o ícone segue quem está rodando", () => {
  it("carimba na meta o agent do turno, sem esperar o fim dele", () => {
    useChat.getState().start(CONV, "oi", "r1", "agy", null, null, [])
    expect(metaAgent()).toBe("agy")
    expect(useChat.getState().byId[CONV].agent).toBe("agy")
  })

  it("não atropela o título já fixado ao carimbar o agent", () => {
    useChat.setState((s) => ({
      conversations: s.conversations.map((c) => ({ ...c, title: "Missão · X" })),
      conversationsByProject: {
        [PROJ]: s.conversationsByProject[PROJ].map((c) => ({
          ...c,
          title: "Missão · X",
        })),
      },
    }))
    useChat.getState().start(CONV, "oi", "r1", "codex", null, null, [])
    expect(useChat.getState().conversations[0].title).toBe("Missão · X")
    expect(metaAgent()).toBe("codex")
  })
})

describe("useChat.setConversationAgent · preenche o vazio, não inventa", () => {
  it("carimba a meta ainda nula mesmo quando o byId já traz o padrão histórico", () => {
    // escolher justamente "claude-code" no composer precisa carimbar: sem isso
    // a meta ficava nula e a linha exibia o default GLOBAL, que pode ser outro.
    useChat.getState().setConversationAgent(CONV, "claude-code")
    expect(metaAgent()).toBe("claude-code")
  })

  it("troca o carimbo quando o agent escolhido muda", () => {
    useChat.getState().setConversationAgent(CONV, "agy")
    expect(metaAgent()).toBe("agy")
    expect(useChat.getState().byId[CONV].agent).toBe("agy")
  })

  it("NÃO mexe em conversa com turno de executor (identidade travada no 1º run)", () => {
    seed("codex", [
      { kind: "user", id: "u1", text: "oi" },
      { kind: "text", id: "t1", text: "olá" },
    ])
    useChat.getState().setConversationAgent(CONV, "agy")
    expect(metaAgent()).toBe("codex")
    expect(useChat.getState().byId[CONV].agent).toBe("claude-code")
  })

  it("conversa desconhecida (fio não carregado) é no-op", () => {
    useChat.setState({ byId: {} })
    useChat.getState().setConversationAgent(CONV, "agy")
    expect(metaAgent()).toBe(null)
  })
})
