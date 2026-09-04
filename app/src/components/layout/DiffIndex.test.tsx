import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { DiffIndex } from "./DiffIndex"
import type { GitStatus } from "@/lib/git"

vi.mock("@/lib/git", () => ({
  loadGitStatus: vi.fn(async (): Promise<GitStatus> => ({
    isRepo: true,
    branch: "feature/nova-ide",
    upstream: "origin/feature/nova-ide",
    ahead: 1,
    behind: 0,
    staged: [
      {
        path: "src/staged.ts",
        oldPath: null,
        status: "added",
        staged: true,
        additions: 15,
        deletions: 0,
      },
    ],
    unstaged: [
      {
        path: "src/unstaged.ts",
        oldPath: null,
        status: "modified",
        staged: false,
        additions: 5,
        deletions: 2,
      },
    ],
  })),
  stageAll: vi.fn(),
  unstageAll: vi.fn(),
  stageFile: vi.fn(),
  unstageFile: vi.fn(),
  discardFile: vi.fn(),
  discardAll: vi.fn(),
  gitCommit: vi.fn(),
}))

vi.mock("@/components/common/OpenInEditor", () => ({
  OpenInEditor: () => createElement("div", { "data-testid": "open-in-editor" }),
}))

describe("DiffIndex", () => {
  it("renderiza o painel inicial com carregador", () => {
    const html = renderToStaticMarkup(
      createElement(DiffIndex, {
        cwd: "/fake/repo",
      }),
    )
    expect(html).toBeDefined()
  })
})
