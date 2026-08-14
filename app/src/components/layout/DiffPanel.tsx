import { useEffect, useState, type ReactNode } from "react"
import {
  Check,
  CheckCheck,
  ChevronRight,
  GitBranch,
  GitPullRequest,
  Loader2,
  MessageSquareText,
  RefreshCw,
  X,
} from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { toast } from "sonner"
import {
  loadGitDiff,
  gitCommit,
  createPr,
  prContext,
  type DiffFile,
  type GitDiff,
  type PrContext,
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
 *  arquivos novos). Lista por arquivo, colapsável; expande pros hunks.
 *  `delivery` (P3 — Entrega→diff): o painel abriu pelo clique numa entrega —
 *  ganha o header de correção no topo (Pedir correção / Fechar). */
export function DiffPanel({
  cwd,
  delivery,
  onRequestFix,
  onCloseDelivery,
}: {
  cwd: string
  delivery?: { text: string } | null
  onRequestFix?: () => void
  onCloseDelivery?: () => void
}) {
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
      {delivery && (
        <div className="shrink-0 border-b border-brass/30 bg-brass/[0.07] px-3 py-2.5">
          <div className="flex items-start gap-2">
            <CheckCheck className="mt-0.5 size-3.5 shrink-0 text-st-success" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-[12px] leading-snug text-foreground/90">
              <span className="font-medium">Entrega</span>
              {delivery.text && (
                <span className="text-muted-foreground"> · </span>
              )}
              <span className="line-clamp-2 inline text-muted-foreground">
                {delivery.text}
              </span>
            </p>
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              onClick={onCloseDelivery}
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent"
            >
              <X className="size-3.5" /> Fechar
            </button>
            <button
              onClick={onRequestFix}
              className="flex items-center gap-1.5 rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
            >
              <MessageSquareText className="size-3.5" /> Pedir correção
            </button>
          </div>
        </div>
      )}
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
            <div className="px-6 py-16 text-center text-[13px] text-muted-foreground">
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

/** Barra de shippar: Commit inline (local) + Abrir PR (abre o composer). */
function ShipBar({
  cwd,
  hasChanges,
  onDone,
}: {
  cwd: string
  hasChanges: boolean
  onDone: () => void
}) {
  const [committing, setCommitting] = useState(false)
  const [msg, setMsg] = useState("")
  const [busy, setBusy] = useState(false)
  const [prOpen, setPrOpen] = useState(false)
  const [prUrl, setPrUrl] = useState<string | null>(null)

  async function commit() {
    const v = msg.trim()
    if (!v) return
    setBusy(true)
    try {
      const sha = await gitCommit(cwd, v)
      toast.success(`Commit ${sha}`)
      setMsg("")
      setCommitting(false)
      onDone()
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha no commit")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {prOpen && (
        <PrComposer
          cwd={cwd}
          onClose={() => setPrOpen(false)}
          onOpened={(url) => {
            setPrUrl(url)
            setPrOpen(false)
          }}
        />
      )}
      {prUrl ? (
        <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2.5 text-[12px]">
          <button
            onClick={() => void openUrl(prUrl)}
            className="flex items-center gap-1.5 text-git-open transition-colors hover:underline"
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
      ) : committing ? (
        <div className="shrink-0 border-t p-3">
          <textarea
            autoFocus
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void commit()
              if (e.key === "Escape") {
                setCommitting(false)
                setMsg("")
              }
            }}
            rows={2}
            placeholder="Mensagem do commit…"
            className="w-full resize-none rounded-md border bg-secondary/30 p-2 text-[13px] text-foreground outline-none focus:border-brass/40"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">add -A + commit</span>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setCommitting(false)
                  setMsg("")
                }}
                className="rounded-md border px-2.5 py-1 text-[12px] text-foreground hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                onClick={() => void commit()}
                disabled={busy || !msg.trim()}
                className="flex items-center gap-1.5 rounded-md border border-brass/40 bg-brass/10 px-2.5 py-1 text-[12px] text-brass transition-colors hover:bg-brass/20 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                Commitar
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2.5">
          <button
            onClick={() => {
              setMsg("")
              setCommitting(true)
            }}
            disabled={!hasChanges}
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent disabled:opacity-40"
          >
            <Check className="size-3.5" /> Commit
          </button>
          <button
            onClick={() => setPrOpen(true)}
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent"
          >
            <GitPullRequest className="size-3.5" /> Abrir PR
          </button>
        </div>
      )}
    </>
  )
}

/** Composer de PR: detecta base/conta/template (pr_context) e deixa você ajustar
 *  tudo antes de abrir. Inteligência (detecção) + controle (edita) + honesto. */
function PrComposer({
  cwd,
  onClose,
  onOpened,
}: {
  cwd: string
  onClose: () => void
  onOpened: (url: string) => void
}) {
  const [ctx, setCtx] = useState<PrContext | null>(null)
  const [base, setBase] = useState("")
  const [account, setAccount] = useState("")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [tplIdx, setTplIdx] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void prContext(cwd).then((c) => {
      setCtx(c)
      setBase(c.baseDefault)
      setAccount(c.accountCurrent ?? "")
      setTitle(c.titleDefault)
      setBody(c.templates[0]?.body ?? "")
    })
  }, [cwd])

  async function submit() {
    if (!title.trim()) return
    setBusy(true)
    try {
      const r = await createPr(cwd, base, account, title.trim(), body)
      toast.success("PR aberto")
      onOpened(r.url)
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha ao abrir PR")
      setBusy(false)
    }
  }

  const inputCls =
    "rounded-md border bg-secondary/40 px-2 py-1 text-[12px] text-foreground outline-none focus:border-brass/40"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-8"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-[560px] flex-col rounded-xl border bg-card shadow-[var(--shadow-pop)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b px-5 py-3">
          <GitPullRequest className="size-4 text-brass" />
          <span className="text-[14px] font-medium text-foreground">
            Abrir Pull Request
          </span>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </div>
        {!ctx ? (
          <div className="flex flex-1 items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : !ctx.isRepo ? (
          <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">
            Este diretório não é um repositório git.
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-5 py-4 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">De</span>
              <span className="rounded-md border bg-secondary/40 px-2 py-1 font-mono text-[12px] text-foreground">
                {ctx.branch ?? "?"}
              </span>
              <span className="text-muted-foreground">→ Para</span>
              <select
                value={base}
                onChange={(e) => setBase(e.target.value)}
                className={cn(inputCls, "font-mono")}
              >
                {ctx.baseCandidates.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-muted-foreground">Conta</span>
              {ctx.accounts.length > 0 ? (
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  className={inputCls}
                >
                  {ctx.accounts.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="usuário gh"
                  className={cn(inputCls, "flex-1")}
                />
              )}
            </label>

            <label className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-muted-foreground">Título</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={cn(inputCls, "flex-1")}
              />
            </label>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-muted-foreground">Descrição</span>
                {ctx.templates.length > 1 && (
                  <select
                    value={tplIdx}
                    onChange={(e) => {
                      const i = Number(e.target.value)
                      setTplIdx(i)
                      setBody(ctx.templates[i]?.body ?? "")
                    }}
                    className={inputCls}
                  >
                    {ctx.templates.map((t, i) => (
                      <option key={t.name} value={i}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                placeholder="Descrição (do template do projeto, se houver)…"
                className="w-full resize-none rounded-md border bg-secondary/30 p-2 font-mono text-[12px] text-foreground outline-none focus:border-brass/40"
              />
            </div>

            {ctx.hasPrSkill && (
              <p className="rounded-md border border-brass/25 bg-brass/[0.06] px-2.5 py-1.5 text-[11px] text-muted-foreground">
                Esse projeto tem um <code className="text-brass">/pr</code> próprio
                (checks, dedup, sync com a base). Pro fluxo completo, rode{" "}
                <code className="text-brass">/pr</code> no Linear.
              </p>
            )}
          </div>
        )}
        <div className="flex shrink-0 items-center justify-between border-t px-5 py-3">
          <span className="text-[11px] text-muted-foreground">
            push + gh pr create{account ? ` (${account})` : ""}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md border px-3 py-1.5 text-[12px] text-foreground hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              onClick={() => void submit()}
              disabled={busy || !title.trim() || !ctx?.isRepo}
              className="flex items-center gap-1.5 rounded-md border border-brass/40 bg-brass/10 px-3 py-1.5 text-[12px] text-brass transition-colors hover:bg-brass/20 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <GitPullRequest className="size-3.5" />
              )}
              Abrir PR
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-muted-foreground">
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
          className={cn("shrink-0 font-mono text-[11px] font-bold", st.cls)}
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
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums">
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
          <p className="border-t border-border/60 bg-background/40 px-4 py-2 text-[12px] text-muted-foreground">
            Arquivo binário, sem diff de texto.
          </p>
        ) : (
          <div className="overflow-x-auto border-t border-border/60 bg-background/40 font-mono text-[12px] leading-[1.55]">
            {file.hunks.map((h, hi) => (
              <div key={hi}>
                <div className="bg-brass/[0.06] px-2 py-0.5 text-[11px] whitespace-pre text-muted-foreground/70">
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
