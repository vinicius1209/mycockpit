// A aba "Alterações" da COLUNA: central completa de Source Control (estilo VS Code / Zed).
//
// A coluna decide, a aba lê (F1.3). Aqui o desenvolvedor tem controle total:
// - Visualização por seções: Staged Changes vs Changes (com counters)
// - Ações granulares e globais: Stage (+), Unstage (-), Discard (↩ com confirmação)
// - Modos de exibição: Lista plana ou Árvore hierárquica por diretórios
// - Composer de commit avançado com geração de mensagem via IA (Conventional Commits)
// - Ações de conjunto: Branch/Sync status, Abrir no editor, Abrir PR.

import { useEffect, useRef, useState } from "react"
import {
  Check,
  CheckCheck,
  FolderTree,
  GitBranch,
  GitPullRequest,
  List,
  Loader2,
  MessageSquareText,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react"
import {
  loadGitStatus,
  stageAll,
  unstageAll,
  discardAll,
  type GitStatus,
} from "@/lib/git"
import { OpenInEditor } from "@/components/common/OpenInEditor"
import { CommitComposer } from "./DiffPanel/CommitComposer"
import { GitSection, GitFileList } from "./DiffPanel/GitSection"
import { PrComposer } from "./DiffPanel/shipBar"
import { openUrl } from "@tauri-apps/plugin-opener"
import { useApp } from "@/store/app"
import { controle } from "@/components/ui/controle"
import { confirm } from "@/lib/confirm"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

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
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const loadEpoch = useRef(0)
  const [viewMode, setViewMode] = useState<"list" | "tree">("list")
  const [stagedOpen, setStagedOpen] = useState(true)
  const [unstagedOpen, setUnstagedOpen] = useState(true)
  const [prOpen, setPrOpen] = useState(false)
  const [prUrl, setPrUrl] = useState<string | null>(null)

  const openDiffTab = useApp((s) => s.openDiffTab)
  const mainTab = useApp((s) => s.mainTab)

  function reload() {
    const epoch = ++loadEpoch.current
    setLoading(true)
    setLoadError(null)
    void loadGitStatus(cwd)
      .then((next) => {
        if (loadEpoch.current !== epoch) return
        setStatus(next)
      })
      .catch((error) => {
        if (loadEpoch.current !== epoch) return
        setStatus(null)
        setLoadError(
          typeof error === "string"
            ? error
            : "Não foi possível consultar o estado do Git.",
        )
      })
      .finally(() => {
        if (loadEpoch.current === epoch) setLoading(false)
      })
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  const staged = status?.staged ?? []
  const unstaged = status?.unstaged ?? []
  const totalChanges = staged.length + unstaged.length

  const totalAdd =
    staged.reduce((s, f) => s + f.additions, 0) +
    unstaged.reduce((s, f) => s + f.additions, 0)
  const totalDel =
    staged.reduce((s, f) => s + f.deletions, 0) +
    unstaged.reduce((s, f) => s + f.deletions, 0)

  const abertoNaAba = mainTab.kind === "diff" ? mainTab.focusPath : undefined

  function renderFileDelta(add: number, del: number) {
    return (
      <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums">
        {add > 0 && <span className="text-st-success">+{add}</span>}
        {del > 0 && <span className="text-st-error">−{del}</span>}
      </span>
    )
  }

  async function handleStageAll() {
    try {
      await stageAll(cwd)
      toast.success("Todas as alterações foram preparadas para commit")
      reload()
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha ao preparar as alterações")
    }
  }

  async function handleUnstageAll() {
    try {
      await unstageAll(cwd)
      toast.success("Todas as alterações saíram da preparação")
      reload()
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha ao desfazer a preparação")
    }
  }

  async function handleDiscardAll() {
    const accepted = await confirm({
      title: "Descartar todas as alterações não preparadas?",
      description:
        "Arquivos não rastreados serão apagados. O que já está preparado para commit será preservado.",
      confirmLabel: "Descartar alterações",
      danger: true,
    })
    if (!accepted) return
    try {
      await discardAll(cwd)
      toast.success("Alterações não preparadas descartadas")
      reload()
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha ao descartar alterações")
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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

      {delivery && (
        <div className="shrink-0 border-b border-brass/30 bg-brass/[0.07] px-3 py-2.5">
          <div className="flex items-start gap-2">
            <CheckCheck
              className="mt-0.5 size-3.5 shrink-0 text-st-success"
              aria-hidden="true"
            />
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
              type="button"
              onClick={onCloseDelivery}
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent"
            >
              <X className="size-3.5" /> Fechar
            </button>
            <button
              type="button"
              onClick={onRequestFix}
              className="flex items-center gap-1.5 rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
            >
              <MessageSquareText className="size-3.5" /> Pedir correção
            </button>
          </div>
        </div>
      )}

      {loading && !status ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : loadError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-[13px] font-medium text-foreground">
            Não foi possível ler as alterações
          </p>
          <p className="text-[12px] text-muted-foreground">{loadError}</p>
          <button
            type="button"
            onClick={reload}
            className={cn(controle("compacto"), "border hover:bg-accent")}
          >
            Tentar novamente
          </button>
        </div>
      ) : !status?.isRepo ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-muted-foreground">
          Este projeto não é um repositório Git.
        </div>
      ) : (
        <>
          {/* Barra STICKY: Branch, Sync, Totais e Controles Globais */}
          <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b bg-card px-3 py-1.5 text-[11px]">
            {status.branch ? (
              <span className="flex min-w-0 items-center gap-1 font-mono text-muted-foreground">
                <GitBranch className="size-3 shrink-0" />
                <span className="truncate">{status.branch}</span>
                {status.upstream && (status.ahead > 0 || status.behind > 0) && (
                  <span className="ml-1 text-[11px] tabular-nums text-foreground/80">
                    {status.ahead > 0 && `↑${status.ahead}`}
                    {status.behind > 0 && `↓${status.behind}`}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground/60">Alterações</span>
            )}

            <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
              {totalAdd > 0 && <span className="text-st-success">+{totalAdd}</span>}
              {totalDel > 0 && <span className="text-st-error">−{totalDel}</span>}
            </span>

            {/* Alternador Lista vs Árvore */}
            <button
              type="button"
              onClick={() => setViewMode(viewMode === "list" ? "tree" : "list")}
              className={cn(
                controle("chip", { quadrado: true }),
                "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              )}
              title={viewMode === "list" ? "Ver em árvore" : "Ver em lista"}
              aria-label={viewMode === "list" ? "Ver em árvore" : "Ver em lista"}
            >
              {viewMode === "list" ? (
                <FolderTree className="size-3.5" />
              ) : (
                <List className="size-3.5" />
              )}
            </button>

            <OpenInEditor projectPath={cwd} rel="" alvo="o projeto" />

            <button
              type="button"
              onClick={reload}
              className={cn(
                controle("chip", { quadrado: true }),
                "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              )}
              aria-label="Atualizar status"
              title="Atualizar"
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </button>
          </div>

          {/* Composer de Commit no topo */}
          <CommitComposer
            cwd={cwd}
            stagedCount={staged.length}
            totalChanges={totalChanges}
            onCommitted={reload}
          />

          {/* Área com rolagem contendo as seções de arquivos */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {totalChanges === 0 ? (
              <div className="px-6 py-14 text-center text-[12px] text-muted-foreground">
                Nenhuma alteração pendente. A árvore de trabalho está limpa.
              </div>
            ) : (
              <div className="flex flex-col">
                {/* Seção 1: Staged Changes */}
                <GitSection
                  title="Preparadas"
                  count={staged.length}
                  isOpen={stagedOpen}
                  onToggle={() => setStagedOpen(!stagedOpen)}
                  actions={
                    staged.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleUnstageAll()
                        }}
                        title="Desfazer toda a preparação"
                        aria-label="Desfazer toda a preparação"
                        className={cn(
                          controle("chip", { quadrado: true }),
                          "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        <Minus className="size-3" />
                      </button>
                    )
                  }
                >
                  <GitFileList
                    cwd={cwd}
                    files={staged}
                    viewMode={viewMode}
                    activePath={abertoNaAba}
                    onOpenFile={(p) => openDiffTab(p)}
                    onReload={reload}
                    renderDelta={renderFileDelta}
                  />
                </GitSection>

                {/* Seção 2: Changes (Unstaged) */}
                <GitSection
                  title="Alterações"
                  count={unstaged.length}
                  isOpen={unstagedOpen}
                  onToggle={() => setUnstagedOpen(!unstagedOpen)}
                  actions={
                    unstaged.length > 0 && (
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleDiscardAll()
                          }}
                          title="Descartar alterações não preparadas"
                          aria-label="Descartar alterações não preparadas"
                          className={cn(
                            controle("chip", { quadrado: true }),
                            "text-muted-foreground hover:bg-accent hover:text-st-error",
                          )}
                        >
                          <RotateCcw className="size-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleStageAll()
                          }}
                          title="Preparar todas as alterações"
                          aria-label="Preparar todas as alterações"
                          className={cn(
                            controle("chip", { quadrado: true }),
                            "text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                        >
                          <Plus className="size-3" />
                        </button>
                      </div>
                    )
                  }
                >
                  <GitFileList
                    cwd={cwd}
                    files={unstaged}
                    viewMode={viewMode}
                    activePath={abertoNaAba}
                    onOpenFile={(p) => openDiffTab(p)}
                    onReload={reload}
                    renderDelta={renderFileDelta}
                  />
                </GitSection>
              </div>
            )}
          </div>

          {/* Rodapé: Abrir Pull Request ou link de PR aberto */}
          {prUrl ? (
            <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2 text-[12px]">
              <button
                type="button"
                onClick={() =>
                  void openUrl(prUrl).catch((error) =>
                    toast.error(
                      typeof error === "string"
                        ? error
                        : "Não foi possível abrir o pull request.",
                    ),
                  )
                }
                className={cn(
                  controle("chip"),
                  "text-git-open transition-colors hover:underline",
                )}
              >
                <GitPullRequest className="size-3.5" /> PR aberto, abrir no GitHub
              </button>
              <button
                type="button"
                onClick={() => setPrUrl(null)}
                aria-label="Fechar aviso do pull request"
                className={cn(
                  controle("chip", { quadrado: true }),
                  "ml-auto text-muted-foreground hover:text-foreground",
                )}
                title="Fechar aviso"
              >
                <Check className="size-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex shrink-0 items-center justify-between border-t border-border/40 px-3 py-2">
              <span className="text-[11px] text-muted-foreground">
                {totalChanges} {totalChanges === 1 ? "arquivo alterado" : "arquivos alterados"}
              </span>
              <button
                type="button"
                onClick={() => setPrOpen(true)}
                className={cn(
                  controle("chip"),
                  "border text-foreground hover:bg-accent",
                )}
              >
                <GitPullRequest className="size-3" /> Abrir pull request
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
