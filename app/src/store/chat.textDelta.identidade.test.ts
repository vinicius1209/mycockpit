// O reducer mais quente do app: `text_delta` roda por TOKEN.
//
// Ele fazia `items.map(...)` — varria o fio inteiro para trocar UM item. Agora
// acha a bolha viva de trás pra frente e substitui só o índice alvo. Estes
// testes fixam as duas metades do contrato: o array TEM que ser novo (é o que
// o React enxerga como mudança) e os outros itens TÊM que voltar por
// referência (é o que os `memo` do MessageList consomem, P1).
import { describe, expect, it } from "vitest"
import { reduceItems, type ChatItem, type ItemReducible } from "@/store/chat"
import type { AgentEvent } from "@/lib/agent"

const delta = (text: string): AgentEvent => ({ type: "text_delta", text })

function fio(extras: ChatItem[] = []): ItemReducible {
  const items: ChatItem[] = [
    { kind: "user", id: "u1", text: "faça" } as ChatItem,
    { kind: "tool", id: "t1", name: "Read", input: { file_path: "/a" } } as ChatItem,
    { kind: "tool", id: "t2", name: "Bash", input: { command: "ls" } } as ChatItem,
    { kind: "text", id: "viva", text: "olá" } as ChatItem,
    ...extras,
  ]
  return {
    items,
    streamingTextId: "viva",
    model: null,
    sessionId: null,
    startedAt: null,
    contextTokens: undefined,
  }
}

describe("text_delta — troca só a bolha viva", () => {
  it("o array é NOVO (senão o React não vê o token chegar)", () => {
    const c = fio()
    const out = reduceItems(c, delta("!"))
    expect(out.items).toBeDefined()
    expect(out.items).not.toBe(c.items)
  })

  it("os itens intocados voltam por REFERÊNCIA (é o que os memo do fio leem)", () => {
    const c = fio()
    const items = reduceItems(c, delta("!")).items!
    expect(items[0]).toBe(c.items[0])
    expect(items[1]).toBe(c.items[1])
    expect(items[2]).toBe(c.items[2])
    expect(items[3]).not.toBe(c.items[3])
  })

  it("o texto acumula na bolha corrente", () => {
    const c = fio()
    const items = reduceItems(c, delta(", mundo")).items!
    expect(items).toHaveLength(4)
    expect((items[3] as Extract<ChatItem, { kind: "text" }>).text).toBe("olá, mundo")
  })

  it("bolha viva que não é o último item ainda é achada (um `notice` pode cair depois dela)", () => {
    const c = fio([
      { kind: "notice", id: "n1", message: "contexto acabando" } as ChatItem,
    ])
    const items = reduceItems(c, delta("!")).items!
    expect((items[3] as Extract<ChatItem, { kind: "text" }>).text).toBe("olá!")
    expect(items[4]).toBe(c.items[4])
  })

  it("bolha apontada que sumiu do fio não fabrica item nem quebra (fail-open)", () => {
    const c = { ...fio(), streamingTextId: "fantasma" }
    expect(reduceItems(c, delta("!"))).toEqual({})
  })

  it("sem bolha aberta, o delta abre uma nova no fim (comportamento de sempre)", () => {
    const c = { ...fio(), streamingTextId: null }
    const out = reduceItems(c, delta("nova"))
    expect(out.items).toHaveLength(5)
    expect((out.items![4] as Extract<ChatItem, { kind: "text" }>).text).toBe("nova")
    expect(out.streamingTextId).toBe(out.items![4].id)
  })
})
