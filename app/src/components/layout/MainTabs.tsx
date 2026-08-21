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

import {
  Command,
  Copy,
  FileDiff,
  GitFork,
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
import { latestCompletedTurnId, mainTabEntries, type MainTab } from "@/lib/mainTabs"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

const ICONE = {
  conversa: MessageSquare,
  diff: FileDiff,
} as const

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
  const newConversation = useChat((s) => s.newConversation)
  const duplicateConversation = useChat((s) => s.duplicateConversation)
  const forkConversationAt = useChat((s) => s.forkConversationAt)
  const forkTargetId = useChat((s) => {
    const conv = s.activeId ? s.byId[s.activeId] : null
    if (!conv || conv.running || conv.finalizing) return null
    return latestCompletedTurnId(conv.items)
  })

  const entries = mainTabEntries(tab)
  const commandShortcut = commandMenuShortcut(currentPlatform())

  return (
    <div
      className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1"
    >
      <div role="tablist" aria-label="Abas do painel" className="flex items-center gap-1">
        {entries.map((e) => {
          const Icone = ICONE[e.kind]
          const ativa = e.kind === tab.kind
          return (
            <div
              key={e.kind}
              className={cn(
                "group/aba flex h-[26px] items-center rounded-md transition-colors",
                ativa ? "bg-sel" : "hover:bg-sel-hover",
              )}
            >
              <button
                role="tab"
                aria-selected={ativa}
                onClick={() => onSelect(e.kind)}
                className={cn(
                  "flex h-full items-center gap-1.5 rounded-md pl-2 text-[11px] font-medium transition-colors",
                  e.closable ? "pr-1" : "pr-2",
                  ativa
                    ? "text-foreground"
                    : "text-muted-foreground/50 group-hover/aba:text-muted-foreground",
                )}
              >
                <Icone className="size-3.5 shrink-0" />
                {e.label}
              </button>
              {e.closable && (
                // O × só aparece no hover ou com foco: fechar é gesto ocasional, e
                // um × permanente numa tira de 26px compete com o rótulo, que é o
                // que você lê pra escolher.
                <button
                  onClick={() => onClose(e.kind)}
                  title={`Fechar ${e.label}`}
                  aria-label={`Fechar ${e.label}`}
                  className="mr-1 rounded p-0.5 text-transparent transition-colors group-hover/aba:text-muted-foreground/60 hover:!text-foreground focus-visible:text-muted-foreground/60"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          )
        })}
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
          className="w-52 border-border/60"
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
            Fork do último turno
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-border/60" />
          <DropdownMenuItem onSelect={openCommandMenu} className="text-[12px]">
            <Command />
            Todos os comandos
            <DropdownMenuShortcut className="normal-case tracking-normal">
              {commandShortcut}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
