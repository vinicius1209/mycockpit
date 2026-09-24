export interface ProjectFileNode {
  kind: "directory" | "file"
  name: string
  path: string
  children: ProjectFileNode[]
}

export interface VisibleProjectFileNode {
  node: ProjectFileNode
  depth: number
  parentPath: string | null
}

interface MutableNode {
  kind: "directory" | "file"
  name: string
  path: string
  children: Map<string, MutableNode>
}

const FILE_NAME_COLLATOR = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
})

function compareNodes(a: ProjectFileNode, b: ProjectFileNode): number {
  if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1
  return FILE_NAME_COLLATOR.compare(a.name, b.name)
}

function freezeNode(node: MutableNode): ProjectFileNode {
  return {
    kind: node.kind,
    name: node.name,
    path: node.path,
    children: [...node.children.values()].map(freezeNode).sort(compareNodes),
  }
}

/**
 * Constrói uma árvore real a partir dos caminhos relativos devolvidos pelo Git.
 * Entradas vazias, absolutas e que tentam subir da raiz são descartadas.
 */
export function buildProjectFileTree(paths: readonly string[]): ProjectFileNode[] {
  const root = new Map<string, MutableNode>()

  for (const rawPath of paths) {
    const parts = rawPath.split("/").filter(Boolean)
    if (
      !rawPath ||
      rawPath.startsWith("/") ||
      parts.length === 0 ||
      parts.some((part) => part === "." || part === "..")
    ) {
      continue
    }

    let parent = root
    let currentPath = ""
    parts.forEach((name, index) => {
      currentPath = currentPath ? `${currentPath}/${name}` : name
      const isFile = index === parts.length - 1
      const existing = parent.get(name)
      if (existing) {
        if (!isFile && existing.kind === "directory") parent = existing.children
        return
      }
      const node: MutableNode = {
        kind: isFile ? "file" : "directory",
        name,
        path: currentPath,
        children: new Map(),
      }
      parent.set(name, node)
      if (!isFile) parent = node.children
    })
  }

  return [...root.values()].map(freezeNode).sort(compareNodes)
}

/** Projeta só as linhas visíveis. A árvore completa continua fora do DOM. */
export function visibleProjectFileNodes(
  nodes: readonly ProjectFileNode[],
  expanded: ReadonlySet<string>,
  expandAll = false,
): VisibleProjectFileNode[] {
  const visible: VisibleProjectFileNode[] = []

  function visit(
    siblings: readonly ProjectFileNode[],
    depth: number,
    parentPath: string | null,
  ) {
    for (const node of siblings) {
      visible.push({ node, depth, parentPath })
      if (
        node.kind === "directory" &&
        (expandAll || expanded.has(node.path))
      ) {
        visit(node.children, depth + 1, node.path)
      }
    }
  }

  visit(nodes, 0, null)
  return visible
}

export function fileName(path: string): string {
  return path.split("/").pop() || path
}

export interface LazyProjectFileEntry {
  kind: "directory" | "file"
  name: string
  relPath: string
  isSymlink: boolean
  /** O `.gitignore` exclui: a árvore mostra apagado, a busca pula (ADR-254). */
  ignored?: boolean
}

export interface VisibleLazyProjectFileEntry {
  node: LazyProjectFileEntry
  depth: number
  parentPath: string | null
}

/** Projeta somente os ramos já recebidos do backend e abertos pela pessoa. */
export function visibleLazyProjectFileEntries(
  byDirectory: Readonly<Record<string, readonly LazyProjectFileEntry[]>>,
  expanded: ReadonlySet<string>,
): VisibleLazyProjectFileEntry[] {
  const visible: VisibleLazyProjectFileEntry[] = []
  function visit(parent: string, depth: number) {
    for (const node of byDirectory[parent] ?? []) {
      visible.push({ node, depth, parentPath: parent || null })
      if (
        node.kind === "directory" &&
        !node.isSymlink &&
        expanded.has(node.relPath)
      ) {
        visit(node.relPath, depth + 1)
      }
    }
  }
  visit("", 0)
  return visible
}

export function mergeProjectFileEntries(
  current: readonly LazyProjectFileEntry[],
  next: readonly LazyProjectFileEntry[],
): LazyProjectFileEntry[] {
  const byPath = new Map(current.map((entry) => [entry.relPath, entry]))
  for (const entry of next) byPath.set(entry.relPath, entry)
  return [...byPath.values()]
}
