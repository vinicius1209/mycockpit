import { describe, expect, it, vi } from "vitest"
import {
  bringAdviceToExecutorImpl,
  removeAdviceImpl,
  takePendingAdviceImpl,
} from "@/store/chat/advice"
import type { ChatState } from "@/store/chat"

/** Store de mentira: só o que estas três funções tocam. É o que `get`/`patch`
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

describe("bringAdviceToExecutorImpl", () => {
  it("o primeiro parecer trazido vira o bloco pendente", () => {
    const s = storeFalsa({ items: [] })
    bringAdviceToExecutorImpl(s.get, s.patch, "c1", "A")
    expect((s.byId.c1 as { pendingAdvice: string }).pendingAdvice).toBe("A")
  })

  it("trazer dois ACUMULA na ordem, em vez de o segundo comer o primeiro", () => {
    const s = storeFalsa({ items: [] })
    bringAdviceToExecutorImpl(s.get, s.patch, "c1", "A")
    bringAdviceToExecutorImpl(s.get, s.patch, "c1", "B")
    expect((s.byId.c1 as { pendingAdvice: string }).pendingAdvice).toBe("A\n\nB")
  })

  it("conversa inexistente é no-op, não cria fio do nada", () => {
    const s = storeFalsa()
    bringAdviceToExecutorImpl(s.get, s.patch, "sumida", "A")
    expect(s.byId).toEqual({})
  })
})

describe("takePendingAdviceImpl", () => {
  it("devolve o bloco e CONSOME: o mesmo parecer não entra em dois turnos", () => {
    const s = storeFalsa({ items: [], pendingAdvice: "A" })
    expect(takePendingAdviceImpl(s.get, s.patch, "c1")).toBe("A")
    expect((s.byId.c1 as { pendingAdvice?: string }).pendingAdvice).toBeUndefined()
    expect(takePendingAdviceImpl(s.get, s.patch, "c1")).toBeNull()
  })

  it("sem nada pendente devolve null e não escreve na conversa", () => {
    const s = storeFalsa({ items: [] })
    expect(takePendingAdviceImpl(s.get, s.patch, "c1")).toBeNull()
    expect(s.byId.c1).toEqual({ items: [] })
  })

  it("não persiste: quem persiste é o caminho de envio, depois do aceite", () => {
    const s = storeFalsa({ items: [], pendingAdvice: "A" })
    takePendingAdviceImpl(s.get, s.patch, "c1")
    expect(s.persist).not.toHaveBeenCalled()
  })
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
