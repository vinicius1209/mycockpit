// Onda 1 da paridade Claude Code: o texto do assistant NÃO fragmenta mais.
// Antes, deltas de blocos diferentes colavam na mesma bolha e o `text`
// consolidado criava uma 2ª bolha duplicada no meio da frase. Agora o
// `text_stop` fecha cada bloco, e o adapter do agente PRINCIPAL nem emite o
// `text` consolidado (deltas são a verdade). Aqui exercito o reducer.
import { describe, expect, it } from "vitest"
import { reduceItems, type ChatItem, type ItemReducible } from "@/store/chat"
import type { AgentEvent } from "@/lib/agent"

function base(): ItemReducible {
  return {
    items: [],
    streamingTextId: null,
    model: null,
    sessionId: null,
    startedAt: null,
    contextTokens: undefined,
  }
}

function apply(c: ItemReducible, e: AgentEvent): ItemReducible {
  return { ...c, ...reduceItems(c, e) }
}

const delta = (text: string): AgentEvent => ({ type: "text_delta", text })
const stop = (): AgentEvent => ({ type: "text_stop" }) as AgentEvent
const texts = (c: ItemReducible) =>
  c.items.filter((i): i is Extract<ChatItem, { kind: "text" }> => i.kind === "text").map((i) => i.text)

describe("streaming de texto — sem fragmentação (onda 1)", () => {
  it("dois blocos (delta, stop, delta, stop) viram DUAS bolhas limpas, sem colar", () => {
    let c = base()
    c = apply(c, delta("Vou ler o pricing (agravo"))
    c = apply(c, delta(", desconto)."))
    c = apply(c, stop()) // fecha o bloco 0
    c = apply(c, delta("Agora o resumo."))
    c = apply(c, stop()) // fecha o bloco 1
    expect(texts(c)).toEqual(["Vou ler o pricing (agravo, desconto).", "Agora o resumo."])
  })

  it("text_stop sem bolha aberta é no-op (não cria lixo)", () => {
    const out = reduceItems(base(), stop())
    expect(out).toEqual({})
  })

  it("delta após stop começa bolha NOVA (não cola no bloco anterior no meio da palavra)", () => {
    let c = base()
    c = apply(c, delta("...feature (agrav"))
    c = apply(c, stop())
    c = apply(c, delta("o, limites)."))
    // duas bolhas — a 2ª NÃO é 'o, limites)' colado em 'agrav' na mesma bolha
    expect(texts(c)).toEqual(["...feature (agrav", "o, limites)."])
  })

  it("um `text` consolidado (fallback de agent sem deltas: agy/codex) ainda cria bolha", () => {
    // agy/codex emitem `text` cheio (sem deltas) — o caminho de fallback segue.
    const out = reduceItems(base(), { type: "text", text: "resposta inteira" } as AgentEvent)
    expect(out.items?.length).toBe(1)
  })
})
