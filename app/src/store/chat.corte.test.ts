import { beforeEach, describe, expect, it } from "vitest"
import { reduceItems, useChat, type ChatItem, type ItemReducible } from "@/store/chat"
import { limparCausasDoCorte, marcarCausaDoCorte, tomarCausaDoCorte } from "@/lib/corte"

const T0 = 1_788_962_247_781 // o cancelled real de 09/09/2026

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

describe("reduceItems: o marco do corte (ADR-180)", () => {
  it("leva a causa que o evento trouxe", () => {
    const out = reduceItems(base(), { type: "cancelled", cause: "parada" }, undefined, T0)
    expect(out.items?.at(-1)).toMatchObject({ kind: "cancelled", cause: "parada", ts: T0 })
  })

  it("a ação em voo fica 'parou', não 'erro'", () => {
    const emVoo: ChatItem = {
      kind: "tool",
      id: "p1",
      name: "process_poll",
      input: {},
      ts: T0 - 31_849,
    }
    const out = reduceItems(
      base([{ kind: "user", id: "u1", text: "confere os funis" }, emVoo]),
      { type: "cancelled" },
      undefined,
      T0,
    )
    expect(out.items?.[1]).toMatchObject({ result: { ok: false, interrupted: true } })
  })
})

describe("handleEvent: o gesto dá a causa, o evento dá o fato", () => {
  beforeEach(() => {
    limparCausasDoCorte()
    useChat.setState({
      activeId: "c1",
      byId: {
        c1: {
          id: "c1",
          title: "[feat] cliente coleta",
          projectId: "seed-prime",
          agent: "codex",
          reqModel: null,
          model: "gpt-5.6-sol",
          sessionMode: null,
          items: [{ kind: "user", id: "u1", text: "confere os funis", ts: T0 - 321_193 }],
          createdAt: T0 - 400_000,
          updatedAt: T0 - 1_000,
          status: "idle",
          running: true,
          finalizing: false,
          runId: "run-real",
        } as any,
      },
    })
  })

  it("o cancelled do runner consome a causa que o gesto carimbou", () => {
    marcarCausaDoCorte("c1", "correcao")
    useChat.getState().handleEvent("c1", { type: "cancelled" })
    expect(useChat.getState().byId.c1.items.at(-1)).toMatchObject({
      kind: "cancelled",
      cause: "correcao",
    })
    expect(tomarCausaDoCorte("c1")).toBeUndefined()
  })

  it("sem gesto carimbado o marco fica sem autor", () => {
    useChat.getState().handleEvent("c1", { type: "cancelled" })
    const marco = useChat.getState().byId.c1.items.at(-1)!
    expect(marco.kind).toBe("cancelled")
    expect("cause" in marco).toBe(false)
  })

  it("a causa que já vem no evento (disputa) não é trocada pelo carimbo", () => {
    marcarCausaDoCorte("c1", "correcao")
    useChat.getState().handleEvent("c1", { type: "cancelled", cause: "disputa" })
    expect(useChat.getState().byId.c1.items.at(-1)).toMatchObject({ cause: "disputa" })
  })
})
