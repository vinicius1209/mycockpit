import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatItem } from "@/store/chat"

const salvar = vi.hoisted(() =>
  vi.fn(async (_conv: string, _items: readonly unknown[], _positions: readonly number[], _all: boolean) => 1 as number | null),
)
vi.mock("@/lib/db/conversationItems", async (original) => ({
  ...(await original<typeof import("@/lib/db/conversationItems")>()),
  saveConversationItemChanges: salvar,
}))

import { createItemPersistence } from "./itemPersistence"

// Forma dos itens do fio (a de `store/chat`), no ritmo de um turno real:
// pedido, texto do agente, ação, recibo.
function turno(n: number): ChatItem[] {
  return [
    { kind: "user", id: `u${n}`, text: `pedido ${n}`, ts: n * 10 },
    { kind: "text", id: `t${n}`, text: `resposta ${n}`, ts: n * 10 + 1 },
    { kind: "result", id: `r${n}`, ok: true, ts: n * 10 + 2 },
  ] as ChatItem[]
}

function persistencia(items: () => ChatItem[]) {
  return createItemPersistence(() => ({ byId: { c1: { items: items() } } }))
}

beforeEach(() => {
  salvar.mockClear()
  salvar.mockResolvedValue(1)
})

describe("persist só grava o que mudou (ADR-230)", () => {
  it("o primeiro persist da sessão grava tudo; o seguinte, só o turno novo", async () => {
    let items = [...turno(1), ...turno(2)]
    const p = persistencia(() => items)
    await p.persistir("c1", items)
    expect(salvar.mock.calls[0][2]).toEqual([0, 1, 2, 3, 4, 5])
    expect(salvar.mock.calls[0][3]).toBe(true)

    items = [...items, ...turno(3)]
    await p.persistir("c1", items)
    expect(salvar.mock.calls[1][2]).toEqual([6, 7, 8])
    expect(salvar.mock.calls[1][3]).toBe(false)
  })

  it("mudança feita por fora dos eventos (reação num item antigo) entra no próximo persist", async () => {
    let items = [...turno(1), ...turno(2)]
    const p = persistencia(() => items)
    await p.persistir("c1", items)
    items = items.map((it, i) => (i === 1 ? ({ ...it, reactions: ["👍"] } as ChatItem) : it))
    await p.persistir("c1", items)
    expect(salvar.mock.calls[1][2]).toEqual([1])
  })

  it("a fila de streaming gravar parte não faz o persist esquecer o resto", async () => {
    let items = [...turno(1)]
    const p = persistencia(() => items)
    await p.persistir("c1", items)
    items = [...items, ...turno(2)]
    // o streaming viu só a posição 3 mudar e gravou por conta própria
    p.schedule("c1", [3], items.length)
    await p.flush("c1")
    await p.persistir("c1", items)
    expect(salvar.mock.calls.at(-1)![2]).toEqual([3, 4, 5])
  })

  it("item removido: nenhuma posição muda de identidade antes dele, e a cauda sai pela contagem", async () => {
    let items = [...turno(1), ...turno(2)]
    const p = persistencia(() => items)
    await p.persistir("c1", items)
    items = items.slice(0, 5)
    await p.persistir("c1", items)
    const [, enviados, posicoes, tudo] = salvar.mock.calls[1]
    expect(posicoes).toEqual([])
    expect(enviados).toHaveLength(5)
    expect(tudo).toBe(false)
  })

  it("nada mudou: nenhuma escrita", async () => {
    const items = turno(1)
    const p = persistencia(() => items)
    await p.persistir("c1", items)
    await p.persistir("c1", items)
    expect(salvar).toHaveBeenCalledTimes(1)
  })

  it("escrita que falhou faz o próximo persist regravar tudo", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {})
    let items = turno(1)
    const p = persistencia(() => items)
    await p.persistir("c1", items)
    items = [...items, ...turno(2)]
    salvar.mockRejectedValueOnce(new Error("disco cheio"))
    await p.persistir("c1", items)
    await p.persistir("c1", items)
    expect(salvar.mock.calls.at(-1)![2]).toEqual([0, 1, 2, 3, 4, 5])
    aviso.mockRestore()
  })
})
