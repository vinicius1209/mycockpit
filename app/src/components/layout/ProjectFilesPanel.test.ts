import { describe, expect, it } from "vitest"

const sources = import.meta.glob("./ProjectFilesPanel.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

const source = Object.values(sources)[0] ?? ""

describe("a árvore de arquivos", () => {
  it("é uma árvore de navegação e abre o leitor no palco principal", () => {
    expect(source).toContain('role="tree"')
    expect(source).toContain('role="treeitem"')
    expect(source).toContain("openFileTab(node.relPath)")
    expect(source).toContain("loadProjectDirectory")
    expect(source).toContain("searchProjectFileIndex")
    expect(source).not.toContain("listProjectFiles")
    expect(source).not.toContain("readTextFile")
    expect(source).not.toContain("<Markdown")
  })
})
