// Fixture: o fio REAL de `src/test/fio-real.json` (a mesma do fio.fluidez). A
// regra decide por identidade e por tipo de item, então prosa inventada não
// serviria: é o formato real dos itens que precisa passar (ADR-016).
import { describe, expect, it } from "vitest"
import type { AgentEvent } from "@/lib/agent"
import { emptyConv, useChat, type ChatItem, type ConvState } from "@/store/chat"
import { mesmaConversaParaOComposer } from "./convDoComposer"

const fioReal = JSON.parse(
  Object.values(
    import.meta.glob("../../test/fio-real.json", { query: "?raw", import: "default", eager: true }),
  )[0] as string,
) as ChatItem[]

function conversa(items: ChatItem[], extra: Partial<ConvState> = {}): ConvState {
  return { ...emptyConv("p"), agent: "claude-code", running: true, items, ...extra }
}

const ultimoTexto = fioReal.map((it, i) => [it, i] as const).filter(([it]) => it.kind === "text").at(-1)!
const ultimaFerramenta = fioReal.map((it, i) => [it, i] as const).filter(([it]) => it.kind === "tool").at(-1)!

function comTroca(indice: number, novo: ChatItem): ChatItem[] {
  const items = fioReal.slice()
  items[indice] = novo
  return items
}

describe("a conversa que o composer enxerga", () => {
  const base = conversa(fioReal, { streamingTextId: ultimoTexto[0].id })

  it("delta de texto na bolha em streaming não é mudança para o composer", () => {
    const [it, i] = ultimoTexto
    if (it.kind !== "text") throw new Error("fixture")
    const depois = { ...base, items: comTroca(i, { ...it, text: it.text + " mais um token" }) }
    expect(mesmaConversaParaOComposer(base, depois)).toBe(true)
  })

  it("item novo no fio é mudança (turno, histórico e anexos dependem disso)", () => {
    const novo: ChatItem = { kind: "text", id: "novo", text: "oi", ts: 1 }
    expect(mesmaConversaParaOComposer(base, { ...base, items: [...fioReal, novo] })).toBe(false)
  })

  it("ferramenta ou diferido mudando no lugar é mudança (aviso de Parar lê isso)", () => {
    const [it, i] = ultimaFerramenta
    const depois = { ...base, items: comTroca(i, { ...it, activityAt: 42 } as ChatItem) }
    expect(mesmaConversaParaOComposer(base, depois)).toBe(false)
  })

  it("texto mudando junto com outro campo do item é mudança", () => {
    const [it, i] = ultimoTexto
    if (it.kind !== "text") throw new Error("fixture")
    const depois = { ...base, items: comTroca(i, { ...it, text: it.text + "x", ts: 999 }) }
    expect(mesmaConversaParaOComposer(base, depois)).toBe(false)
  })

  it("duas bolhas de texto mudando ao mesmo tempo é mudança", () => {
    const textos = fioReal.map((it, i) => [it, i] as const).filter(([it]) => it.kind === "text").slice(-2)
    const items = fioReal.slice()
    for (const [it, i] of textos) if (it.kind === "text") items[i] = { ...it, text: it.text + "x" }
    expect(mesmaConversaParaOComposer(base, { ...base, items })).toBe(false)
  })

  it("campo da conversa fora do fio é mudança", () => {
    expect(mesmaConversaParaOComposer(base, { ...base, running: false })).toBe(false)
    expect(mesmaConversaParaOComposer(base, { ...base, queued: [] })).toBe(false)
    expect(mesmaConversaParaOComposer(base, { ...base, streamingTextId: null })).toBe(false)
  })
})

describe("com o reducer de verdade", () => {
  it("delta de texto pelo handleEvent não troca a conversa do composer, e o fim do turno troca", () => {
    const id = "conv-composer"
    const [user] = fioReal.filter((it) => it.kind === "user")
    useChat.setState((s) => ({
      activeId: id,
      byId: { ...s.byId, [id]: conversa([user], { runId: "run-1" }) },
    }))
    const evento = (e: AgentEvent) => useChat.getState().handleEvent(id, e)
    evento({ type: "text_delta", text: "Pronto: o " } as AgentEvent)
    const antes = useChat.getState().byId[id]
    evento({ type: "text_delta", text: "fio inteiro" } as AgentEvent)
    const depois = useChat.getState().byId[id]
    // o evento troca o objeto (texto e telemetria do processo), mas não o que o composer usa
    expect(depois).not.toBe(antes)
    expect(mesmaConversaParaOComposer(antes, depois)).toBe(true)
    evento({ type: "text_stop" } as AgentEvent)
    const fechado = useChat.getState().byId[id]
    expect(mesmaConversaParaOComposer(depois, fechado)).toBe(false)
  })
})
