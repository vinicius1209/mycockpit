import { describe, expect, it } from "vitest"
import {
  changedItemPositions,
  itemChanges,
} from "@/lib/db/conversationItems"
import type { ChatItem } from "@/store/chat"

const item = (id: string, text: string): ChatItem => ({
  kind: "text",
  id,
  text,
  ts: 1,
})

describe("change-set incremental do transcript", () => {
  it("preserva referências intocadas e grava somente o item alterado", () => {
    const first = item("a", "antigo")
    const second = item("b", "estável")
    const before = [first, second]
    const after = [{ ...first, text: "novo" }, second]
    const positions = changedItemPositions(before, after)
    expect(positions).toEqual([0])
    expect(itemChanges(after, positions)).toEqual([
      {
        position: 0,
        itemId: "a",
        itemJson: JSON.stringify(after[0]),
      },
    ])
  })

  it("append mantém ordem determinística e não serializa o prefixo", () => {
    const first = item("a", "estável")
    const appended = item("b", "chegou")
    const before = [first]
    const after = [first, appended]
    expect(changedItemPositions(before, after)).toEqual([1])
    expect(itemChanges(after, [1, 1]).map((change) => change.itemId)).toEqual(["b"])
  })

  it("delta de uma conversa longa continua proporcional a um único item", () => {
    const before = Array.from({ length: 5_000 }, (_, index) =>
      item(`item-${index}`, `conteúdo estável ${index}`),
    )
    const after = [...before]
    after[4_999] = item("item-4999", "cauda atualizada")

    const changes = itemChanges(after, changedItemPositions(before, after))
    expect(changes).toHaveLength(1)
    expect(changes[0].position).toBe(4_999)
    expect(JSON.stringify(changes).length).toBeLessThan(200)
  })
})
