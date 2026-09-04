import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { GitSection, GitFileList, GitFileRow } from "./GitSection"
import type { GitFileItem } from "@/lib/git"

vi.mock("@/components/common/OpenInEditor", () => ({
  OpenInEditor: () => createElement("div", { "data-testid": "open-in-editor" }),
}))

describe("GitSection", () => {
  const fileStaged: GitFileItem = {
    path: "src/staged.ts",
    oldPath: null,
    status: "modified",
    staged: true,
    additions: 10,
    deletions: 2,
  }

  const fileUnstaged: GitFileItem = {
    path: "src/new.ts",
    oldPath: null,
    status: "untracked",
    staged: false,
    additions: 20,
    deletions: 0,
  }

  it("renderiza cabeçalho de seção com título e contagem", () => {
    const html = renderToStaticMarkup(
      createElement(
        GitSection,
        {
          title: "Staged Changes",
          count: 3,
          isOpen: true,
          onToggle: vi.fn(),
        },
        createElement("div", null, "conteúdo"),
      ),
    )
    expect(html).toContain("Staged Changes")
    expect(html).toContain("3")
    expect(html).toContain("conteúdo")
  })

  it("renderiza arquivo staged com botão de unstage", () => {
    const html = renderToStaticMarkup(
      createElement(GitFileRow, {
        cwd: "/fake",
        file: fileStaged,
        onOpenFile: vi.fn(),
        onReload: vi.fn(),
      }),
    )
    expect(html).toContain("staged.ts")
    expect(html).toContain("+10")
    expect(html).toContain("−2")
    expect(html).toContain('aria-label="Desfazer preparação de src/staged.ts"')
  })

  it("renderiza arquivo unstaged com botões de stage e discard", () => {
    const html = renderToStaticMarkup(
      createElement(GitFileRow, {
        cwd: "/fake",
        file: fileUnstaged,
        onOpenFile: vi.fn(),
        onReload: vi.fn(),
      }),
    )
    expect(html).toContain("new.ts")
    expect(html).toContain("+20")
    expect(html).toContain('aria-label="Preparar src/new.ts para commit"')
    expect(html).toContain('aria-label="Descartar src/new.ts"')
  })

  it("renderiza lista em árvore", () => {
    const html = renderToStaticMarkup(
      createElement(GitFileList, {
        cwd: "/fake",
        files: [fileStaged, fileUnstaged],
        viewMode: "tree",
        onOpenFile: vi.fn(),
        onReload: vi.fn(),
      }),
    )
    expect(html).toContain("src")
    expect(html).toContain("staged.ts")
    expect(html).toContain("new.ts")
  })
})
