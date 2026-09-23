// A aba Conversa como histórico de pedidos (mock aba-conversa.html rev. 2,
// aprovado em 23/09/2026). Seguem valendo do desenho anterior: o texto do
// pedido é selecionável e nunca mora dentro de um botão, e há Copiar e Ver no
// fio. Saem, por decisão: o "Pedido que abriu a conversa" fixo e o "Ajustar
// leitura".
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { ChatItem } from "@/store/chat"

const mapa = vi.hoisted(() => ({ entry: undefined as unknown }))
const ajustes = vi.hoisted(() => ({
  utilityInference: { automaticConversationMaps: true, conversationMapsOff: [] as string[] },
}))

vi.mock("@/store/conversationMaps", () => ({
  useConversationMaps: (selector: (s: unknown) => unknown) =>
    selector({
      byConversation: mapa.entry ? { "conv-1": mapa.entry } : {},
      hydrate: vi.fn(),
      refreshNow: vi.fn(),
    }),
}))
vi.mock("@/store/interactions", () => ({
  useInteractions: (selector: (s: unknown) => unknown) => selector({ queue: [] }),
  currentOriginAnyKind: () => null,
}))
vi.mock("@/store/app", () => ({
  useApp: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ settings: ajustes }),
    { getState: () => ({ revealTranscriptItem: vi.fn(), setSettings: vi.fn() }) },
  ),
}))

import { ConversationMapPanel } from "./ConversationMapPanel"

const PEDIDOS: ChatItem[] = [
  { kind: "user", id: "u1", text: "compara as imagens do VsCode e da nossa aplicação", ts: 1_000 },
  { kind: "tool", id: "t1", name: "Read", input: { file_path: "/p/a.ts" }, ts: 2_000 },
  { kind: "result", id: "r1", ok: true, costUsd: 0.84, costSource: "reported", ts: 53_000 },
  { kind: "user", id: "u2", text: "resolva os problemas", ts: 60_000 },
  { kind: "tool", id: "t2", name: "Edit", input: { file_path: "/p/b.ts" }, ts: 61_000 },
  { kind: "cancelled", id: "c2", ts: 90_000 },
]

function render(items: ChatItem[] = PEDIDOS) {
  return renderToStaticMarkup(
    <ConversationMapPanel
      conversationId="conv-1"
      projectId="proj-1"
      title="t"
      items={items}
      running={false}
      finalizing={false}
    />,
  )
}

describe("ConversationMapPanel", () => {
  beforeEach(() => {
    mapa.entry = undefined
    ajustes.utilityInference.conversationMapsOff = []
  })

  it("é o histórico de pedidos, do mais novo para o mais velho, com os fatos", () => {
    const html = render()
    expect(html.indexOf("resolva os problemas")).toBeLessThan(html.indexOf("compara as imagens"))
    expect(html).toContain("2 pedidos")
    expect(html).toContain("interrompido")
    expect(html).toContain("US$ 0,840")
    expect(html).toContain("1 arquivo")
    expect(html).not.toContain("Pedido que abriu a conversa")
    expect(html).not.toContain("Ajustar leitura")
    expect(html).not.toContain("leitura indisponível")
  })

  it("o texto do pedido é selecionável, fora de botão, com Copiar e Ver no fio", () => {
    const html = render()
    expect(html).toContain("data-selectable")
    const i = html.indexOf("resolva os problemas")
    expect(html.slice(Math.max(0, i - 60), i)).not.toContain("<button")
    expect(html).toContain("Copiar")
    expect(html).toContain("Ver no fio")
  })

  it("resumo que falhou diz o motivo onde promete, com tentar de novo e desligar", () => {
    mapa.entry = { semanticStatus: "unavailable", lastIssue: "input_too_large", stored: null, pins: null, staleSettledTurns: 0 }
    const html = render()
    expect(html).toContain("Resumo automático indisponível nesta conversa.")
    expect(html).toContain("maior do que o modelo local lê de uma vez")
    expect(html).toContain("Tentar de novo")
    expect(html).toContain("Desligar nesta conversa")
    // O histórico continua lá, independente do resumo.
    expect(html).toContain("resolva os problemas")
  })

  it("resumo desligado nesta conversa vira uma linha com o caminho de volta", () => {
    ajustes.utilityInference.conversationMapsOff = ["conv-1"]
    const html = render()
    expect(html).toContain("Resumo desligado nesta conversa")
    expect(html).toContain("Ligar")
    expect(html).not.toContain("Tentar de novo")
  })

  it("conversa sem pedido explica o que vai aparecer", () => {
    const html = render([])
    expect(html).toContain("A conversa ainda não começou.")
    expect(html).toContain("É o histórico desta conversa.")
  })
})
