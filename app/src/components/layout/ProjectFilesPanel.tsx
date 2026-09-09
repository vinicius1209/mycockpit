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
  mergeProjectFileEntries,
  visibleLazyProjectFileEntries,
  type LazyProjectFileEntry,
} from "@/lib/fileTree"
import { projectFilePreviewKind } from "@/lib/projectFilePreview"
import {
  invalidateProjectFiles,
  loadProjectDirectory,
  projectFilesGeneration,
  searchProjectFileIndex,
} from "@/lib/projectFilesService"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"

type RequestState = "idle" | "loading" | "ready" | "error"

interface DirectoryView {
  entries: LazyProjectFileEntry[]
  nextCursor: string | null
  truncated: boolean
  status: RequestState
  error: string | null
}

interface SearchView extends DirectoryView {
  query: string
}

const EMPTY_DIRECTORY: DirectoryView = {
  entries: [],
  nextCursor: null,
  truncated: false,
  status: "idle",
  error: null,
}

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
  const [directories, setDirectories] = useState<Record<string, DirectoryView>>({})
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState<SearchView>({
    ...EMPTY_DIRECTORY,
    query: "",
  })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [searchRequest, setSearchRequest] = useState(0)
  const localGeneration = useRef(0)
  const searchGeneration = useRef(0)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const mainTab = useApp((state) => state.mainTab)
  const openFileTab = useApp((state) => state.openFileTab)

  const loadDirectory = useCallback(
    async (relPath: string, cursor: string | null = null, expected = localGeneration.current) => {
      setDirectories((current) => ({
        ...current,
        [relPath]: {
          ...(current[relPath] ?? EMPTY_DIRECTORY),
          status: "loading",
          error: null,
        },
      }))
      try {
        const result = await loadProjectDirectory({ root, relPath, cursor })
        if (
          expected !== localGeneration.current ||
          result.generation !== projectFilesGeneration(root)
        ) {
          return
        }
        setDirectories((current) => {
          const prior = current[relPath] ?? EMPTY_DIRECTORY
          return {
            ...current,
            [relPath]: {
              entries: cursor
                ? mergeProjectFileEntries(prior.entries, result.page.entries)
                : result.page.entries,
              nextCursor: result.page.nextCursor,
              truncated: result.page.truncated,
              status: "ready",
              error: null,
            },
          }
        })
      } catch (cause) {
        if (expected !== localGeneration.current) return
        setDirectories((current) => ({
          ...current,
          [relPath]: {
            ...(current[relPath] ?? EMPTY_DIRECTORY),
            status: "error",
            error: errorMessage(cause),
          },
        }))
      }
    },
    [root],
  )

  useEffect(() => {
    localGeneration.current += 1
    searchGeneration.current += 1
    setDirectories({})
    setQuery("")
    setSearch({ ...EMPTY_DIRECTORY, query: "" })
    setExpanded(new Set())
    setFocusedPath(null)
    setNotice(null)
    if (!isTauri()) return
    void loadDirectory("", null, localGeneration.current)
    return () => {
      localGeneration.current += 1
      searchGeneration.current += 1
    }
  }, [loadDirectory])

  const normalizedQuery = query.trim()
  useEffect(() => {
    const generation = ++searchGeneration.current
    if (!normalizedQuery || !isTauri()) {
      setSearch({ ...EMPTY_DIRECTORY, query: "" })
      return
    }
    setSearch((current) => ({
      ...(current.query === normalizedQuery ? current : EMPTY_DIRECTORY),
      query: normalizedQuery,
      status: "loading",
      error: null,
    }))
    const timer = setTimeout(() => {
      void searchProjectFileIndex({ root, query: normalizedQuery, limit: 100 }).then(
        (result) => {
          if (
            generation !== searchGeneration.current ||
            result.generation !== projectFilesGeneration(root)
          ) {
            return
          }
          setSearch({
            query: normalizedQuery,
            entries: result.page.entries,
            nextCursor: result.page.nextCursor,
            truncated: result.page.truncated,
            status: "ready",
            error: null,
          })
        },
        (cause) => {
          if (generation !== searchGeneration.current) return
          setSearch({
            ...EMPTY_DIRECTORY,
            query: normalizedQuery,
            status: "error",
            error: errorMessage(cause),
          })
        },
      )
    }, 140)
    return () => clearTimeout(timer)
  }, [normalizedQuery, root, searchRequest])

  const treeRows = useMemo(() => {
    const byDirectory = Object.fromEntries(
      Object.entries(directories).map(([path, state]) => [path, state.entries]),
    )
    return visibleLazyProjectFileEntries(byDirectory, expanded)
  }, [directories, expanded])
  const rows = useMemo(
    () =>
      normalizedQuery
        ? search.entries.map((node) => ({ node, depth: 0, parentPath: null }))
        : treeRows,
    [normalizedQuery, search.entries, treeRows],
  )

  useEffect(() => {
    if (rows.length === 0) {
      setFocusedPath(null)
    } else if (!focusedPath || !rows.some((row) => row.node.relPath === focusedPath)) {
      setFocusedPath(rows[0].node.relPath)
    }
  }, [focusedPath, rows])

  function focusRow(path: string) {
    setFocusedPath(path)
    requestAnimationFrame(() => rowRefs.current.get(path)?.focus())
  }

  function closeDirectory(path: string) {
    setExpanded((current) => {
      const next = new Set(current)
      next.delete(path)
      return next
    })
  }

  function openDirectory(node: LazyProjectFileEntry) {
    if (node.isSymlink) {
      setNotice("Links de pasta ficam visíveis, mas não são expandidos automaticamente.")
      return
    }
    setNotice(null)
    setExpanded((current) => new Set(current).add(node.relPath))
    if (!directories[node.relPath]) void loadDirectory(node.relPath)
  }

  function activate(node: LazyProjectFileEntry) {
    if (node.kind === "directory") {
      if (!normalizedQuery) {
        if (expanded.has(node.relPath)) closeDirectory(node.relPath)
        else openDirectory(node)
      }
      return
    }
    openFileTab(node.relPath)
  }

  function handleKeyDown(event: KeyboardEvent, index: number) {
    const row = rows[index]
    if (!row) return
    const { node } = row
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault()
      const target =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? rows.length - 1
            : Math.max(
                0,
                Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)),
              )
      const next = rows[target]
      if (next) focusRow(next.node.relPath)
      return
    }
    if (event.key === "ArrowRight" && node.kind === "directory") {
      event.preventDefault()
      if (!expanded.has(node.relPath) && !normalizedQuery) openDirectory(node)
      else if (rows[index + 1]?.parentPath === node.relPath) {
        focusRow(rows[index + 1].node.relPath)
      }
      return
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      if (node.kind === "directory" && expanded.has(node.relPath) && !normalizedQuery) {
        closeDirectory(node.relPath)
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

  async function loadMoreSearch() {
    if (!search.nextCursor || search.status === "loading") return
    const generation = ++searchGeneration.current
    setSearch((current) => ({ ...current, status: "loading", error: null }))
    try {
      const result = await searchProjectFileIndex({
        root,
        query: search.query,
        cursor: search.nextCursor,
        limit: 100,
      })
      if (generation !== searchGeneration.current) return
      setSearch((current) => ({
        ...current,
        entries: mergeProjectFileEntries(current.entries, result.page.entries),
        nextCursor: result.page.nextCursor,
        truncated: current.truncated || result.page.truncated,
        status: "ready",
      }))
    } catch (cause) {
      if (generation !== searchGeneration.current) return
      setSearch((current) => ({
        ...current,
        status: "error",
        error: errorMessage(cause),
      }))
    }
  }

  function refresh() {
    invalidateProjectFiles(root)
    localGeneration.current += 1
    searchGeneration.current += 1
    const expected = localGeneration.current
    const loaded = Object.keys(directories)
    for (const path of loaded.length ? loaded : [""]) void loadDirectory(path, null, expected)
    if (normalizedQuery) setSearchRequest((current) => current + 1)
  }

  const rootState = directories[""] ?? EMPTY_DIRECTORY
  const selectedPath = mainTab.kind === "arquivo" ? mainTab.path : null
  const busy = normalizedQuery
    ? search.status === "loading"
    : rootState.status === "loading"

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
          onClick={refresh}
          disabled={busy}
          aria-label="Atualizar arquivos"
          title="Atualizar arquivos"
        >
          {busy ? (
            <span className="preparo-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
        </Button>
      </div>

      {/* Legenda da varredura, não barra de status: uma linha rasa embaixo da
          busca. A contagem perdeu o "nesta pasta" (a árvore logo abaixo JÁ é a
          pasta) e os dois sinais de corte ficam num grupo só à direita — eram
          dois `ml-auto` irmãos, e com os dois ligados o segundo caía no meio da
          linha em vez de encostar na borda. */}
      <div className="flex min-h-6 shrink-0 items-center gap-2 px-4 font-mono text-[11px] tabular-nums text-muted-foreground/60">
        <span>
          {normalizedQuery
            ? `${search.entries.length} resultados`
            : `${rootState.entries.length} itens`}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {(normalizedQuery ? search.nextCursor : rootState.nextCursor) && (
            <span>há mais</span>
          )}
          {/* "leitura parcial" é a diferença entre "a pasta tem 18 itens" e "só
              consegui ler 18" — some quando a varredura é completa, que passou
              a ser o caso normal desde que exclusão nossa deixou de contar como
              falha (project_files.rs). */}
          {(normalizedQuery ? search.truncated : rootState.truncated) && (
            <span>leitura parcial</span>
          )}
        </span>
      </div>

      {notice && (
        <p className="mx-4 mb-2 rounded-md bg-secondary px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          {notice}
        </p>
      )}

      {!isTauri() ? (
        <p className="px-5 py-8 text-[12px] leading-relaxed text-muted-foreground">
          A árvore de arquivos está disponível no aplicativo.
        </p>
      ) : rootState.status === "loading" && rootState.entries.length === 0 && !normalizedQuery ? (
        <div className="flex items-center gap-2 px-5 py-8 text-[12px] text-muted-foreground" aria-busy="true">
          <span className="preparo-spin" aria-hidden="true" />
          <span className="espera-nomeada">Lendo esta pasta</span>
        </div>
      ) : search.status === "loading" && search.entries.length === 0 && normalizedQuery ? (
        <div className="flex items-center gap-2 px-5 py-8 text-[12px] text-muted-foreground" aria-busy="true">
          <span className="preparo-spin" aria-hidden="true" />
          <span className="espera-nomeada">Buscando arquivos</span>
        </div>
      ) : rootState.status === "error" && !normalizedQuery ? (
        <div className="mx-4 rounded-lg bg-destructive/10 px-3 py-3 text-[12px] leading-relaxed text-destructive">
          <p>{rootState.error}</p>
          <Button variant="ghost" size="compacto" onClick={() => void loadDirectory("")}>
            Tentar novamente
          </Button>
        </div>
      ) : search.status === "error" && normalizedQuery ? (
        <div className="mx-4 rounded-lg bg-destructive/10 px-3 py-3 text-[12px] leading-relaxed text-destructive">
          <p>{search.error}</p>
          <Button variant="ghost" size="compacto" onClick={() => setSearchRequest((current) => current + 1)}>
            Tentar novamente
          </Button>
        </div>
      ) : rows.length === 0 && !busy ? (
        <p className="px-5 py-8 text-[12px] text-muted-foreground">
          {normalizedQuery ? "Nenhum arquivo encontrado." : "Esta pasta está vazia."}
        </p>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div role="tree" aria-label="Arquivos do projeto" aria-busy={busy} className="px-2 pb-4">
            {rows.map((row, index) => {
              const { node, depth } = row
              const isDirectory = node.kind === "directory"
              const isExpanded = !normalizedQuery && expanded.has(node.relPath)
              const isSelected = selectedPath === node.relPath
              const childState = directories[node.relPath]
              const DirectoryIcon = isExpanded ? FolderOpen : Folder
              return (
                <div key={node.relPath}>
                  <Button
                    ref={(element) => {
                      if (element) rowRefs.current.set(node.relPath, element)
                      else rowRefs.current.delete(node.relPath)
                    }}
                    type="button"
                    role="treeitem"
                    size="compacto"
                    variant="ghost"
                    tabIndex={focusedPath === node.relPath ? 0 : -1}
                    aria-level={depth + 1}
                    aria-expanded={isDirectory && !node.isSymlink ? isExpanded : undefined}
                    aria-selected={isSelected}
                    title={node.isSymlink ? `${node.relPath} (link)` : node.relPath}
                    onFocus={() => setFocusedPath(node.relPath)}
                    onClick={() => activate(node)}
                    onKeyDown={(event) => handleKeyDown(event, index)}
                    style={{ paddingLeft: 8 + depth * 12 }}
                    className={cn(
                      "flex w-full justify-start gap-1 rounded-md pr-2 text-left font-normal",
                      isSelected ? "bg-sel text-foreground" : "text-foreground/80 hover:bg-sel-hover",
                    )}
                  >
                    <span className="grid size-3.5 shrink-0 place-items-center text-muted-foreground/55">
                      {isDirectory && !node.isSymlink ? (
                        childState?.status === "loading" ? (
                          <span className="preparo-spin" aria-hidden="true" />
                        ) : isExpanded ? (
                          <ChevronDown className="size-3" />
                        ) : (
                          <ChevronRight className="size-3" />
                        )
                      ) : null}
                    </span>
                    <span className="shrink-0 text-muted-foreground/65">
                      {isDirectory ? (
                        <DirectoryIcon className="size-3.5" aria-hidden="true" />
                      ) : (
                        <FileGlyph path={node.relPath} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left font-mono text-[12px]">
                      {node.name}
                    </span>
                  </Button>
                  {isExpanded && childState?.status === "error" && (
                    <div className="flex items-center gap-2 py-1 pr-2 text-[11px] text-destructive" style={{ paddingLeft: 28 + depth * 12 }}>
                      <span className="min-w-0 flex-1 truncate">{childState.error}</span>
                      <Button variant="ghost" size="chip" onClick={() => void loadDirectory(node.relPath)}>
                        Tentar novamente
                      </Button>
                    </div>
                  )}
                  {isExpanded && childState?.nextCursor && (
                    <Button
                      variant="ghost"
                      size="compacto"
                      className="w-full justify-start text-muted-foreground"
                      style={{ paddingLeft: 28 + depth * 12 }}
                      onClick={() => void loadDirectory(node.relPath, childState.nextCursor)}
                    >
                      Carregar mais nesta pasta
                    </Button>
                  )}
                  {isExpanded && childState?.truncated && !childState.nextCursor && (
                    <p
                      className="py-1 pr-2 text-[11px] text-muted-foreground"
                      style={{ paddingLeft: 28 + depth * 12 }}
                    >
                      Leitura parcial nesta pasta
                    </p>
                  )}
                </div>
              )
            })}
            {normalizedQuery && search.nextCursor && (
              <Button
                variant="ghost"
                size="compacto"
                className="mt-1 w-full text-muted-foreground"
                onClick={() => void loadMoreSearch()}
                disabled={search.status === "loading"}
              >
                Carregar mais resultados
              </Button>
            )}
            {!normalizedQuery && rootState.nextCursor && (
              <Button
                variant="ghost"
                size="compacto"
                className="mt-1 w-full text-muted-foreground"
                onClick={() => void loadDirectory("", rootState.nextCursor)}
                disabled={rootState.status === "loading"}
              >
                Carregar mais nesta pasta
              </Button>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
