import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { ConversationMapPanel } from "./ConversationMapPanel"
import type { ChatItem } from "@/store/chat"

vi.mock("@/store/conversationMaps", () => ({
  useConversationMaps: (selector: any) =>
    selector({
      byConversation: {},
      hydrate: vi.fn(),
      scheduleRefresh: vi.fn(),
      refreshNow: vi.fn(),
      replacePins: vi.fn(),
    }),
}))

vi.mock("@/store/interactions", () => ({
  useInteractions: (selector: any) => selector({ queue: [] }),
  currentOriginAnyKind: () => null,
}))

vi.mock("@/store/app", () => ({
  useApp: {
    getState: () => ({
      revealTranscriptItem: vi.fn(),
    }),
  },
}))

describe("ConversationMapPanel", () => {
  const item: ChatItem = {
    id: "msg-1",
    kind: "user",
    text: "Meu primeiro pedido para abrir a conversa",
    ts: 1725700000000,
  }

  it("renderiza o pedido que abriu a conversa com data-selectable e botões de ação", () => {
    const html = renderToStaticMarkup(
      <ConversationMapPanel
        conversationId="conv-1"
        projectId="proj-1"
        title="Título da conversa"
        items={[item]}
        running={false}
        finalizing={false}
      />,
    )

    expect(html).toContain("Pedido que abriu a conversa")
    expect(html).toContain("data-selectable")
    expect(html).toContain("select-text")
    expect(html).toContain("Meu primeiro pedido para abrir a conversa")
    expect(html).toContain("Copiar")
    expect(html).toContain("Fontes")
    expect(html).toContain("Ver no fio")

    // O texto não pode estar envelopado em um button
    const subjectIndex = html.indexOf("Meu primeiro pedido para abrir a conversa")
    const precedingHtml = html.slice(Math.max(0, subjectIndex - 60), subjectIndex)
    expect(precedingHtml).not.toContain("<button")
  })

  it("renderiza o cabeçalho com @container, title no status e botões responsivos", () => {
    const html = renderToStaticMarkup(
      <ConversationMapPanel
        conversationId="conv-1"
        projectId="proj-1"
        title="Título da conversa"
        items={[item]}
        running={false}
        finalizing={false}
      />,
    )

    expect(html).toContain("@container")
    expect(html).toContain("title=")
    expect(html).toContain("@min-[340px]:inline")
    expect(html).toContain('aria-label="Ajustar leitura"')
  })
})
