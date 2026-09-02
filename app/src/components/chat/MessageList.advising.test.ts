import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"
import { MessageList } from "./MessageList"
import { usePresets } from "@/store/presets"
import type { AgentDef } from "@/lib/agentDefs"
import type { ChatItem } from "@/store/chat"

function persona(id: string, name: string): AgentDef {
  return {
    id,
    name,
    personalityMd: "",
    skills: [],
    policy: null,
    backend: "claude-code",
    model: null,
    effort: null,
    category: "Geral",
    rubric: [],
    avatarStyle: "thumbs",
    avatarSeed: id,
    digest: "d",
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    scope: "projeto",
    slug: id,
    path: `/tmp/${id}.md`,
  }
}

function render(
  advising: { id: string; name: string } | null,
  items: ChatItem[] = [],
  running = false,
): string {
  return renderToStaticMarkup(
    createElement(MessageList, {
      items,
      running,
      finalizing: false,
      startedAt: null,
      agent: "claude-code",
      advising,
    }),
  )
}

afterEach(() => {
  usePresets.setState({ list: [] })
})

describe("MessageList · linha de chegada do conselheiro (advising)", () => {
  const user: ChatItem = { kind: "user", id: "u1", text: "e aí, Aline?" }

  it("mostra a persona lendo o contexto quando advising está setado", () => {
    usePresets.setState({ list: [persona("aline", "Aline")] })
    const html = render({ id: "aline", name: "Aline" }, [user])
    expect(html).toContain("Aline")
    expect(html).toContain("está lendo o contexto")
  })

  it("não mostra a linha de chegada quando advising é null", () => {
    usePresets.setState({ list: [persona("aline", "Aline")] })
    const html = render(null, [user])
    expect(html).not.toContain("está lendo o contexto")
  })

  it("fail-soft: sem a persona na lista, ainda mostra o nome do advising", () => {
    usePresets.setState({ list: [] })
    const html = render({ id: "sumida", name: "Aline" }, [user])
    expect(html).toContain("Aline")
    expect(html).toContain("está lendo o contexto")
  })

  it("mantém o trabalho do executor no fim do fio enquanto o conselheiro chega", () => {
    const action: Extract<ChatItem, { kind: "tool" }> = {
      kind: "tool",
      id: "tool-item",
      name: "Bash",
      input: { command: "bun run test" },
      toolId: "tool-1",
    }
    const html = render({ id: "aline", name: "Aline" }, [user, action], true)

    expect(html.indexOf("está lendo o contexto")).toBeLessThan(
      html.indexOf("está trabalhando…"),
    )
  })
})
