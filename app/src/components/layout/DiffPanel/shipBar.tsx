// Shippar do painel de Alterações: Commit local + Abrir PR.
//
// Saiu do DiffPanel.tsx quando o diff ganhou aba própria (F1.1/F1.3): a partir
// dali a COLUNA decide (commit, PR, abrir no editor) e a ABA lê (diff,
// comentários). Estas duas ações são sobre o conjunto de mudanças, então ficam
// com a coluna — e o arquivo de origem, que estava perto do teto, encolhe.

import { useEffect, useState } from "react"
import { Check, GitPullRequest, Loader2, X } from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { toast } from "sonner"
import { createPr, gitCommit, prContext, type PrContext } from "@/lib/git"
import { cn } from "@/lib/utils"

/** Barra de shippar: Commit inline (local) + Abrir PR (abre o composer). */
export function ShipBar({
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
            className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 disabled:opacity-40"
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

