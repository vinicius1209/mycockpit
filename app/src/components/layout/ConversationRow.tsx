import { useEffect, useRef, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  CornerDownRight,
  GitBranch,
  Pencil,
  Rocket,
  Swords,
  Timer,
  Trash2,
} from "lucide-react"
import { AgentMark } from "@/components/common/AgentMark"
import { ColorSubmenu } from "@/components/layout/ColorSubmenu"
import { ConversationSlot } from "@/components/layout/ConversationSlot"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { iniciarArrasto } from "@/components/common/CamadaDeArrasto"
import { controle } from "@/components/ui/controle"
import type { ConversationMeta } from "@/lib/db/conversations"

interface ConversationRowProps {
  c: ConversationMeta
  isChild?: boolean
  branchCount?: number
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  idx: number
  totalCount: number
  projectId: string
  activeId: string | null
  viewMode: string
  defaultAgent: string
  isRunning: boolean
  doneUnseen?: "ok" | "error"
  isDeciding: boolean
  hasFusion: boolean
  hasMission: boolean
  isAwaiting: boolean
  limitStatus?: "stuck" | "cooldown" | "pending"
  hasDraft: boolean
  openConv: (id: string) => void
  moveConversation: (projectId: string, id: string, dir: -1 | 1) => void
  duplicateConversation: (id: string) => void
  toggleWorktree: (id: string, wt: string | null) => void
  askDeleteConv: (id: string, title: string | null, wt: string | null) => void
  renameConversation: (id: string, title: string) => void
  setConversationColor: (id: string, color: string | null) => void
}

export function ConversationRow({
  c,
  isChild = false,
  branchCount = 0,
  isCollapsed = false,
  onToggleCollapse,
  idx,
  totalCount,
  projectId,
  activeId,
  viewMode,
  defaultAgent,
  isRunning,
  doneUnseen,
  isDeciding,
  hasFusion,
  hasMission,
  isAwaiting,
  limitStatus,
  hasDraft,
  openConv,
  moveConversation,
  duplicateConversation,
  toggleWorktree,
  askDeleteConv,
  renameConversation,
  setConversationColor,
}: ConversationRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState("")
  const editInputRef = useRef<HTMLInputElement>(null)

  const isActive = c.id === activeId
  const isFull = isActive && viewMode === "linear"
  const isDimmed = isActive && viewMode !== "linear"

  useEffect(() => {
    if (!isEditing) return
    const frame = requestAnimationFrame(() => {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [isEditing])

  function commitRename() {
    const v = editValue.trim()
    setIsEditing(false)
    if (v) void renameConversation(c.id, v)
  }

  const statusEl =
    hasMission || hasFusion || limitStatus ? (
      <>
        {limitStatus && (
          <span
            className="grid size-3 shrink-0 place-items-center"
            title={
              limitStatus === "stuck"
                ? "Parou num limite de uso, precisa de você"
                : "Aguardando reset do limite, retomando automaticamente"
            }
          >
            <Timer
              className={cn(
                "size-3",
                limitStatus === "stuck"
                  ? "text-st-warning"
                  : "text-muted-foreground/70",
              )}
              aria-label={
                limitStatus === "stuck"
                  ? "limite atingido, precisa de você"
                  : "aguardando reset do limite"
              }
            />
          </span>
        )}
        {hasMission && (
          <span
            className="grid size-3 shrink-0 place-items-center"
            title="Missão rodando"
          >
            <Rocket
              className="size-3 text-muted-foreground"
              aria-label="missão rodando"
            />
          </span>
        )}
        {hasFusion && (
          <span
            className="grid size-3 shrink-0 place-items-center"
            title={
              isDeciding
                ? "Disputa esperando sua decisão"
                : "Disputa em andamento nesta conversa"
            }
          >
            <Swords
              className={cn(
                "size-3",
                isDeciding
                  ? "text-st-warning"
                  : "text-muted-foreground/70",
              )}
              aria-label={
                isDeciding ? "decisão pendente" : "disputa em curso"
              }
            />
          </span>
        )}
      </>
    ) : null

  return (
    <ContextMenu key={c.id}>
      <ContextMenuTrigger asChild>
        <div
          // Arrasto por ponteiro (ADR-214); reordenar também está no menu.
          data-arrasto-alvo={`reordenar:${c.id}`}
          onPointerDown={(event) => {
            if (isEditing) return
            iniciarArrasto(
              event,
              { tipo: "conversa", projectId, id: c.id },
              c.title ?? "Conversa",
            )
          }}
          className={cn(
            "group/c relative flex items-center rounded-md transition-colors",
            isFull
              ? "bg-sel"
              : isDimmed
                ? "bg-sel-hover"
                : "hover:bg-sel-hover",
            isChild && "ml-2.5",
            "data-[arrasto-sobre]:bg-sel",
          )}
          style={
            c.color
              ? {
                  background: `color-mix(in srgb, ${c.color} 12%, ${
                    isFull
                      ? "var(--sel)"
                      : isDimmed
                        ? "var(--sel-hover)"
                        : "transparent"
                  })`,
                }
              : undefined
          }
        >
          {isEditing ? (
            <div className="flex min-w-0 flex-1 items-center py-2 pr-2 pl-10">
              <input
                ref={editInputRef}
                aria-label="Renomear conversa"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename()
                  if (e.key === "Escape") setIsEditing(false)
                }}
                className="min-w-0 flex-1 rounded border border-brass/40 bg-background px-1 py-0.5 text-[12px] text-foreground outline-none"
              />
            </div>
          ) : (
            <>
              <button
              onClick={() => openConv(c.id)}
              title={isDimmed ? "ativa no Linear" : undefined}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 py-2 pr-2 text-left text-[12px]",
                isChild ? "pl-5" : "pl-[18px]",
                isFull
                  ? "font-medium text-foreground"
                  : isDimmed
                    ? "font-normal text-muted-foreground"
                    : "font-normal text-muted-foreground group-hover/c:text-foreground",
              )}
            >
              {isChild ? (
                <CornerDownRight className="size-3 shrink-0 text-muted-foreground/60" />
              ) : null}
              <AgentMark agent={c.agent ?? defaultAgent} />
              <span className="min-w-0 flex-1 truncate">
                {c.title ?? "Nova conversa"}
              </span>

              {hasDraft && (
                <span
                  className="shrink-0 text-[11px] text-faint"
                  title="Há texto ou anexos não enviados nesta conversa"
                >
                  Rascunho
                </span>
              )}
              {c.worktreePath && (
                <GitBranch
                  className="size-3 shrink-0 text-muted-foreground"
                  aria-label="isolado em worktree"
                />
              )}
              {statusEl && (
                <span className="flex shrink-0 items-center gap-1">
                  {statusEl}
                </span>
              )}
              <ConversationSlot
                pede={isAwaiting}
                rodando={isRunning}
                falhou={doneUnseen === "error"}
                updatedAt={c.updatedAt}
              />
              </button>
              {branchCount > 1 && onToggleCollapse && (
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  title="Expandir ou recolher ramos"
                  className={cn(
                    controle("chip"),
                    "mr-1 font-normal text-muted-foreground transition-colors hover:bg-muted",
                  )}
                >
                  <span>{branchCount} ramos</span>
                  <ChevronDown
                    className={cn(
                      "size-3 transition-transform",
                      isCollapsed && "-rotate-90",
                    )}
                  />
                </button>
              )}
            </>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem
          onSelect={() => {
            setEditValue(c.title ?? "")
            setIsEditing(true)
          }}
        >
          <Pencil /> Renomear
        </ContextMenuItem>
        <ColorSubmenu
          current={c.color}
          onPick={(col) => void setConversationColor(c.id, col)}
        />
        <ContextMenuItem onSelect={() => void duplicateConversation(c.id)}>
          <Copy /> Duplicar
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void toggleWorktree(c.id, c.worktreePath)}
        >
          <GitBranch />{" "}
          {c.worktreePath ? "Remover isolamento" : "Isolar em worktree"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={idx === 0}
          onSelect={() => moveConversation(projectId, c.id, -1)}
        >
          <ArrowUp /> Mover para cima
        </ContextMenuItem>
        <ContextMenuItem
          disabled={idx === totalCount - 1}
          onSelect={() => moveConversation(projectId, c.id, 1)}
        >
          <ArrowDown /> Mover para baixo
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          disabled={isRunning}
          onSelect={() => void askDeleteConv(c.id, c.title, c.worktreePath)}
        >
          <Trash2 /> Excluir
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
