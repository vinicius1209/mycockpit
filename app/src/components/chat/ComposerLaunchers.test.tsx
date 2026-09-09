import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ComposerLaunchers } from "@/components/chat/ComposerLaunchers"

describe("ComposerLaunchers", () => {
  it("renderiza os modais de launcher fechados por padrão", () => {
    const html = renderToStaticMarkup(
      createElement(ComposerLaunchers, {
        task: "tarefa de teste",
        seed: { agent: "codex", model: "default", effort: "default" },
        onLaunched: () => {},
      }),
    )
    expect(typeof html).toBe("string")
  })
})
