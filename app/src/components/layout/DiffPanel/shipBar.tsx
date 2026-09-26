import { useEffect, useState } from "react"
import { GitPullRequest, Loader2 } from "lucide-react"
import { avisar } from "@/lib/avisos"
import { createPr, prContext, type PrContext } from "@/lib/git"
import { AppDialog } from "@/components/ui/app-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

/** Composer de PR: detecta base/conta/template (pr_context) e deixa você ajustar
 *  tudo antes de abrir. Inteligência (detecção) + controle (edita) + honesto. */
export function PrComposer({
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setCtx(null)
    setLoadError(null)

    void prContext(cwd)
      .then((next) => {
        if (cancelled) return
        setCtx(next)
        setBase(next.baseDefault)
        setAccount(next.accountCurrent ?? "")
        setTitle(next.titleDefault)
        setTplIdx(0)
        setBody(next.templates[0]?.body ?? "")
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(
            errorMessage(error, "Não foi possível ler o repositório.")
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [cwd, reload])

  async function submit() {
    if (!title.trim() || !base.trim()) return
    setBusy(true)
    try {
      const r = await createPr(cwd, base, account, title.trim(), body)
      avisar.feito("Pull request aberto")
      onOpened(r.url)
    } catch (e) {
      avisar.erro("Não consegui abrir o pull request.", { detalhe: errorMessage(e, "") || null })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      size="lg"
      className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0"
      title={
        <span className="flex items-center gap-2 px-5 pt-4 pr-12">
          <GitPullRequest className="size-4 text-muted-foreground" />
          Abrir pull request
        </span>
      }
      description={
        <span className="block px-5 pb-3">
          Revise a origem, a base e o texto antes de publicar.
        </span>
      }
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
          <span className="text-[11px] text-muted-foreground">
            Envia a branch e cria o pull request
            {account ? ` com a conta ${account}` : ""}.
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="padrao" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              size="padrao"
              onClick={() => void submit()}
              disabled={busy || !title.trim() || !base.trim() || !ctx?.isRepo}
            >
              {busy ? (
                <Loader2 className="animate-spin" />
              ) : (
                <GitPullRequest />
              )}
              Abrir pull request
            </Button>
          </div>
        </div>
      }
    >
      {loadError ? (
        <div className="flex min-h-52 flex-col items-center justify-center gap-3 border-t px-5 py-10 text-center">
          <p className="max-w-sm text-[13px] text-muted-foreground">
            {loadError}
          </p>
          <Button
            variant="outline"
            size="padrao"
            onClick={() => setReload((value) => value + 1)}
          >
            Tentar novamente
          </Button>
        </div>
      ) : !ctx ? (
        <div className="flex min-h-52 items-center justify-center border-t text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : !ctx.isRepo ? (
        <div className="flex min-h-52 items-center justify-center border-t px-5 py-10 text-center text-[13px] text-muted-foreground">
          Este diretório não é um repositório Git.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto border-t px-5 py-4 text-[13px]">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
            <label className="min-w-0 space-y-1.5">
              <span className="block text-[12px] text-muted-foreground">
                Origem
              </span>
              <span className="flex h-8 items-center truncate rounded-md border bg-secondary/30 px-3 font-mono text-[12px] text-foreground">
                {ctx.branch ?? "Branch não identificada"}
              </span>
            </label>
            <span className="pb-2 text-muted-foreground" aria-hidden="true">
              →
            </span>
            <label className="min-w-0 space-y-1.5">
              <span className="block text-[12px] text-muted-foreground">
                Base
              </span>
              <Select value={base} onValueChange={setBase}>
                <SelectTrigger
                  size="sm"
                  className="w-full min-w-0 font-mono text-[12px]"
                  aria-label="Branch base"
                >
                  <SelectValue placeholder="Escolha a base" />
                </SelectTrigger>
                <SelectContent>
                  {ctx.baseCandidates.map((candidate) => (
                    <SelectItem key={candidate} value={candidate}>
                      {candidate}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>

          <label className="space-y-1.5">
            <span className="block text-[12px] text-muted-foreground">
              Conta
            </span>
            {ctx.accounts.length > 0 ? (
              <Select value={account} onValueChange={setAccount}>
                <SelectTrigger
                  size="sm"
                  className="w-full"
                  aria-label="Conta do GitHub"
                >
                  <SelectValue placeholder="Escolha a conta" />
                </SelectTrigger>
                <SelectContent>
                  {ctx.accounts.map((candidate) => (
                    <SelectItem key={candidate} value={candidate}>
                      {candidate}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                placeholder="Conta autenticada no GitHub CLI"
                className="h-8 text-[12px]"
              />
            )}
          </label>

          <label className="space-y-1.5">
            <span className="block text-[12px] text-muted-foreground">
              Título
            </span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-8 text-[12px]"
            />
          </label>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <label
                htmlFor="pr-description"
                className="text-[12px] text-muted-foreground"
              >
                Descrição
              </label>
              {ctx.templates.length > 1 && (
                <Select
                  value={String(tplIdx)}
                  onValueChange={(value) => {
                    const index = Number(value)
                    setTplIdx(index)
                    setBody(ctx.templates[index]?.body ?? "")
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="max-w-64"
                    aria-label="Modelo da descrição"
                  >
                    <SelectValue placeholder="Escolha um modelo" />
                  </SelectTrigger>
                  <SelectContent>
                    {ctx.templates.map((template, index) => (
                      <SelectItem key={template.name} value={String(index)}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <Textarea
              id="pr-description"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={8}
              placeholder="Descreva o que muda e como foi validado."
              className="resize-none font-mono text-[12px]"
            />
          </div>

          {ctx.hasPrSkill && (
            <p className="rounded-md border bg-secondary/30 px-3 py-2 text-[11px] text-muted-foreground">
              Este projeto também oferece o comando <code>/pr</code>, que pode
              executar verificações próprias antes da publicação.
            </p>
          )}
        </div>
      )}
    </AppDialog>
  )
}
