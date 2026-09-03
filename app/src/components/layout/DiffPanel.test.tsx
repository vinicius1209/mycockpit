import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { DiffPanel } from "./DiffPanel"
import type { GitDiff } from "@/lib/git"

vi.mock("@/lib/git", () => ({
  loadGitDiff: vi.fn(async (): Promise<GitDiff> => ({
    isRepo: true,
    branch: "main",
    files: [
      {
        path: "src/main.rs",
        oldPath: null,
        status: "modified",
        binary: false,
        cortado: null,
        additions: 10,
        deletions: 2,
        hunks: [
          {
            header: "@@ -1,5 +1,13 @@",
            lines: [
              { type: "ctx", oldNo: 1, newNo: 1, text: "fn main() {" },
              { type: "add", oldNo: null, newNo: 2, text: '    println!("teste");' },
              { type: "ctx", oldNo: 2, newNo: 3, text: "}" },
            ],
          },
        ],
      },
    ],
  })),
}))

vi.mock("@/components/common/OpenInEditor", () => ({
  OpenInEditor: () => createElement("div", { "data-testid": "open-in-editor" }),
}))

describe("DiffPanel", () => {
  it("renderiza o painel inicial em estado de carregamento ou com o arquivo mockado", () => {
    const html = renderToStaticMarkup(
      createElement(DiffPanel, {
        cwd: "/fake/repo",
        onSendToComposer: vi.fn(),
      }),
    )
    expect(html).toBeDefined()
  })
})
