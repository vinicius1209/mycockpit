import { describe, expect, it } from "vitest"
import { buildGitTree } from "./gitTree"
import type { GitFileItem } from "@/lib/git"

describe("gitTree", () => {
  const mockFile = (path: string): GitFileItem => ({
    path,
    oldPath: null,
    status: "modified",
    staged: false,
    additions: 1,
    deletions: 0,
  })

  it("agrupa arquivos planos em pastas e nós folha", () => {
    const files: GitFileItem[] = [
      mockFile("src/components/Button.tsx"),
      mockFile("src/index.ts"),
      mockFile("package.json"),
    ]

    const tree = buildGitTree(files)
    expect(tree).toHaveLength(2)

    // Diretorios primeiro
    expect(tree[0].kind).toBe("dir")
    expect(tree[0].name).toBe("src")

    // Arquivos na raiz depois
    expect(tree[1].kind).toBe("file")
    expect(tree[1].name).toBe("package.json")

    // Subpasta src
    if (tree[0].kind === "dir") {
      expect(tree[0].children).toHaveLength(2)
      expect(tree[0].children[0].kind).toBe("dir")
      expect(tree[0].children[0].name).toBe("components")
      expect(tree[0].children[1].kind).toBe("file")
      expect(tree[0].children[1].name).toBe("index.ts")
    }
  })

  it("lida com lista vazia", () => {
    expect(buildGitTree([])).toEqual([])
  })
})
