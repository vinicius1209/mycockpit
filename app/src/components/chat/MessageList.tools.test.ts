import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { MessageList } from "./MessageList"
import type { ChatItem } from "@/store/chat"

const RAW_SQL =
  '/bin/zsh -lc "sqlite3 -readonly /Users/vini/app.db \\"SELECT count(*) FROM cards;\\""'

function render(items: ChatItem[], running = false): string {
  return renderToStaticMarkup(
    createElement(MessageList, {
      items,
      running,
      finalizing: false,
      startedAt: null,
      agent: "codex",
    }),
  )
}

function tool(id: string, command: string, result = true): ChatItem {
  return {
    kind: "tool",
    id,
    name: "Bash",
    input: { command },
    ...(result ? { result: { ok: true, text: "", lines: 0 } } : {}),
  }
}

describe("MessageList · tool activity", () => {
  it("burst concluído vira caption sem comando bruto", () => {
    const html = render([
      tool("1", RAW_SQL),
      tool("2", "sqlite3 -readonly app.db 'select count(*) from conversations'"),
      tool("3", "nl -ba PLAN.md | sed -n '1,80p'"),
      tool("4", 'for p in app docs; do find "$p" -maxdepth 1 -type f; done'),
    ])
    expect(html).toContain("4 verificações concluídas")
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain("/bin/zsh")
    expect(html).not.toContain("SELECT count")
    expect(html).not.toContain("/Users/vini")
  })

  it("histórico antigo sem result fica registrado, não pendente", () => {
    const html = render([
      tool("1", RAW_SQL, false),
      tool("2", "git status --short", false),
    ])
    expect(html).toContain("2 verificações registradas")
    expect(html).not.toContain("pendente")
    expect(html).not.toContain("/bin/zsh")
  })

  it("grupo corrente mostra ações sem abrir detalhes técnicos", () => {
    const html = render(
      [
        tool("1", "rg ToolGroup app/src"),
        tool("2", RAW_SQL, false),
      ],
      true,
    )
    expect(html).toContain("Consultar dados locais")
    expect(html).toContain("Buscar no projeto")
    expect(html).toContain('aria-expanded="true"')
    expect(html).not.toContain("/bin/zsh")
    expect(html).not.toContain("SELECT count")
  })

  it("intervalo entre ferramentas não reabre as ações já concluídas", () => {
    const html = render(
      [
        tool("1", "rg ToolGroup app/src"),
        tool("2", "git status --short"),
        tool("3", "git diff --check"),
      ],
      true,
    )
    expect(html).toContain("3 verificações concluídas")
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain("Buscar no projeto")
    expect(html).not.toContain("Verificar o estado do repositório")
  })
})
