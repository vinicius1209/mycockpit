// Evidência VISUAL no fio (browser-plan B1): o tool_result pode trazer
// `images` (paths relativos gravados pelo backend). O reducer preserva os
// paths no item da tool — que persiste no snapshot (replay-safe) — e o caso
// sem imagem fica BYTE-IDÊNTICO ao de sempre (fail-open, sem regressão).
import { describe, expect, it } from "vitest"
import { reduceItems, type ChatItem, type ItemReducible } from "@/store/chat"
import type { AgentEvent } from "@/lib/agent"

const T0 = 1_785_512_000_000

function base(items: ChatItem[] = []): ItemReducible {
  return {
    items,
    streamingTextId: null,
    model: null,
    sessionId: null,
    startedAt: null,
    contextTokens: undefined,
  }
}

function apply(c: ItemReducible, e: AgentEvent, now = T0): ItemReducible {
  return { ...c, ...reduceItems(c, e, undefined, now) }
}

const toolUse: AgentEvent = {
  type: "tool",
  id: "toolu_01",
  name: "mcp__playwright__browser_take_screenshot",
  input: {},
  parent_tool_id: null,
}

describe("reduceItems · tool_result com images (B1)", () => {
  it("preserva os paths de evidência no item da tool", () => {
    let c = apply(base(), toolUse)
    c = apply(c, {
      type: "tool_result",
      id: "toolu_01",
      ok: true,
      text: "Took screenshot",
      lines: 1,
      images: ["evidence/conv-1/toolu_01-0.png", "evidence/conv-1/toolu_01-1.jpg"],
    })
    const it0 = c.items[0]
    expect(it0.kind).toBe("tool")
    if (it0.kind !== "tool") return
    expect(it0.result).toEqual({ ok: true, text: "Took screenshot", lines: 1 })
    expect(it0.images).toEqual([
      "evidence/conv-1/toolu_01-0.png",
      "evidence/conv-1/toolu_01-1.jpg",
    ])
  })

  it("sem images (evento antigo/tool sem imagem) o item fica idêntico ao de hoje", () => {
    let c = apply(base(), toolUse)
    c = apply(c, {
      type: "tool_result",
      id: "toolu_01",
      ok: true,
      text: "42 linhas",
      lines: 42,
    })
    const it0 = c.items[0]
    if (it0.kind !== "tool") throw new Error("esperava tool")
    expect(it0.images).toBeUndefined()
    expect("images" in it0).toBe(false)
  })

  it("images vazio não cria a chave (payload igual ao serializado de antes)", () => {
    let c = apply(base(), toolUse)
    c = apply(c, {
      type: "tool_result",
      id: "toolu_01",
      ok: true,
      text: "",
      lines: 0,
      images: [],
    })
    const it0 = c.items[0]
    if (it0.kind !== "tool") throw new Error("esperava tool")
    expect("images" in it0).toBe(false)
  })

  it("replay do snapshot: images sobrevive porque mora no próprio item", () => {
    let c = apply(base(), toolUse)
    c = apply(c, {
      type: "tool_result",
      id: "toolu_01",
      ok: true,
      text: "ok",
      lines: 1,
      images: ["evidence/conv-1/toolu_01-0.png"],
    })
    // o snapshot persiste `items` como JSON; ida e volta não perde a evidência
    const roundtrip = JSON.parse(JSON.stringify(c.items)) as ChatItem[]
    const it0 = roundtrip[0]
    if (it0.kind !== "tool") throw new Error("esperava tool")
    expect(it0.images).toEqual(["evidence/conv-1/toolu_01-0.png"])
  })
})
