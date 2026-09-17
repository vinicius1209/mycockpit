// A tira de abas do painel principal (docs/abas-no-principal-plan.md, F1.1).
//
// A conversa é a ÂNCORA desta superfície: a tira continua visível mesmo quando
// nenhuma aba transitória está aberta. Assim "Alterações" pode entrar e sair
// sem fazer a navegação inteira nascer/sumir, e o + mantém ações da conversa no
// mesmo lugar em todos os estados.
//
// Régua visual emprestada do `TabBtn` do painel direito de propósito: é a mesma
// gramática ("qual superfície estou vendo"), e inventar um segundo desenho pra
// ela seria dois idiomas pro mesmo gesto.

import { StickyNotesToggle } from "@/components/notes/StickyNotesTrigger"
import { useMemo } from "react"
import {
  Columns2,
  Command,
  Copy,
  File,
  FileDiff,
  GitFork,
  Globe,
  MessageSquare,
  MessageSquarePlus,
  Plus,
  X,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { commandMenuShortcut, currentPlatform, openCommandMenu } from "@/lib/commandMenu"
import { latestCompletedTurnId, type MainTab } from "@/lib/mainTabs"
import {
  EMPTY_CONVERSATIONS,
  getConversationFamily,
} from "@/components/layout/conversationTree"
import { controle } from "@/components/ui/controle"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

export function MainTabs({
  tab,
  onSelect,
  onClose,
}: {
  tab: MainTab
  onSelect: (kind: MainTab["kind"]) => void
  onClose: (kind: MainTab["kind"]) => void
}) {
  const activeProjectId = useApp((s) => s.activeProjectId)
  const activeId = useChat((s) => s.activeId)
  const switchConversation = useChat((s) => s.switchConversation)
  const newConversation = useChat((s) => s.newConversation)
  const duplicateConversation = useChat((s) => s.duplicateConversation)
  const forkConversationAt = useChat((s) => s.forkConversationAt)
  const conversations =
    useChat((s) =>
      activeProjectId ? s.conversationsByProject[activeProjectId] : undefined,
    ) ?? EMPTY_CONVERSATIONS
  const branchSplitOpen = useApp((s) => s.branchSplitOpen)
  const openBrowserTab = useApp((s) => s.openBrowserTab)
  const toggleBranchSplit = useApp((s) => s.toggleBranchSplit)

  const forkTargetId = useChat((s) => {
    const conv = s.activeId ? s.byId[s.activeId] : null
    if (!conv || conv.running || conv.finalizing) return null
    return latestCompletedTurnId(conv.items)
  })

  const family = useMemo(
    () => getConversationFamily(conversations, activeId),
    [conversations, activeId],
  )
  const hasBranches = Boolean(family && family.branches.length > 1)
  const commandShortcut = commandMenuShortcut(currentPlatform())
  const transient =
    tab.kind === "diff"
      ? { kind: tab.kind, label: "Alterações", title: "Alterações", Icon: FileDiff }
      : tab.kind === "navegador"
        ? { kind: tab.kind, label: "Navegador", title: "Navegador do projeto", Icon: Globe }
        : tab.kind === "arquivo"
        ? {
            kind: tab.kind,
            label: tab.path.split("/").pop() || tab.path,
            title: tab.path,
            Icon: File,
          }
        : null

  return (
    <div
      className="flex shrink-0 items-center gap-1 border-b border-border/40 px-2 py-1"
    >
      <div role="tablist" aria-label="Abas do painel" className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {hasBranches && family ? (
          family.branches.map((branch, idx) => {
            const isBranchActive = branch.id === activeId && tab.kind === "conversa"
            const label = idx === 0 ? "Original" : (branch.title ?? `Fork ${idx}`)
            return (
              <div
                key={branch.id}
                className={cn(
                  "group/aba flex h-[26px] items-center rounded-md transition-colors",
                  isBranchActive ? "bg-sel" : "hover:bg-sel-hover",
                )}
              >
                <button
                  role="tab"
                  aria-selected={isBranchActive}
                  onClick={() => {
                    if (tab.kind !== "conversa") onSelect("conversa")
                    void switchConversation(branch.id)
                  }}
                  className={cn(
                    "flex h-full items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors",
                    isBranchActive
                      ? "text-foreground"
                      : "text-muted-foreground/50 group-hover/aba:text-muted-foreground",
                  )}
                >
                  <MessageSquare className="size-3.5 shrink-0" />
                  <span className="max-w-[120px] truncate">{label}</span>
                </button>
              </div>
            )
          })
        ) : (
          <div
            className={cn(
              "group/aba flex h-[26px] items-center rounded-md transition-colors",
              tab.kind === "conversa" ? "bg-sel" : "hover:bg-sel-hover",
            )}
          >
            <button
              role="tab"
              aria-selected={tab.kind === "conversa"}
              onClick={() => onSelect("conversa")}
              className={cn(
                "flex h-full items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors",
                tab.kind === "conversa"
                  ? "text-foreground"
                  : "text-muted-foreground/50 group-hover/aba:text-muted-foreground",
              )}
            >
              <MessageSquare className="size-3.5 shrink-0" />
              Conversa
            </button>
          </div>
        )}
        {transient && (
          <div
            className="group/aba flex h-[26px] items-center rounded-md bg-sel transition-colors"
          >
            <button
              role="tab"
              aria-selected
              onClick={() => onSelect(transient.kind)}
              title={transient.title}
              className="flex h-full items-center gap-1.5 rounded-md pl-2 pr-1 text-[11px] font-medium text-foreground transition-colors"
            >
              <transient.Icon className="size-3.5 shrink-0" />
              <span className="max-w-[180px] truncate">{transient.label}</span>
            </button>
            <button
              onClick={() => onClose(transient.kind)}
              title={`Fechar ${transient.label}`}
              aria-label={`Fechar ${transient.label}`}
              className="mr-1 rounded p-0.5 text-transparent transition-colors group-hover/aba:text-muted-foreground/60 hover:!text-foreground focus-visible:text-muted-foreground/60"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="Ações da conversa"
            aria-label="Ações da conversa"
            className="grid size-[26px] shrink-0 place-items-center rounded-md text-muted-foreground/55 outline-none transition-colors hover:bg-sel-hover hover:text-foreground focus-visible:bg-sel focus-visible:text-foreground data-[state=open]:bg-sel data-[state=open]:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="w-52 border-border/40"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Conversa
          </DropdownMenuLabel>
          <DropdownMenuItem
            disabled={!activeProjectId}
            onSelect={() => {
              if (activeProjectId) void newConversation(activeProjectId)
            }}
            className="text-[12px]"
          >
            <MessageSquarePlus />
            Nova tarefa
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!activeId}
            onSelect={() => {
              if (activeId) void duplicateConversation(activeId)
            }}
            className="text-[12px]"
          >
            <Copy />
            Duplicar conversa
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!activeId || !forkTargetId}
            title="Cria uma nova conversa em um worktree isolado a partir do último turno concluído"
            onSelect={() => {
              if (activeId && forkTargetId) {
                void forkConversationAt(activeId, forkTargetId)
              }
            }}
            className="text-[12px]"
          >
            <GitFork />
            Bifurcar do último turno
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-border/40" />
          <DropdownMenuItem
            disabled={!activeProjectId}
            onSelect={openBrowserTab}
            className="text-[12px]"
          >
            <Globe />
            Abrir navegador
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openCommandMenu} className="text-[12px]">
            <Command />
            Todos os comandos
            <DropdownMenuShortcut className="normal-case tracking-normal">
              {commandShortcut}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {hasBranches && (
          <button
            type="button"
            onClick={toggleBranchSplit}
            title={
              branchSplitOpen
                ? "Fechar visualização dividida de ramos"
                : "Dividir tela para comparar ramos"
            }
            className={cn(
              controle("chip"),
              "ml-auto font-normal transition-colors",
              branchSplitOpen
                ? "bg-sel text-foreground"
                : "text-muted-foreground/70 hover:bg-sel-hover hover:text-foreground",
            )}
          >
            <Columns2 className="size-3.5 shrink-0" />
            <span>Comparar ramos</span>
          </button>
        )}
        <StickyNotesToggle />
      </div>
    </div>
  )
}
