import { useEffect, useState, type ReactNode } from "react"
import {
  Check,
  ChevronRight,
  GitBranch,
  GitPullRequest,
  Loader2,
  RefreshCw,
} from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { toast } from "sonner"
import {
  loadGitDiff,
  gitCommit,
  createPr,
  type DiffFile,
  type GitDiff,
} from "@/lib/git"
import { cn } from "@/lib/utils"

const STATUS_META: Record<
  string,
  { label: string; title: string; cls: string }
> = {
  modified: { label: "M", title: "modificado", cls: "text-st-warning" },
  added: { label: "A", title: "novo", cls: "text-st-success" },
  deleted: { label: "D", title: "removido", cls: "text-st-error" },
  renamed: { label: "R", title: "renomeado", cls: "text-brass" },
}

/** Painel de alterações: diff da working tree do `cwd` (v1: não-commitado vs HEAD +
 *  arquivos novos). Lista por arquivo, colapsável; expande pros hunks. */
export function DiffPanel({ cwd }: { cwd: string }) {
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Set<string>>(new Set())

  function reload() {
    setLoading(true)
    void loadGitDiff(cwd).then((d) => {
      setDiff(d)
      setLoading(false)
    })
  }
  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  const files = diff?.files ?? []
  const totalAdd = files.reduce((s, f) => s + f.additions, 0)
  const totalDel = files.reduce((s, f) => s + f.deletions, 0)

  // Barra STICKY (branch + stat + refresh): fica no topo enquanto a lista rola.
  // bg sólido (sem backdrop-blur, que custa por-frame e travaria o scroll longo).
  const bar = (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-2 text-[11px]">
      {diff?.branch ? (
        <span className="flex min-w-0 items-center gap-1 font-mono text-muted-foreground">
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">{diff.branch}</span>
        </span>
      ) : (
        <span className="text-muted-foreground/60">Alterações</span>
      )}
      <span className="ml-auto flex items-center gap-2 font-mono tabular-nums">
        {totalAdd > 0 && <span className="text-st-success">+{totalAdd}</span>}
        {totalDel > 0 && <span className="text-st-error">−{totalDel}</span>}
      </span>
      <button
        onClick={reload}
        className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Atualizar diff"
        title="Atualizar"
      >
        <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
      </button>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {loading && !diff ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : !diff?.isRepo ? (
        <Empty>Este projeto não é um repositório git.</Empty>
      ) : (
        <>
          {/* scroll NATIVO (mais leve que o Radix ScrollArea com muitos itens). */}
          <div className="min-h-0 flex-1 overflow-y-auto">
          {bar}
          {files.length === 0 ? (
            <div className="px-6 py-16 text-center text-[12.5px] text-muted-foreground">
              Nenhuma alteração não-commitada. Working tree limpa.
            </div>
          ) : (
            <div className="flex flex-col pb-2">
              {files.map((f) => (
                <FileBlock
                  key={f.path}
                  file={f}
                  open={open.has(f.path)}
                  onToggle={() =>
                    setOpen((s) => {
                      const n = new Set(s)
                      if (n.has(f.path)) n.delete(f.path)
                      else n.add(f.path)
                      return n
                    })
                  }
                />
              ))}
            </div>
          )}
          </div>
          <ShipBar cwd={cwd} hasChanges={files.length > 0} onDone={reload} />
        </>
      )}
    </div>
  )
}

/** Barra de shippar: Commit (local) + Abrir PR (outward, confirmação inline). */
function ShipBar({
  cwd,
  hasChanges,
  onDone,
}: {
  cwd: string
  hasChanges: boolean
  onDone: () => void
}) {
  const [mode, setMode] = useState<null | "commit" | "pr">(null)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [prUrl, setPrUrl] = useState<string | null>(null)

  async function run(isPr: boolean) {
    const v = text.trim()
    if (!v) return
    setBusy(true)
    try {
      if (isPr) {
        const r = await createPr(cwd, v, "")
        setPrUrl(r.url)
        toast.success("PR aberto")
      } else {
        const sha = await gitCommit(cwd, v)
        toast.success(`Commit ${sha}`)
        onDone()
      }
      setText("")
      setMode(null)
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha na operação")
    } finally {
      setBusy(false)
    }
  }

  if (prUrl) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2.5 text-[12px]">
        <button
          onClick={() => void openUrl(prUrl)}
          className="flex items-center gap-1.5 text-[#3fb950] transition-colors hover:underline"
        >
          <GitPullRequest className="size-3.5" /> PR aberto, abrir no GitHub
        </button>
        <button
          onClick={() => setPrUrl(null)}
          className="ml-auto rounded p-1 text-muted-foreground hover:text-foreground"
          title="Ok"
        >
          <Check className="size-3.5" />
        </button>
      </div>
    )
  }

  if (mode) {
    const isPr = mode === "pr"
    return (
      <div className="shrink-0 border-t p-3">
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void run(isPr)
            if (e.key === "Escape") {
              setMode(null)
              setText("")
            }
          }}
          rows={isPr ? 1 : 2}
          placeholder={isPr ? "Título do PR…" : "Mensagem do commit…"}
          className="w-full resize-none rounded-md border bg-secondary/30 p-2 text-[12.5px] text-foreground outline-none focus:border-brass/40"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10.5px] text-muted-foreground">
            {isPr ? "push + gh pr create" : "add -A + commit"}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setMode(null)
                setText("")
              }}
              className="rounded-md border px-2.5 py-1 text-[12px] text-foreground hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              onClick={() => void run(isPr)}
              disabled={busy || !text.trim()}
              className="flex items-center gap-1.5 rounded-md border border-brass/40 bg-brass/10 px-2.5 py-1 text-[12px] text-brass transition-colors hover:bg-brass/20 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : isPr ? (
                <GitPullRequest className="size-3.5" />
              ) : (
                <Check className="size-3.5" />
              )}
              {isPr ? "Criar PR" : "Commitar"}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2.5">
      <button
        onClick={() => {
          setText("")
          setMode("commit")
        }}
        disabled={!hasChanges}
        className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent disabled:opacity-40"
      >
        <Check className="size-3.5" /> Commit
      </button>
      <button
        onClick={() => {
          setText("")
          setMode("pr")
        }}
        className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent"
      >
        <GitPullRequest className="size-3.5" /> Abrir PR
      </button>
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center text-[12.5px] text-muted-foreground">
      {children}
    </div>
  )
}

function FileBlock({
  file,
  open,
  onToggle,
}: {
  file: DiffFile
  open: boolean
  onToggle: () => void
}) {
  const st = STATUS_META[file.status] ?? STATUS_META.modified
  const cut = file.path.lastIndexOf("/")
  const dir = cut >= 0 ? file.path.slice(0, cut + 1) : ""
  const base = cut >= 0 ? file.path.slice(cut + 1) : file.path
  return (
    <div className="border-b border-border/60">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-1.5 text-left transition-colors hover:bg-accent/40"
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/50 transition-transform",
            open && "rotate-90",
          )}
        />
        <span
          className={cn("shrink-0 font-mono text-[10px] font-bold", st.cls)}
          title={st.title}
        >
          {st.label}
        </span>
        <span
          className="flex min-w-0 flex-1 items-baseline font-mono text-[12px]"
          title={file.path}
        >
          <span className="truncate text-muted-foreground/55">{dir}</span>
          <span className="shrink-0 text-foreground/90">{base}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] tabular-nums">
          {file.additions > 0 && (
            <span className="text-st-success">+{file.additions}</span>
          )}
          {file.deletions > 0 && (
            <span className="text-st-error">−{file.deletions}</span>
          )}
        </span>
      </button>
      {open &&
        (file.binary ? (
          <p className="border-t border-border/60 bg-background/40 px-4 py-2 text-[11.5px] text-muted-foreground">
            Arquivo binário — sem diff de texto.
          </p>
        ) : (
          <div className="overflow-x-auto border-t border-border/60 bg-background/40 font-mono text-[11.5px] leading-[1.55]">
            {file.hunks.map((h, hi) => (
              <div key={hi}>
                <div className="bg-brass/[0.06] px-2 py-0.5 text-[10.5px] whitespace-pre text-muted-foreground/70">
                  {h.header}
                </div>
                {h.lines.map((ln, li) => (
                  <div
                    key={li}
                    className={cn(
                      "flex whitespace-pre",
                      ln.type === "add" && "bg-st-success/[0.10]",
                      ln.type === "del" && "bg-st-error/[0.10]",
                    )}
                  >
                    <span className="w-9 shrink-0 border-r border-border/40 px-1 text-right text-muted-foreground/35 tabular-nums select-none">
                      {ln.oldNo ?? ""}
                    </span>
                    <span className="w-9 shrink-0 border-r border-border/40 px-1 text-right text-muted-foreground/35 tabular-nums select-none">
                      {ln.newNo ?? ""}
                    </span>
                    <span
                      className={cn(
                        "w-4 shrink-0 text-center select-none",
                        ln.type === "add"
                          ? "text-st-success"
                          : ln.type === "del"
                            ? "text-st-error"
                            : "text-transparent",
                      )}
                    >
                      {ln.type === "add" ? "+" : ln.type === "del" ? "−" : " "}
                    </span>
                    <span className="pr-3 pl-1 text-foreground/85">
                      {ln.text || " "}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
    </div>
  )
}
