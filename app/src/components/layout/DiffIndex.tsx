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
import { publicarStatus } from "@/lib/statusCompartilhado"
import {
  loadGitStatus,
  stageAll,
  unstageAll,
  discardAll,
  type GitStatus,
} from "@/lib/git"
import { OpenInEditor } from "@/components/common/OpenInEditor"
import { CommitComposer } from "./DiffPanel/CommitComposer"
import { BotaoDeSincronia } from "./DiffPanel/BotaoDeSincronia"
import { ConflitoDoGit } from "./DiffPanel/ConflitoDoGit"
import { FaixaDoGit } from "./DiffPanel/FaixaDoGit"
import { HistoricoGit } from "./DiffPanel/HistoricoGit"
import { SeletorDeBranch } from "./DiffPanel/SeletorDeBranch"
import { estadoDoRepo, idadeDaBusca, type EstadoDoRepo } from "@/lib/gitSync"
import { useGitSync } from "@/store/gitSync"
import { useAlteracoesVivas } from "./DiffPanel/useAlteracoesVivas"
import { GitSection, GitFileList } from "./DiffPanel/GitSection"
import { PrComposer } from "./DiffPanel/shipBar"
import { openUrl } from "@tauri-apps/plugin-opener"
import { useApp } from "@/store/app"
import { controle } from "@/components/ui/controle"
import { confirm } from "@/lib/confirm"
import { avisar, mensagemDe } from "@/lib/avisos"
import { cn } from "@/lib/utils"

/** Última leitura por pasta: trocar de aba e voltar mostra a lista na hora
 *  (sem spinner) e relê por trás. Antes cada troca desmontava a aba, zerava o
 *  estado e rodava ~6 comandos git com a tela vazia. */
const ultimaLeitura = new Map<string, GitStatus>()
const ultimoEstado = new Map<string, EstadoDoRepo>()

export function DiffIndex({
  cwd,
  delivery,
  onRequestFix,
  onCloseDelivery,
  onPedirAoAgente,
}: {
  cwd: string
  delivery?: { text: string } | null
  onRequestFix?: () => void
  onCloseDelivery?: () => void
  /** Escreve no composer da conversa ativa, sem enviar. */
  onPedirAoAgente?: (texto: string) => void
}) {
  const [status, setStatus] = useState<GitStatus | null>(() => ultimaLeitura.get(cwd) ?? null)
  const [estado, setEstado] = useState<EstadoDoRepo | null>(() => ultimoEstado.get(cwd) ?? null)
  const faixa = useGitSync((s) => s.faixa[cwd])
  const executar = useGitSync((s) => s.executar)
  const [loading, setLoading] = useState(true)
  // Uma leitura por vez: pedido que chega no meio vira UMA releitura no fim,
  // em vez de empilhar processos git (cliques rápidos, rajada de sinais).
  const lendo = useRef(false)
  const pendente = useRef(false)
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
    if (lendo.current) {
      pendente.current = true
      return
    }
    lendo.current = true
    const epoch = ++loadEpoch.current
    const pasta = cwd
    setLoading(true)
    setLoadError(null)
    // O estado do repositório (remoto, busca, conflito) é acessório: sem ele
    // a aba segue mostrando as alterações, só sem os gestos de sincronia.
    void Promise.all([loadGitStatus(pasta), estadoDoRepo(pasta).catch(() => null)])
      .then(([next, repo]) => {
        ultimaLeitura.set(pasta, next)
        publicarStatus(pasta, next)
        if (repo) ultimoEstado.set(pasta, repo)
        if (loadEpoch.current !== epoch) return
        setStatus(next)
        setEstado(repo)
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
        lendo.current = false
        if (loadEpoch.current === epoch) setLoading(false)
        if (pendente.current) {
          pendente.current = false
          reload()
        }
      })
  }

  useEffect(() => {
    // Pasta nova: mostra a última lista conhecida dela (ou nada) e relê.
    setStatus(ultimaLeitura.get(cwd) ?? null)
    setEstado(ultimoEstado.get(cwd) ?? null)
    pendente.current = false
    lendo.current = false
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])
  // Relê sozinha quando a pasta pode ter mudado: fim de turno, ação que muda
  // arquivo, volta à janela. A lista atual fica na tela enquanto lê.
  useAlteracoesVivas(cwd, reload)

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
      avisar.feito("Todas as alterações foram preparadas para commit")
      reload()
    } catch (e) {
      avisar.erro("Não consegui preparar as alterações.", { detalhe: mensagemDe(e) })
    }
  }

  async function handleUnstageAll() {
    try {
      await unstageAll(cwd)
      avisar.feito("Todas as alterações saíram da preparação")
      reload()
    } catch (e) {
      avisar.erro("Não consegui desfazer a preparação.", { detalhe: mensagemDe(e) })
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
      avisar.feito("Alterações não preparadas descartadas")
      reload()
    } catch (e) {
      avisar.erro("Não consegui descartar as alterações.", { detalhe: mensagemDe(e) })
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
              <SeletorDeBranch cwd={cwd} branch={status.branch} alteracoes={totalChanges} />
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

            <BotaoDeSincronia cwd={cwd} status={status} estado={estado} now={Date.now()} />
          </div>

          {status.upstream && status.behind > 0 && estado && (
            <p className="shrink-0 px-3 pt-1.5 text-[11px] text-muted-foreground">
              ↓{status.behind} desde a busca {idadeDaBusca(estado.ultimaBusca, Date.now())}
            </p>
          )}

          {faixa && <FaixaDoGit cwd={cwd} faixa={faixa} status={status} />}

          {estado?.operacao ? (
            <ConflitoDoGit
              cwd={cwd}
              estado={{ ...estado, operacao: estado.operacao }}
              onPedirAoAgente={onPedirAoAgente}
            />
          ) : (
            <CommitComposer
              cwd={cwd}
              stagedCount={staged.length}
              totalChanges={totalChanges}
              onCommitted={reload}
              onEnviar={
                estado?.temRemoto
                  ? () => void executar(cwd, status.upstream ? "enviar" : "publicar")
                  : undefined
              }
            />
          )}

          {/* Área com rolagem contendo as seções de arquivos */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {totalChanges === 0 ? (
              <div className="px-6 py-14 text-center text-[12px] text-muted-foreground">
                Nenhuma alteração pendente. A árvore de trabalho está limpa.
              </div>
            ) : (
              <div className="flex flex-col">
                {/* Seção 1: Staged Changes. Vazia ela não aparece: um
                    cabeçalho mais "nenhum arquivo" só empurrava a lista que
                    importa pra baixo. Ela nasce quando algo é preparado. */}
                {staged.length > 0 && (
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
                )}

                {/* Seção 2: Changes (Unstaged). Mesma regra: vazia, não aparece. */}
                {unstaged.length > 0 && (
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
                )}
              </div>
            )}
            <HistoricoGit
              cwd={cwd}
              versao={`${status.branch}:${status.ahead}:${status.behind}:${totalChanges}`}
              activeCommitHash={mainTab.kind === "diff" ? mainTab.commitHash : undefined}
              onSelectCommit={(hash, caminho) => openDiffTab(caminho, hash)}
            />
          </div>

          {/* Rodapé: Abrir Pull Request ou link de PR aberto */}
          {prUrl ? (
            <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2 text-[12px]">
              <button
                type="button"
                onClick={() =>
                  void openUrl(prUrl).catch((error) =>
                    avisar.erro("Não consegui abrir o pull request.", { detalhe: mensagemDe(error) }),
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
            <div className="flex shrink-0 items-center justify-end border-t border-border/40 px-3 py-2">
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
