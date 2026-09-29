import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Markdown } from "./Markdown"
import { fonteMermaid } from "./fonteMermaid"

describe("bloco mermaid no Markdown", () => {
  const texto = "Fluxo:\n\n```mermaid\nflowchart LR\n  A[Composer] --> B[handleSend]\n```\n"

  it("vira o bloco do diagrama, que nasce mostrando o código (nunca quebra)", () => {
    const html = renderToStaticMarkup(<Markdown text={texto} />)
    expect(html).toContain("data-mermaid")
    expect(html).toContain("A[Composer] --&gt; B[handleSend]")
    expect(html).toContain("Copiar fonte")
    // Sem o realce de código partindo a fonte em spans hljs.
    expect(html).not.toContain("hljs")
  })

  it("outro bloco de código continua bloco de código", () => {
    const html = renderToStaticMarkup(<Markdown text={"```ts\nconst a = 1\n```"} />)
    expect(html).not.toContain("data-mermaid")
    expect(html).toContain("hljs")
  })

  it("lê a fonte do hast mesmo partida em pedaços", () => {
    const pre = {
      type: "element",
      tagName: "pre",
      children: [
        {
          type: "element",
          tagName: "code",
          properties: { className: ["hljs", "language-mermaid"] },
          children: [{ type: "text", value: "flowchart LR\n" }, { type: "element", children: [{ type: "text", value: "  A --> B" }] }],
        },
      ],
    }
    expect(fonteMermaid(pre)).toBe("flowchart LR\n  A --> B")
    expect(fonteMermaid({ type: "element", children: [] })).toBeNull()
  })
})
