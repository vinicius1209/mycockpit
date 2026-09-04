import type { GitFileItem } from "@/lib/git"

export interface GitTreeDirNode {
  kind: "dir"
  name: string
  path: string
  children: GitTreeNode[]
}

export interface GitTreeFileNode {
  kind: "file"
  name: string
  path: string
  file: GitFileItem
}

export type GitTreeNode = GitTreeDirNode | GitTreeFileNode

/**
 * Converte uma lista de arquivos do git em uma árvore hierárquica ordenada
 * (pastas primeiro, depois arquivos; ambos em ordem alfabética).
 */
export function buildGitTree(files: readonly GitFileItem[]): GitTreeNode[] {
  interface InternalDir {
    name: string
    path: string
    dirs: Map<string, InternalDir>
    files: GitFileItem[]
  }

  const root: InternalDir = {
    name: "",
    path: "",
    dirs: new Map(),
    files: [],
  }

  for (const f of files) {
    const segments = f.path.split("/")
    let cur = root
    let currentPath = ""

    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]
      currentPath = currentPath ? `${currentPath}/${seg}` : seg
      let next = cur.dirs.get(seg)
      if (!next) {
        next = { name: seg, path: currentPath, dirs: new Map(), files: [] }
        cur.dirs.set(seg, next)
      }
      cur = next
    }

    cur.files.push(f)
  }

  function convert(dir: InternalDir): GitTreeNode[] {
    const result: GitTreeNode[] = []

    const sortedDirs = Array.from(dir.dirs.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    for (const d of sortedDirs) {
      result.push({
        kind: "dir",
        name: d.name,
        path: d.path,
        children: convert(d),
      })
    }

    const sortedFiles = dir.files
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
    for (const f of sortedFiles) {
      const name = f.path.split("/").pop() ?? f.path
      result.push({
        kind: "file",
        name,
        path: f.path,
        file: f,
      })
    }

    return result
  }

  return convert(root)
}
