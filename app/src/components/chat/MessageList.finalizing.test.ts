import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { MessageList } from "./MessageList"
import type { ChatItem } from "@/store/chat"

const items: ChatItem[] = [
  { kind: "user", id: "u1", text: "Conclua a análise" },
  { kind: "text", id: "t1", text: "Análise concluída." },
  { kind: "result", id: "r1", ok: true, costUsd: 0.25, durationMs: 3_000 },
]

function render(finalizing: boolean): string {
  return renderToStaticMarkup(
    createElement(MessageList, {
      items,
      running: false,
      finalizing,
      startedAt: null,
      agent: "codex",
    }),
  )
}

describe("MessageList · ordem do fechamento do turno", () => {
  it("mostra Finalizando antes de publicar o recibo", () => {
    const html = render(true)
    expect(html).toContain("finalizando…")
    expect(html).not.toContain("US$ 0,250")
  })

  it("troca Finalizando pelo recibo somente depois de done", () => {
    const html = render(false)
    expect(html).not.toContain("finalizando…")
    expect(html).toContain("US$ 0,250")
  })
})
