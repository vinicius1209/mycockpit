// F3 do PRD da busca no fio: conversa anterior à migração 48 entra na fonte
// itemizada na primeira abertura, e o índice a alcança pelos triggers.
//
// O caso que estes testes existem para impedir: `loadConversation` PREFERE a
// fonte itemizada ao blob. Um retrofit que gravasse contagem zero, ou que
// gravasse pela metade, passaria a ser o que a pessoa vê — e aí não é retrofit,
// é perda de histórico.

import { beforeEach, describe, expect, it, vi } from "vitest"

const invoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }))
vi.mock("@/lib/db", () => ({
  isTauri: () => true,
  getDb: async () => ({}),
}))
vi.mock("@/lib/db/schema", () => ({ ensureConversationItemTables: async () => {} }))

import { itemizarSeFaltando } from "./conversationItems"
import type { ChatItem } from "@/store/chat"

const item = (id: string, text: string): ChatItem =>
  ({ kind: "text", id, text }) as ChatItem

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue(1)
})

describe("retrofit da conversa que só existe no blob", () => {
  it("grava o snapshot inteiro, com todas as posições", async () => {
    await itemizarSeFaltando("c1", [item("a", "um"), item("b", "dois"), item("c", "três")])
    expect(invoke).toHaveBeenCalledTimes(1)
    const [nome, args] = invoke.mock.calls[0] as [string, Record<string, unknown>]
    expect(nome).toBe("save_conversation_item_changes")
    expect(args.replaceAll).toBe(true)
    expect(args.itemCount).toBe(3)
    expect((args.changes as { position: number }[]).map((c) => c.position)).toEqual([0, 1, 2])
  })

  it("conversa VAZIA não é itemizada", async () => {
    // Gravar item_count 0 faria o carregamento preferir uma lista vazia ao
    // blob. Isso é perda de histórico, não retrofit.
    await itemizarSeFaltando("c1", [])
    expect(invoke).not.toHaveBeenCalled()
  })

  it("falhar não derruba quem está abrindo a conversa", async () => {
    // Fail-open: o blob segue sendo a fonte e a busca segue varrendo.
    invoke.mockRejectedValue(new Error("banco ocupado"))
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(itemizarSeFaltando("c1", [item("a", "um")])).resolves.toBeUndefined()
    expect(aviso).toHaveBeenCalled()
    aviso.mockRestore()
  })
})
