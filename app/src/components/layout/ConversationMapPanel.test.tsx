// A aba Conversa como histórico de pedidos (mock aba-conversa.html rev. 2,
// aprovado em 23/09/2026). Seguem valendo do desenho anterior: o texto do
// pedido é selecionável e nunca mora dentro de um botão, e há Copiar e Ver no
// fio. Saem, por decisão: o "Pedido que abriu a conversa" fixo, o "Ajustar
// leitura" e, no ADR-233, o resumo automático inteiro.
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { ChatItem } from "@/store/chat"

vi.mock("@/store/interactions", () => ({
  useInteractions: (selector: (s: unknown) => unknown) => selector({ queue: [] }),
  currentOriginAnyKind: () => null,
}))
vi.mock("@/store/app", () => ({
  useApp: Object.assign(
    (selector: (s: unknown) => unknown) => selector({}),
    { getState: () => ({ revealTranscriptItem: vi.fn() }) },
  ),
}))

import { ConversationMapPanel, comRelogio } from "./ConversationMapPanel"
import { historicoDePedidos } from "@/lib/conversationMap/historico"

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
      title="t"
      items={items}
      running={false}
      finalizing={false}
    />,
  )
}

describe("ConversationMapPanel", () => {
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

  it("não há mais resumo automático em cima do histórico", () => {
    const html = render()
    expect(html).not.toContain("Resumo")
    expect(html).not.toContain("Tentar de novo")
  })

  it("conversa sem pedido explica o que vai aparecer", () => {
    const html = render([])
    expect(html).toContain("A conversa ainda não começou.")
    expect(html).toContain("É o histórico desta conversa.")
  })

  it("o tique do relógio só anda a duração do pedido rodando", () => {
    const itens: ChatItem[] = [...PEDIDOS, { kind: "user", id: "u3", text: "agora", ts: 100_000 }]
    const h = historicoDePedidos(itens, { running: true, finalizing: false }, 100_000)
    const depois = comRelogio(h, 160_000)
    expect(depois.pedidos[0]).toMatchObject({ estado: "rodando", duracaoMs: 60_000 })
    // Os encerrados são o MESMO objeto: nada foi refeito.
    expect(depois.pedidos[1]).toBe(h.pedidos[1])
    expect(comRelogio(historicoDePedidos(PEDIDOS, { running: false, finalizing: false }), 1)).toBeTruthy()
  })

  // Contraste (mock aba-conversa-contraste.html, 24/09/2026): antes era tudo
  // 11-12px, cinza e mono, e o plano aparecia duas vezes.
  it("o cabeçalho é de métricas: número com peso, rótulo em cinza, frase inteira no aria-label", () => {
    const html = render()
    expect(html).toContain('aria-label="2 pedidos · 1min 22s"')
    expect(html).toMatch(/font-medium tabular-nums text-foreground">1min 22s<\/div><div class="text-\[11px\] text-muted-foreground">de trabalho/)
  })

  it("o mais novo vira o cartão do 'Último pedido' e o resto fica sob 'Antes'", () => {
    const html = render()
    expect(html.indexOf("Último pedido")).toBeLessThan(html.indexOf("resolva os problemas"))
    expect(html.indexOf("Antes")).toBeLessThan(html.indexOf("compara as imagens"))
    expect(html.indexOf("resolva os problemas")).toBeLessThan(html.indexOf("Antes"))
    // custo com peso; os fatos saíram do mono
    expect(html).toContain('<span class="font-medium text-foreground/80">US$ 0,840</span>')
    expect(html).not.toContain("font-mono")
  })

  it("com o pedido rodando, o cartão é o 'Agora', na cor do vivo (a aba é chrome)", () => {
    const html = renderToStaticMarkup(
      <ConversationMapPanel
        conversationId="conv-1"
        title="t"
        items={[...PEDIDOS, { kind: "user", id: "u3", text: "abre as abas", ts: 95_000 }]}
        running
        finalizing={false}
      />,
    )
    expect(html).toContain(">Agora<")
    expect(html).toContain("text-st-running")
    expect(html).toContain("Rodando")
  })
})
