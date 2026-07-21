// appendItems (useChat): anexo de itens PRONTOS ao fio + persist — o caminho
// que os marcos da missão usam (store/mission.ts) pra o histórico sobreviver a
// restart. Regras: exige a conversa carregada em byId (no-op com aviso se não
// — nunca fabrica estado vazio que o persist/UPSERT gravaria por cima), push
// imutável, NUNCA mexe em running/runId, e preserva o título fixo da meta.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { useChat, type ChatItem, type ConvState } from "./chat"

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

function notice(message: string): ChatItem {
  return { kind: "notice", id: crypto.randomUUID(), message }
}

beforeEach(() => {
  useChat.setState({
    projectId: PROJ,
    activeId: CONV,
    conversations: [],
    conversationsByProject: {
      [PROJ]: [
        {
          id: CONV,
          title: "Missão · Teste",
          updatedAt: 0,
          color: null,
          worktreePath: null,
          agent: "claude-code",
        },
      ],
    },
    byId: {},
  })
})

describe("useChat.appendItems (marcos persistidos no fio)", () => {
  it("anexa imutavelmente ao fim do fio e NÃO mexe em running/runId", async () => {
    const before = conv({
      items: [{ kind: "user", id: "u1", text: "oi" }],
      running: true,
      runId: "r1",
    })
    const frozen = before.items
    useChat.setState((s) => ({ byId: { ...s.byId, [CONV]: before } }))

    await useChat.getState().appendItems(CONV, [notice("marco 1"), notice("marco 2")])

    const after = useChat.getState().byId[CONV]
    expect(after.items.map((it) => it.kind)).toEqual(["user", "notice", "notice"])
    expect(frozen).toHaveLength(1) // o array original não foi mutado
    expect(after.running).toBe(true)
    expect(after.runId).toBe("r1")
  })

  it("preserva o título fixo da meta (não re-deriva do 1º prompt)", async () => {
    useChat.setState((s) => ({
      byId: {
        ...s.byId,
        [CONV]: conv({ items: [{ kind: "user", id: "u1", text: "outro título" }] }),
      },
    }))

    await useChat.getState().appendItems(CONV, [notice("marco")])

    const meta = useChat
      .getState()
      .conversationsByProject[PROJ].find((c) => c.id === CONV)
    expect(meta?.title).toBe("Missão · Teste") // o persist manteve a meta
  })

  it("conversa NÃO carregada em byId → no-op com aviso (nunca fabrica estado)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await useChat.getState().appendItems(CONV, [notice("perdido")])

    expect(useChat.getState().byId[CONV]).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("não carregada"),
      CONV,
    )
    warn.mockRestore()
  })

  it("linha corrompida → no-op silencioso (persist é bloqueado nela)", async () => {
    useChat.setState((s) => ({
      byId: { ...s.byId, [CONV]: conv({ corrupt: true }) },
    }))

    await useChat.getState().appendItems(CONV, [notice("marco")])

    expect(useChat.getState().byId[CONV].items).toEqual([])
  })

  it("lista vazia → no-op total (nem persist)", async () => {
    useChat.setState((s) => ({ byId: { ...s.byId, [CONV]: conv() } }))
    const before = useChat.getState().byId[CONV]

    await useChat.getState().appendItems(CONV, [])

    expect(useChat.getState().byId[CONV]).toBe(before) // mesma referência
  })
})
