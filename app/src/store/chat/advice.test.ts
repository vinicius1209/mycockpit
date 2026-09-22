import { describe, expect, it, vi } from "vitest"
import { removeAdviceImpl } from "@/store/chat/advice"
import type { ChatState } from "@/store/chat"

/** Store de mentira: só o que esta função toca. É o que `get`/`patch`
 *  por parâmetro compram — provar o comportamento sem montar o chat inteiro. */
function storeFalsa(conv?: Record<string, unknown>) {
  const persist = vi.fn()
  const byId: Record<string, unknown> = conv ? { c1: conv } : {}
  const get = (() => ({ byId, persist })) as unknown as () => ChatState
  const patch = (convId: string, partial: Record<string, unknown>) => {
    byId[convId] = { ...(byId[convId] as object), ...partial }
  }
  return { get, patch: patch as never, byId, persist }
}

const parecer = (personaId: string, id: string) => ({
  kind: "advice" as const,
  id,
  personaId,
})


describe("removeAdviceImpl", () => {
  it("tira TODOS os pareceres daquela persona, e só dela", () => {
    const s = storeFalsa({
      items: [
        parecer("iris", "a1"),
        { kind: "user", id: "u1", text: "oi" },
        parecer("iris", "a2"),
        parecer("nero", "a3"),
      ],
    })
    removeAdviceImpl(s.get, s.patch, "c1", "iris")
    const ids = (s.byId.c1 as { items: { id: string }[] }).items.map((i) => i.id)
    expect(ids).toEqual(["u1", "a3"])
  })

  it("persiste: apagar item é mudança do fio, não estado de tela", () => {
    const s = storeFalsa({ items: [parecer("iris", "a1")] })
    removeAdviceImpl(s.get, s.patch, "c1", "iris")
    expect(s.persist).toHaveBeenCalledWith("c1")
  })

  it("persona sem parecer nenhum não altera o fio", () => {
    const s = storeFalsa({ items: [parecer("iris", "a1")] })
    removeAdviceImpl(s.get, s.patch, "c1", "ninguem")
    expect((s.byId.c1 as { items: unknown[] }).items).toHaveLength(1)
  })

  it("conversa inexistente é no-op", () => {
    const s = storeFalsa()
    removeAdviceImpl(s.get, s.patch, "sumida", "iris")
    expect(s.persist).not.toHaveBeenCalled()
  })
})
