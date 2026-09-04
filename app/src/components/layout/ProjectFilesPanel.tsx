import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft,
  File,
  FileText,
  Folder,
  Search,
} from "lucide-react"
import { Markdown } from "@/components/common/Markdown"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { isTauri } from "@/lib/db"
import { listProjectFiles, readTextFile } from "@/lib/sources"

type LoadState = "loading" | "ready" | "error" | "browser"

interface FileGroup {
  name: string
  files: Array<{ path: string; label: string }>
}

const MAX_VISIBLE = 300

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string" && error.trim()) return error
  return fallback
}

function groupsOf(files: string[]): FileGroup[] {
  const groups = new Map<string, Array<{ path: string; label: string }>>()
  for (const path of files) {
    const slash = path.indexOf("/")
    const name = slash === -1 ? "Raiz" : path.slice(0, slash)
    const label = slash === -1 ? path : path.slice(slash + 1)
    const rows = groups.get(name) ?? []
    rows.push({ path, label })
    groups.set(name, rows)
  }
  return [...groups.entries()].map(([name, rows]) => ({ name, files: rows }))
}

function absolutePath(root: string, path: string): string {
  return `${root.replace(/\/$/, "")}/${path}`
}

export function ProjectFilesPanel({ root }: { root: string }) {
  const [files, setFiles] = useState<string[]>([])
  const [status, setStatus] = useState<LoadState>("loading")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const readGeneration = useRef(0)

  useEffect(() => {
    let cancelled = false
    setFiles([])
    setSelected(null)
    setContent(null)
    setReadError(null)
    setQuery("")
    if (!isTauri()) {
      setStatus("browser")
      return
    }
    setStatus("loading")
    listProjectFiles(root)
      .then((next) => {
        if (!cancelled) {
          setFiles(next)
          setStatus("ready")
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus("error")
          setReadError(errorMessage(error, "Não foi possível listar os arquivos."))
        }
      })
    return () => {
      cancelled = true
    }
  }, [root])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR")
    const matches = normalized
      ? files.filter((path) => path.toLocaleLowerCase("pt-BR").includes(normalized))
      : files
    return { total: matches.length, visible: matches.slice(0, MAX_VISIBLE) }
  }, [files, query])

  const groups = useMemo(() => groupsOf(filtered.visible), [filtered.visible])

  async function openFile(path: string) {
    const generation = ++readGeneration.current
    setSelected(path)
    setContent(null)
    setReadError(null)
    setReading(true)
    try {
      const text = await readTextFile(root, absolutePath(root, path))
      if (generation === readGeneration.current) setContent(text)
    } catch (error) {
      if (generation === readGeneration.current) {
        setReadError(
          errorMessage(error, "Este arquivo não pôde ser exibido como texto."),
        )
      }
    } finally {
      if (generation === readGeneration.current) setReading(false)
    }
  }

  function closeFile() {
    readGeneration.current += 1
    setSelected(null)
    setContent(null)
    setReadError(null)
    setReading(false)
  }

  if (selected) {
    const markdown = /\.(md|mdx)$/i.test(selected)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 px-3">
          <Button
            type="button"
            variant="ghost"
            size="icone-compacto"
            onClick={closeFile}
            aria-label="Voltar aos arquivos"
          >
            <ArrowLeft />
          </Button>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/85">
            {selected}
          </span>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-4 pb-6">
            {reading ? (
              <p className="py-8 text-center text-[12px] text-muted-foreground">
                Lendo arquivo…
              </p>
            ) : readError ? (
              <div className="rounded-lg bg-destructive/10 px-3 py-3 text-[12px] leading-relaxed text-destructive">
                {readError}
              </div>
            ) : content != null && markdown ? (
              <Markdown text={content} />
            ) : content != null ? (
              <pre
                data-selectable
                className="overflow-x-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/80"
              >
                {content}
              </pre>
            ) : null}
          </div>
        </ScrollArea>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative shrink-0 px-3 pt-2 pb-3">
        <Search className="pointer-events-none absolute top-4 left-5 size-3.5 text-muted-foreground/65" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar arquivo"
          aria-label="Buscar arquivo"
          className="h-8 border-0 bg-secondary/55 pr-3 pl-8 text-[12px] shadow-none"
        />
      </div>

      {status === "loading" ? (
        <p className="px-5 py-8 text-center text-[12px] text-muted-foreground">
          Lendo a árvore do projeto…
        </p>
      ) : status === "browser" ? (
        <p className="px-5 py-8 text-center text-[12px] leading-relaxed text-muted-foreground">
          A árvore de arquivos está disponível no aplicativo.
        </p>
      ) : status === "error" ? (
        <div className="mx-4 rounded-lg bg-destructive/10 px-3 py-3 text-[12px] leading-relaxed text-destructive">
          {readError ?? "Não foi possível listar os arquivos."}
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-3 pb-6">
            <div className="mb-3 flex items-center justify-between px-2 font-mono text-[11px] text-muted-foreground/65">
              <span>
                {query.trim()
                  ? `${filtered.total} encontrados`
                  : `${files.length} arquivos`}
              </span>
              {filtered.total > MAX_VISIBLE && (
                <span>primeiros {MAX_VISIBLE}</span>
              )}
            </div>
            {groups.length === 0 ? (
              <p className="px-2 py-8 text-center text-[12px] text-muted-foreground">
                Nenhum arquivo encontrado.
              </p>
            ) : (
              groups.map((group) => (
                <section key={group.name} className="mb-4">
                  <div className="mb-1 flex items-center gap-2 px-2">
                    <Folder className="size-3.5 text-muted-foreground/70" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium text-muted-foreground">
                      {group.name}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground/55">
                      {group.files.length}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-px">
                    {group.files.map((file) => {
                      const DocIcon = /\.(md|mdx|txt)$/i.test(file.path)
                        ? FileText
                        : File
                      return (
                        <li key={file.path}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="padrao"
                            onClick={() => void openFile(file.path)}
                            title={file.path}
                            className="w-full justify-start font-normal text-foreground/80 hover:bg-sel-hover"
                          >
                            <DocIcon className="size-3.5 shrink-0 text-muted-foreground/55" />
                            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                              {file.label}
                            </span>
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
