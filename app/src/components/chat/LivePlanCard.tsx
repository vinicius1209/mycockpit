import { useId, useMemo, useState, type KeyboardEvent } from "react"
import { Check, ChevronDown, ListChecks, Loader2 } from "lucide-react"
import { TaskChecklist } from "@/components/chat/TaskChecklist"
import { taskPlansOf } from "@/lib/tasks"
import { cn } from "@/lib/utils"
import type { ChatItem } from "@/store/chat"

/** Instrumento vivo do turno, junto ao composer. A checklist pode aparecer aqui
 *  OU no painel Plano; o resumo permanece para não esconder o estado atual. */
export function LivePlanCard({
  items,
  running,
  finalizing,
  detailInSidebar,
}: {
  items: ChatItem[]
  running: boolean
  finalizing: boolean
  /** A aba Plano do painel direito já é dona da checklist detalhada. */
  detailInSidebar: boolean
}) {
  const livePlan = useMemo(() => taskPlansOf(items).live, [items])
  const tasks = livePlan?.tasks ?? []
  const done = tasks.filter((task) => task.status === "completed").length
  const current = tasks.find((task) => task.status === "in_progress")
  const next = tasks.find((task) => task.status === "pending")
  const [collapsedPlanId, setCollapsedPlanId] = useState<string | null>(null)
  const checklistId = useId()
  const visible = tasks.length > 0 && livePlan != null && (running || finalizing)
  // Plano novo nasce aberto. A escolha manual de recolher vale só para aquele
  // plano; a aba lateral toma o detalhe sem apagar essa escolha.
  const open =
    livePlan != null && collapsedPlanId !== livePlan.id && !detailInSidebar

  if (!visible) return null

  function onHeaderKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowRight" && !open) {
      event.preventDefault()
      setCollapsedPlanId(null)
    } else if (event.key === "ArrowLeft" && open) {
      event.preventDefault()
      setCollapsedPlanId(livePlan.id)
    } else if (event.key === "ArrowDown" && open) {
      event.preventDefault()
      event.currentTarget.parentElement
        ?.querySelector<HTMLElement>("[data-work-task]")
        ?.focus()
    }
  }

  return (
    <div className="mx-auto mb-2 max-w-[760px] px-8">
      <div className="overflow-hidden rounded-lg border bg-card/95 shadow-[var(--shadow-pop)]">
        <button
          type="button"
          onClick={() => setCollapsedPlanId(open ? livePlan.id : null)}
          onKeyDown={onHeaderKeyDown}
          disabled={detailInSidebar}
          aria-expanded={detailInSidebar ? undefined : open}
          aria-controls={detailInSidebar ? undefined : checklistId}
          data-plan-detail={detailInSidebar ? "sidebar" : "composer"}
          title={detailInSidebar ? "Etapas abertas no painel Plano" : undefined}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] disabled:cursor-default"
        >
          {current && (running || finalizing) ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-brass" />
          ) : !next ? (
            <Check className="size-3.5 shrink-0 text-st-success" />
          ) : (
            <ListChecks className="size-3.5 shrink-0 text-brass" />
          )}
          <span className="truncate text-foreground/85">
            {current
              ? (current.active ?? current.title)
              : next
                ? `Próxima: ${next.title}`
                : "Plano concluído"}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {done}/{tasks.length}
          </span>
          {!detailInSidebar && (
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          )}
        </button>
        {open && !detailInSidebar && (
          <div
            id={checklistId}
            className="max-h-56 overflow-y-auto border-t px-3 py-2"
          >
            {!current && next && (
              <p className="mb-1.5 px-1 text-[11px] text-muted-foreground/70">
                O agente ainda não informou qual etapa está em andamento.
              </p>
            )}
            <TaskChecklist tasks={tasks} dense />
          </div>
        )}
      </div>
    </div>
  )
}
