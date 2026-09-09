import { describe, expect, it } from "vitest"
import {
  buildProjectFileTree,
  fileName,
  mergeProjectFileEntries,
  visibleLazyProjectFileEntries,
  visibleProjectFileNodes,
} from "./fileTree"

describe("buildProjectFileTree", () => {
  it("preserva a hierarquia real e ordena pastas antes de arquivos", () => {
    const tree = buildProjectFileTree([
      "README.md",
      "src/zeta.ts",
      "src/components/Button.tsx",
      "src/arquivo2.ts",
      "src/arquivo10.ts",
      "docs/guia.md",
    ])

    expect(tree.map((node) => `${node.kind}:${node.name}`)).toEqual([
      "directory:docs",
      "directory:src",
      "file:README.md",
    ])
    const src = tree[1]
    expect(src.children.map((node) => node.name)).toEqual([
      "components",
      "arquivo2.ts",
      "arquivo10.ts",
      "zeta.ts",
    ])
    expect(src.children[0].children[0].path).toBe("src/components/Button.tsx")
  })

  it("descarta caminhos absolutos ou que escapam da raiz", () => {
    expect(
      buildProjectFileTree(["/etc/passwd", "../segredo", "./oculto", "src/app.ts"]),
    ).toEqual([
      {
        kind: "directory",
        name: "src",
        path: "src",
        children: [
          {
            kind: "file",
            name: "app.ts",
            path: "src/app.ts",
            children: [],
          },
        ],
      },
    ])
  })
})

describe("visibleProjectFileNodes", () => {
  it("só inclui descendentes de pastas expandidas", () => {
    const tree = buildProjectFileTree([
      "src/components/Button.tsx",
      "src/app.ts",
      "README.md",
    ])

    expect(visibleProjectFileNodes(tree, new Set()).map((row) => row.node.path)).toEqual([
      "src",
      "README.md",
    ])
    expect(
      visibleProjectFileNodes(tree, new Set(["src"])).map((row) => row.node.path),
    ).toEqual(["src", "src/components", "src/app.ts", "README.md"])
    expect(visibleProjectFileNodes(tree, new Set(), true).at(-2)).toMatchObject({
      node: { path: "src/app.ts" },
      depth: 1,
      parentPath: "src",
    })
  })
})

describe("fileName", () => {
  it("extrai o nome para a aba principal", () => {
    expect(fileName("src/components/Button.tsx")).toBe("Button.tsx")
  })
})

describe("árvore lazy", () => {
  const src = {
    kind: "directory" as const,
    name: "src",
    relPath: "src",
    isSymlink: false,
  }
  const app = {
    kind: "file" as const,
    name: "app.ts",
    relPath: "src/app.ts",
    isSymlink: false,
  }

  it("não projeta filhos carregados enquanto a pasta estiver fechada", () => {
    const directories = { "": [src], src: [app] }
    expect(visibleLazyProjectFileEntries(directories, new Set())).toHaveLength(1)
    expect(
      visibleLazyProjectFileEntries(directories, new Set(["src"])).map(
        (row) => row.node.relPath,
      ),
    ).toEqual(["src", "src/app.ts"])
  })

  it("mescla páginas sem duplicar caminhos", () => {
    expect(mergeProjectFileEntries([app], [{ ...app, name: "APP.ts" }])).toEqual([
      { ...app, name: "APP.ts" },
    ])
  })
})
