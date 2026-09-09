import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { ConversationMapSourceDialog } from "./ConversationMapSourceDialog"
import type { ChatItem } from "@/store/chat"

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div data-dialog>{children}</div> : null,
  DialogContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-dialog-content className={className}>
      {children}
    </div>
  ),
  DialogHeader: ({ children, className }: { children: ReactNode; className?: string }) => (
    <header className={className}>{children}</header>
  ),
  DialogTitle: ({ children, className }: { children: ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
  DialogDescription: ({ children, className }: { children: ReactNode; className?: string }) => (
    <p className={className}>{children}</p>
  ),
}))

describe("ConversationMapSourceDialog", () => {
  const item: ChatItem = {
    id: "msg-1",
    kind: "user",
    text: "Prompt de abertura para auditar o painel lateral",
    ts: 1725700000000,
  }

  const source = {
    id: "pedido-inicial",
    text: item.text,
    certainty: "explicit" as const,
    evidence: [
      {
        itemId: item.id,
        role: "user" as const,
        channel: "executor" as const,
      },
    ],
  }

  it("renderiza o texto com data-selectable e select-text para seleção nativa", () => {
    const html = renderToStaticMarkup(
      <ConversationMapSourceDialog
        source={source}
        items={[item]}
        onClose={() => {}}
        onReveal={() => {}}
      />,
    )

    expect(html).toContain("data-selectable")
    expect(html).toContain("select-text")
    expect(html).toContain("whitespace-pre-wrap")
    expect(html).toContain("break-words")
    expect(html).toContain("Prompt de abertura para auditar o painel lateral")
  })

  it("não aplica truncamento artificial com line-clamp-5", () => {
    const html = renderToStaticMarkup(
      <ConversationMapSourceDialog
        source={source}
        items={[item]}
        onClose={() => {}}
        onReveal={() => {}}
      />,
    )

    expect(html).not.toContain("line-clamp-5")
  })

  it("renderiza os botões de ação Copiar e Ver no fio", () => {
    const html = renderToStaticMarkup(
      <ConversationMapSourceDialog
        source={source}
        items={[item]}
        onClose={() => {}}
        onReveal={() => {}}
      />,
    )

    expect(html).toContain("Copiar")
    expect(html).toContain("Ver no fio")
  })
})
