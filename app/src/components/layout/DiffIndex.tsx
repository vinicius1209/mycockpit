// A aba "Alterações" da COLUNA: índice, não leitor.
//
// A divisão que este arquivo materializa (docs/abas-no-principal-plan.md,
// F1.3): **a coluna decide, a aba lê**. Aqui ficam as ações sobre o CONJUNTO
// (abrir no editor, atualizar, commit, PR) e a consciência ambiente (branch,
// ±totais, quais arquivos mexeram). Ler o diff e comentar linha é da aba, que
// tem largura pra isso.
//
// O que saiu daqui e por quê: o acordeão inline. Numa coluna de ~390px úteis o
// código quebrava no meio da linha, e expandir um arquivo empurrava os outros
// dez pra 200 linhas de distância — a lista perdia o próprio trabalho. Clicar
// num arquivo agora ABRE A ABA já nele.

import { useEffect, useState } from "react"
import {
  CheckCheck,
  ChevronRight,
  GitBranch,
  Loader2,
  MessageSquareText,
  RefreshCw,
  X,
} from "lucide-react"
import { loadGitDiff, type GitDiff } from "@/lib/git"
import { OpenInEditor } from "@/components/common/OpenInEditor"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"
import { ShipBar } from "./DiffPanel/shipBar"
import { STATUS_META, splitPath } from "./DiffPanel/parts"

export function DiffIndex({
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
  const openDiffTab = useApp((s) => s.openDiffTab)
  const mainTab = useApp((s) => s.mainTab)

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
  const abertoNaAba = mainTab.kind === "diff" ? mainTab.focusPath : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {delivery && (
        <div className="shrink-0 border-b border-brass/30 bg-brass/[0.07] px-3 py-2.5">
          <div className="flex items-start gap-2">
            <CheckCheck className="mt-0.5 size-3.5 shrink-0 text-st-success" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-[12px] leading-snug text-foreground/90">
              <span className="font-medium">Entrega</span>
              {delivery.text && <span className="text-muted-foreground"> · </span>}
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
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-muted-foreground">
          Este projeto não é um repositório git.
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* Barra STICKY: ver o comentário original no DiffPanel — bg sólido
                (blur custa por-frame), cor do cartão pra ocluir direito. */}
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-card px-4 py-2 text-[11px]">
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
              <OpenInEditor projectPath={cwd} rel="" alvo="o projeto" />
              <button
                onClick={reload}
                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Atualizar diff"
                title="Atualizar"
              >
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              </button>
            </div>
            {files.length === 0 ? (
              <div className="px-6 py-16 text-center text-[13px] text-muted-foreground">
                Nenhuma alteração não-commitada. Working tree limpa.
              </div>
            ) : (
              <div className="flex flex-col pb-2">
                {files.map((f) => {
                  const st = STATUS_META[f.status] ?? STATUS_META.modified
                  const { dir, base } = splitPath(f.path)
                  const aberto = f.path === abertoNaAba
                  return (
                    <button
                      key={f.path}
                      onClick={() => openDiffTab(f.path)}
                      title={`${f.path} · abrir na aba Alterações`}
                      className={cn(
                        "flex w-full items-center gap-2 px-4 py-1.5 text-left transition-colors",
                        aberto ? "bg-sel" : "hover:bg-accent/40",
                      )}
                    >
                      {/* Seta apontando pra DIREITA e parada: ela não expande
                          mais nada aqui, indica que o conteúdo abre ao lado. */}
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
                      <span
                        className={cn("shrink-0 font-mono text-[11px] font-bold", st.cls)}
                        title={st.title}
                      >
                        {st.label}
                      </span>
                      <span className="flex min-w-0 flex-1 items-baseline font-mono text-[12px]">
                        <span className="truncate text-muted-foreground/55">{dir}</span>
                        <span className="shrink-0 text-foreground/90">{base}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums">
                        {f.additions > 0 && (
                          <span className="text-st-success">+{f.additions}</span>
                        )}
                        {f.deletions > 0 && (
                          <span className="text-st-error">−{f.deletions}</span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <ShipBar cwd={cwd} hasChanges={files.length > 0} onDone={reload} />
        </>
      )}
    </div>
  )
}
