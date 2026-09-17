// O recibo do turno (ADR-199): legenda discreta, régua de ações à vista só no
// turno mais recente, e o envelope de bastidor do meio do pedido não vira
// "concluído · US$ 0,000" no topo da resposta.

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TurnReceipt, reciboSemConteudo } from "./TurnReceipt"
import type { FeedbackApi } from "./TurnActions"
import type { ChatItem } from "@/store/chat"

type Result = Extract<ChatItem, { kind: "result" }>

const API: FeedbackApi = {
  onReact: async () => true,
  distill: async () => ({ rule: "", learnable: null }),
  save: async () => ({ kind: "saved" }) as never,
}

// Campos do item real que aparecia vazio no topo (conversa b456fcd4, 16/09/2026).
const BASTIDOR: Result = {
  kind: "result",
  id: "f7d48b80",
  ok: true,
  text: "",
  costUsd: 0,
  costSource: "reported",
  model: "claude-opus-5[1m]",
  usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  durationMs: 6819,
  ts: 1789576574325,
} as Result

const ENTREGA: Result = {
  kind: "result",
  id: "b912a7b3",
  ok: true,
  text: "O item 4 vem da mensagem do Allan",
  costUsd: 5.09,
  costSource: "reported",
  model: "claude-opus-5[1m]",
  usage: { input: 10, output: 2100, cacheRead: 300_000, cacheCreation: 419_000 },
  durationMs: 49_000,
  ts: 1789576600000,
} as Result

function render(it: Result, opts: { final: boolean; lastTurn: boolean }) {
  return renderToStaticMarkup(
    createElement(TurnReceipt, { it, feedback: API, feedbackText: it.text, ...opts }),
  )
}

describe("TurnReceipt", () => {
  it("envelope de bastidor no meio do pedido não vira recibo", () => {
    expect(reciboSemConteudo(BASTIDOR)).toBe(true)
    expect(render(BASTIDOR, { final: false, lastTurn: false })).toBe("")
  })

  it("parcial com custo real continua aparecendo (é gasto de verdade)", () => {
    expect(reciboSemConteudo({ ...BASTIDOR, costUsd: 0.4 })).toBe(false)
    expect(render({ ...BASTIDOR, costUsd: 0.4 }, { final: false, lastTurn: false })).not.toBe("")
  })

  it("erro nunca é filtrado como bastidor", () => {
    expect(reciboSemConteudo({ ...BASTIDOR, ok: false })).toBe(false)
  })

  it("linha limpa: sem borda, sem tokens e sem 'reconstruído' visíveis; quebra no tooltip do custo", () => {
    const html = render(ENTREGA, { final: true, lastTurn: true })
    expect(html).not.toContain("border-border/40")
    expect(html).not.toContain("reconstruído")
    expect(html).not.toMatch(/>\s*10\s*↓/)
    expect(html).toContain("US$")
    expect(html).toContain("Contexto reenviado:")
    expect(html).toContain('class="sr-only">concluído<')
  })

  it("último turno: régua à vista e com o diff", () => {
    const html = render(ENTREGA, { final: true, lastTurn: true })
    expect(html).toContain('data-reveal="sempre"')
    expect(html).toContain("Ver o diff desta entrega")
  })

  it("turno antigo: régua sob hover ou foco, sem o diff que mentiria sobre a entrega", () => {
    const html = render(ENTREGA, { final: true, lastTurn: false })
    expect(html).toContain('data-reveal="hover"')
    expect(html).toContain("group-hover/turno:opacity-100")
    expect(html).toContain("group-focus-within/turno:opacity-100")
    expect(html).toContain("[@media(hover:none)]:opacity-100")
    expect(html).not.toContain("Ver o diff desta entrega")
  })

  it("turno antigo com reação dada mantém a régua à vista", () => {
    const html = render({ ...ENTREGA, reactions: ["👍"] } as Result, { final: true, lastTurn: false })
    expect(html).toContain('data-reveal="sempre"')
  })
})
