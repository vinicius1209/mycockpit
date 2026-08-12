// E1 — Ações e átomos COMPARTILHADOS do card do board: BoardLane (colunas) e
// CardDetailDialog (detalhe) renderizam as MESMAS ações, guardadas pelo mesmo
// caminho de estado (move/closeCard/dispatch do store — nada de máquina
// paralela aqui). Extraído do BoardLane pra fonte única, não duplicação.

import { useState } from "react"
import { toast } from "sonner"
import { useApp } from "@/store/app"
import { useCards } from "@/store/cards"
import type { CardRecord, CardState } from "@/lib/db"
import { focusConsoleComposer } from "@/lib/focusComposer"
import { cn } from "@/lib/utils"

/** Rótulo pt-BR de cada estado (badge do card). */
export const STATE_LABEL: Record<CardState, string> = {
  backlog: "backlog",
  working: "em andamento",
  review: "em revisão",
  blocked: "bloqueado",
  done: "feito",
  cancelled: "cancelado",
}

/** Executa uma ação do board; violação de gate/transição vira toast, não
 *  crash. Retorna se a ação COMPLETOU (o caller decide limpar formulário etc). */
export async function tryAction(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn()
    return true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Ação inválida no board")
    return false
  }
}

/** Inicia o card (S1.4, gesto humano): dispatch cria a conversa nova, liga,
 *  vira working e deixa a intenção (título+body) como rascunho do composer —
 *  depois navega até ela (newConversation já a abriu no chat) e foca o
 *  composer com o cursor no fim (mesmo helper do App: focusConsoleComposer). */
export async function startCard(card: CardRecord): Promise<void> {
  await tryAction(async () => {
    const convId = await useCards.getState().dispatch(card.id)
    if (!convId) return
    const app = useApp.getState()
    app.setActiveProject(card.projectId)
    app.setViewMode("linear")
    setTimeout(focusConsoleComposer, 140)
  })
}

/** Badge de estado do card — MESMO visual nas colunas e no detalhe. */
export function CardStateBadge({ state }: { state: CardState }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded border px-1.5 py-px text-[11px] tracking-wide uppercase",
        state === "blocked"
          ? "border-st-error/50 bg-st-error/10 text-st-error"
          : state === "review"
            ? "border-st-warning/50 bg-st-warning/10 text-st-warning"
            : "border-border text-muted-foreground",
      )}
    >
      {STATE_LABEL[state]}
    </span>
  )
}

export function LaneAction({
  children,
  tone = "ghost",
  disabled,
  onClick,
}: {
  children: React.ReactNode
  tone?: "brass" | "ghost"
  disabled?: boolean
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "disabled:opacity-40",
        "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors",
        tone === "brass"
          ? "bg-brass text-background hover:opacity-90"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

/** As ações por estado do card (Iniciar/Cancelar, Revisão/Bloqueado,
 *  Concluir/Retomar) — fonte única pro BoardCard e pro rodapé do detalhe.
 *  Terminal não renderiza nada (histórico fechado não tem ação). */
export function CardStateActions({
  card,
  archivedProject,
  className,
}: {
  card: CardRecord
  /** F-E: projeto arquivado não ganha conversa nova (Iniciar desabilitado);
   *  closeCard segue permitido — encerrar intenção órfã é gesto legítimo. */
  archivedProject: boolean
  className?: string
}) {
  const move = useCards((s) => s.move)
  const close = useCards((s) => s.closeCard)
  // D2: além da guarda in-flight do store, o botão trava enquanto o dispatch
  // voa — duplo-clique não cria segunda conversa nem pisca estado.
  const [starting, setStarting] = useState(false)
  if (card.state === "done" || card.state === "cancelled") return null
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {card.state === "backlog" && (
        <>
          <LaneAction
            tone="brass"
            disabled={starting || archivedProject}
            onClick={(e) => {
              e.stopPropagation()
              if (starting || archivedProject) return
              setStarting(true)
              void startCard(card).finally(() => setStarting(false))
            }}
          >
            {starting ? "Iniciando…" : "Iniciar"}
          </LaneAction>
          <LaneAction
            onClick={(e) => {
              e.stopPropagation()
              void tryAction(() => close(card.id, "cancelled"))
            }}
          >
            Cancelar
          </LaneAction>
        </>
      )}
      {card.state === "working" && (
        <>
          <LaneAction
            onClick={(e) => {
              e.stopPropagation()
              void tryAction(() => move(card.id, "review"))
            }}
          >
            Revisão
          </LaneAction>
          <LaneAction
            onClick={(e) => {
              e.stopPropagation()
              void tryAction(() => move(card.id, "blocked"))
            }}
          >
            Bloqueado
          </LaneAction>
        </>
      )}
      {(card.state === "review" || card.state === "blocked") && (
        <>
          <LaneAction
            tone="brass"
            onClick={(e) => {
              e.stopPropagation()
              void tryAction(() => close(card.id, "done"))
            }}
          >
            Concluir
          </LaneAction>
          <LaneAction
            onClick={(e) => {
              e.stopPropagation()
              void tryAction(() => move(card.id, "working"))
            }}
          >
            Retomar
          </LaneAction>
        </>
      )}
    </div>
  )
}
