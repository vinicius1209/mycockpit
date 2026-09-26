import { useEffect, useMemo } from "react"
import {
  CornerDownRight,
  GitBranch,
  MessageSquare,
  Trash2,
  X,
} from "lucide-react"
import { avisar } from "@/lib/avisos"
import { Markdown } from "@/components/common/Markdown"
import { AgentMark } from "@/components/common/AgentMark"
import { Button } from "@/components/ui/button"
import { controle } from "@/components/ui/controle"
import {
  EMPTY_CONVERSATIONS,
  getConversationFamily,
} from "@/components/layout/conversationTree"
import { confirm } from "@/lib/confirm"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"
import { useChat, type ChatItem } from "@/store/chat"

function BranchStreamColumn({
  convId,
  title,
  isRoot,
  isActive,
  worktreePath,
  agent,
  onActivate,
  onDiscard,
}: {
  convId: string
  title: string
  isRoot: boolean
  isActive: boolean
  worktreePath: string | null
  agent: string | null
  onActivate: () => void
  onDiscard?: () => void
}) {
  const conv = useChat((s) => s.byId[convId])
  const defaultAgent = useApp((s) => s.settings.defaultAgent)
  const items: ChatItem[] = conv?.items ?? []

  return (
    <div className="flex flex-1 min-w-0 flex-col border-r border-border/40 last:border-r-0 bg-background">
      {/* Cabeçalho do Ramo */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-4 py-2 bg-muted/20">
        <div className="flex min-w-0 items-center gap-2">
          {isRoot ? (
            <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <CornerDownRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          <AgentMark agent={agent ?? defaultAgent} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-medium text-foreground">
                {title}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {isRoot ? "original" : "ramo"}{isActive ? " · ativo" : ""}
              </span>
            </div>
            {worktreePath && (
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground/80">
                <GitBranch className="size-3 shrink-0" />
                <span className="truncate" title={worktreePath}>
                  {worktreePath.split("/").pop()}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {!isActive && (
            <button
              type="button"
              onClick={onActivate}
              className={cn(
                controle("chip"),
                "font-normal text-muted-foreground hover:text-foreground hover:bg-sel-hover",
              )}
            >
              Focar
            </button>
          )}
          {onDiscard && (
            <Button
              size="chip"
              variant="ghost"
              onClick={onDiscard}
              title="Descartar este fork e limpar o worktree"
              className="text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="size-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Conteúdo de Mensagens do Ramo */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {!conv ? (
          <div className="flex h-32 items-center justify-center text-[12px] text-muted-foreground">
            Carregando conversa…
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-[12px] text-muted-foreground">
            Nenhuma mensagem registrada neste ramo.
          </div>
        ) : (
          items.map((item) => {
            if (item.kind === "user") {
              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-border/40 bg-muted/30 p-3"
                >
                  <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
                    Você
                  </div>
                  <div className="text-[13px] text-foreground whitespace-pre-wrap">
                    {item.text}
                  </div>
                </div>
              )
            }
            if (item.kind === "result") {
              return (
                <div key={item.id} className="p-1 text-[13px] leading-relaxed">
                  <Markdown text={item.text ?? ""} />
                </div>
              )
            }
            return null
          })
        )}
      </div>
    </div>
  )
}

export function BranchSplitView() {
  const activeProjectId = useApp((s) => s.activeProjectId)
  const activeId = useChat((s) => s.activeId)
  const switchConversation = useChat((s) => s.switchConversation)
  const removeConversation = useChat((s) => s.removeConversation)
  const ensureConversationLoaded = useChat((s) => s.ensureConversationLoaded)
  const setBranchSplitOpen = useApp((s) => s.setBranchSplitOpen)

  const conversations =
    useChat((s) =>
      activeProjectId ? s.conversationsByProject[activeProjectId] : undefined,
    ) ?? EMPTY_CONVERSATIONS

  const family = useMemo(
    () => getConversationFamily(conversations, activeId),
    [conversations, activeId],
  )

  const rootConv = family?.root ?? null
  const activeFork = family
    ? (family.branches.find(
        (branch) => branch.id === activeId && branch.id !== family.root.id,
      ) ??
      family.branches.find((branch) => branch.id !== family.root.id) ??
      null)
    : null

  useEffect(() => {
    if (!activeProjectId || !rootConv || !activeFork) return
    void Promise.all([
      ensureConversationLoaded(activeProjectId, rootConv.id),
      ensureConversationLoaded(activeProjectId, activeFork.id),
    ]).catch((error) => {
      console.error("[branch-split] não consegui carregar os ramos", error)
      avisar.erro("Não consegui carregar as conversas para comparar")
    })
  }, [activeFork, activeProjectId, ensureConversationLoaded, rootConv])

  if (!family || !rootConv || family.branches.length <= 1) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <GitBranch className="size-8 text-muted-foreground/40 mb-2" />
        <h3 className="text-[14px] font-medium text-foreground">
          Nenhum ramo para comparar
        </h3>
        <p className="mt-1 text-[12px] text-muted-foreground max-w-sm">
          Esta conversa não possui bifurcações. Use o botão + na barra superior e
          escolha Bifurcar do último turno para criar um novo ramo.
        </p>
        <Button
          size="padrao"
          variant="outline"
          onClick={() => setBranchSplitOpen(false)}
          className="mt-4"
        >
          Voltar ao chat
        </Button>
      </div>
    )
  }
  const rootId = rootConv.id

  async function handleDiscardFork(forkId: string, wt: string | null) {
    const ok = await confirm({
      title: "Descartar ramo?",
      description: wt
        ? "O histórico deste fork será excluído e o worktree isolado será removido do disco. Esta ação não pode ser desfeita."
        : "O histórico deste fork será excluído. Esta ação não pode ser desfeita.",
      confirmLabel: "Descartar",
      danger: true,
    })
    if (!ok) return

    // A store é a dona única desta limpeza: encerra trabalhos e remove
    // histórico, anexos e worktree sem uma segunda tentativa concorrente.
    await removeConversation(forkId)
    void switchConversation(rootId)
    setBranchSplitOpen(false)
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Barra de Ações do Split */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-4 py-1.5 bg-muted/40">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <GitBranch className="size-3.5 text-foreground" />
          <span className="font-medium text-foreground">
            Comparar ramos
          </span>
          <span>·</span>
          <span>original e alternativa</span>
        </div>
        <button
          type="button"
          onClick={() => setBranchSplitOpen(false)}
          title="Fechar comparação"
          className={cn(
            controle("chip"),
            "font-normal text-muted-foreground hover:text-foreground hover:bg-sel-hover",
          )}
        >
          <X className="size-3.5" />
          <span>Fechar comparação</span>
        </button>
      </div>

      {/* As Duas Colunas Lado a Lado */}
      <div className="flex flex-1 min-h-0 divide-x divide-border/40">
        <BranchStreamColumn
          convId={rootConv.id}
          title={rootConv.title ?? "Conversa original"}
          isRoot
          isActive={rootConv.id === activeId}
          worktreePath={rootConv.worktreePath}
          agent={rootConv.agent}
          onActivate={() => void switchConversation(rootConv.id)}
        />

        {activeFork && (
          <BranchStreamColumn
            convId={activeFork.id}
            title={activeFork.title ?? "Ramo alternativo"}
            isRoot={false}
            isActive={activeFork.id === activeId}
            worktreePath={activeFork.worktreePath}
            agent={activeFork.agent}
            onActivate={() => void switchConversation(activeFork.id)}
            onDiscard={() =>
              void handleDiscardFork(activeFork.id, activeFork.worktreePath)
            }
          />
        )}
      </div>
    </div>
  )
}
