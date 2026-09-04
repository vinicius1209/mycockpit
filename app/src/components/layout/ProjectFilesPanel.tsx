import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
  Search,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { isTauri } from "@/lib/db"
import {
  buildProjectFileTree,
  visibleProjectFileNodes,
  type ProjectFileNode,
} from "@/lib/fileTree"
import { projectFilePreviewKind } from "@/lib/projectFilePreview"
import { listProjectFiles } from "@/lib/sources"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"

type LoadState = "loading" | "ready" | "error" | "browser"

const MAX_SEARCH_RESULTS = 500

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string" && error.trim()) return error
  return "Não foi possível listar os arquivos."
}

function FileGlyph({ path }: { path: string }) {
  const kind = projectFilePreviewKind(path)
  if (kind === "image") return <FileImage className="size-3.5" aria-hidden="true" />
  if (kind === "markdown") return <FileText className="size-3.5" aria-hidden="true" />
  if (kind === "code") return <FileCode2 className="size-3.5" aria-hidden="true" />
  return <File className="size-3.5" aria-hidden="true" />
}

export function ProjectFilesPanel({ root }: { root: string }) {
  const [files, setFiles] = useState<string[]>([])
  const [status, setStatus] = useState<LoadState>("loading")
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const loadGeneration = useRef(0)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const mainTab = useApp((state) => state.mainTab)
  const openFileTab = useApp((state) => state.openFileTab)

  const loadFiles = useCallback(async () => {
    const generation = ++loadGeneration.current
    if (!isTauri()) {
      setStatus("browser")
      return
    }
    setStatus("loading")
    setError(null)
    try {
      const next = await listProjectFiles(root)
      if (generation !== loadGeneration.current) return
      setFiles(next)
      setStatus("ready")
    } catch (cause) {
      if (generation !== loadGeneration.current) return
      setError(errorMessage(cause))
      setStatus("error")
    }
  }, [root])

  useEffect(() => {
    setFiles([])
    setQuery("")
    setExpanded(new Set())
    setFocusedPath(null)
    void loadFiles()
    return () => {
      loadGeneration.current += 1
    }
  }, [loadFiles])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR")
    const matches = normalized
      ? files.filter((path) => path.toLocaleLowerCase("pt-BR").includes(normalized))
      : files
    return {
      total: matches.length,
      paths: normalized ? matches.slice(0, MAX_SEARCH_RESULTS) : matches,
      searching: Boolean(normalized),
    }
  }, [files, query])

  const tree = useMemo(() => buildProjectFileTree(filtered.paths), [filtered.paths])
  const rows = useMemo(
    () => visibleProjectFileNodes(tree, expanded, filtered.searching),
    [expanded, filtered.searching, tree],
  )

  useEffect(() => {
    if (rows.length === 0) {
      setFocusedPath(null)
    } else if (!focusedPath || !rows.some((row) => row.node.path === focusedPath)) {
      setFocusedPath(rows[0].node.path)
    }
  }, [focusedPath, rows])

  function toggleDirectory(path: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function focusRow(path: string) {
    setFocusedPath(path)
    requestAnimationFrame(() => rowRefs.current.get(path)?.focus())
  }

  function activate(node: ProjectFileNode) {
    if (node.kind === "directory") {
      if (!filtered.searching) toggleDirectory(node.path)
      return
    }
    openFileTab(node.path)
  }

  function handleKeyDown(event: KeyboardEvent, index: number) {
    const row = rows[index]
    if (!row) return
    const { node } = row
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const delta = event.key === "ArrowDown" ? 1 : -1
      const next = rows[Math.max(0, Math.min(rows.length - 1, index + delta))]
      if (next) focusRow(next.node.path)
      return
    }
    if (event.key === "ArrowRight" && node.kind === "directory") {
      event.preventDefault()
      if (!expanded.has(node.path) && !filtered.searching) {
        toggleDirectory(node.path)
      } else if (rows[index + 1]?.parentPath === node.path) {
        focusRow(rows[index + 1].node.path)
      }
      return
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      if (node.kind === "directory" && expanded.has(node.path) && !filtered.searching) {
        toggleDirectory(node.path)
      } else if (row.parentPath) {
        focusRow(row.parentPath)
      }
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      activate(node)
    }
  }

  const selectedPath = mainTab.kind === "arquivo" ? mainTab.path : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-3 pt-2 pb-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-2 left-2 size-3.5 text-muted-foreground/65" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar arquivo"
            aria-label="Buscar arquivo"
            className="h-8 border-0 bg-secondary/55 pr-3 pl-8 text-[12px] shadow-none"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icone-compacto"
          onClick={() => void loadFiles()}
          disabled={status === "loading"}
          aria-label="Atualizar arquivos"
          title="Atualizar arquivos"
        >
          <RefreshCw className={cn("size-3.5", status === "loading" && "animate-spin")} />
        </Button>
      </div>

      <div className="flex h-7 shrink-0 items-center px-4 font-mono text-[11px] tabular-nums text-muted-foreground/60">
        <span>{filtered.searching ? `${filtered.total} encontrados` : `${files.length} arquivos`}</span>
        {filtered.total > MAX_SEARCH_RESULTS && filtered.searching && (
          <span className="ml-auto">primeiros {MAX_SEARCH_RESULTS}</span>
        )}
      </div>

      {status === "loading" && files.length === 0 ? (
        <p className="px-5 py-8 text-[12px] text-muted-foreground">
          Lendo a árvore do projeto…
        </p>
      ) : status === "browser" ? (
        <p className="px-5 py-8 text-[12px] leading-relaxed text-muted-foreground">
          A árvore de arquivos está disponível no aplicativo.
        </p>
      ) : status === "error" ? (
        <div className="mx-4 rounded-lg bg-destructive/10 px-3 py-3 text-[12px] leading-relaxed text-destructive">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-5 py-8 text-[12px] text-muted-foreground">
          Nenhum arquivo encontrado.
        </p>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div role="tree" aria-label="Arquivos do projeto" className="px-2 pb-4">
            {rows.map((row, index) => {
              const { node, depth } = row
              const isDirectory = node.kind === "directory"
              const isExpanded = filtered.searching || expanded.has(node.path)
              const isSelected = selectedPath === node.path
              const DirectoryIcon = isExpanded ? FolderOpen : Folder
              return (
                <Button
                  key={node.path}
                  ref={(element) => {
                    if (element) rowRefs.current.set(node.path, element)
                    else rowRefs.current.delete(node.path)
                  }}
                  type="button"
                  role="treeitem"
                  size="compacto"
                  variant="ghost"
                  tabIndex={focusedPath === node.path ? 0 : -1}
                  aria-level={depth + 1}
                  aria-expanded={isDirectory ? isExpanded : undefined}
                  aria-selected={isSelected}
                  title={node.path}
                  onFocus={() => setFocusedPath(node.path)}
                  onClick={() => activate(node)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                  style={{ paddingLeft: 8 + depth * 12 }}
                  className={cn(
                    "flex w-full justify-start gap-1 rounded-md pr-2 text-left font-normal",
                    isSelected ? "bg-sel text-foreground" : "text-foreground/80 hover:bg-sel-hover",
                  )}
                >
                  <span className="grid size-3.5 shrink-0 place-items-center text-muted-foreground/55">
                    {isDirectory ? (
                      isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />
                    ) : null}
                  </span>
                  <span className="shrink-0 text-muted-foreground/65">
                    {isDirectory ? <DirectoryIcon className="size-3.5" aria-hidden="true" /> : <FileGlyph path={node.path} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left font-mono text-[12px]">
                    {node.name}
                  </span>
                </Button>
              )
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
