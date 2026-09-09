import { memo, useState, type KeyboardEvent } from "react"
import { Check, Circle, CircleDot, ListChecks, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { taskStatusForDisplay, type AgentTask } from "@/lib/tasks"

function TaskRow({
  task,
  first,
  live = false,
}: {
  task: AgentTask
  first: boolean
  live?: boolean
}) {
  const [open, setOpen] = useState(false)
  const status = taskStatusForDisplay(task, live)
  const isExecuting = status === "in_progress"
  const isUnsettled = status === "unsettled"
  const tooltip =
    [isUnsettled ? "Sem conclusão registrada" : null, task.description]
      .filter(Boolean).join(" · ") || undefined

  return (
    <li>
      <button
        onClick={() => task.description && setOpen((o) => !o)}
        data-work-task
        aria-expanded={task.description ? open : undefined}
        tabIndex={first ? 0 : -1}
        className={cn(
          "flex w-full items-start gap-1.5 rounded px-1 py-1 text-left text-[12px]",
          task.description && "hover:bg-sel-hover",
        )}
        title={tooltip}
      >
        <span
          className="mt-0.5 grid size-3.5 shrink-0 place-items-center"
          role={isUnsettled ? "img" : undefined}
          aria-label={isUnsettled ? "Sem conclusão registrada" : undefined}
        >
          {task.status === "completed" ? (
            <Check className="size-3.5 text-muted-foreground/60" />
          ) : isExecuting ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : isUnsettled ? (
            <CircleDot className="size-3 text-muted-foreground/60" />
          ) : (
            <Circle className="size-2.5 text-muted-foreground/40" />
          )}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 leading-snug break-words",
            task.status === "completed"
              ? "text-muted-foreground"
              : isExecuting
                ? "text-foreground"
                : isUnsettled
                  ? "text-foreground/85"
                  : "text-foreground/75",
          )}
        >
          {isExecuting && task.active ? task.active : task.title}
        </span>
      </button>
      {open && task.description && (
        <p className="mt-0.5 mb-1 ml-[22px] text-[12px] leading-relaxed break-words text-muted-foreground">
          {task.description}
        </p>
      )}
    </li>
  )
}

/** Checklist do agent (derivada de TaskCreate/TaskUpdate). Durante o turno, a
 * faixa acima do composer é a fonte viva; no transcript só reaparece sob demanda
 * depois que o plano encerra. A aba Plano reutiliza a versão mais recente. */
export const TaskChecklist = memo(function TaskChecklist({
  tasks,
  dense,
  live = false,
}: {
  tasks: AgentTask[]
  dense?: boolean
  live?: boolean
}) {
  const done = tasks.filter((t) => t.status === "completed").length
  function navigate(e: KeyboardEvent<HTMLOListElement>) {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-work-task]")
    if (!target) return
    const rows = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("[data-work-task]"),
    )
    const index = rows.indexOf(target)
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const delta = e.key === "ArrowDown" ? 1 : -1
      rows[Math.max(0, Math.min(rows.length - 1, index + delta))]?.focus()
    } else if (
      e.key === "ArrowRight" &&
      target.getAttribute("aria-expanded") === "false"
    ) {
      e.preventDefault()
      target.click()
    } else if (
      e.key === "ArrowLeft" &&
      target.getAttribute("aria-expanded") === "true"
    ) {
      e.preventDefault()
      target.click()
    }
  }
  return (
    <div className={cn(!dense && "rounded-xl border bg-card px-3.5 py-2.5")}>
      {!dense && (
        <div className="mb-1.5 flex items-center gap-2">
          <ListChecks className="size-3.5 text-brass" />
          <span className="label-mono text-foreground/80">Plano</span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {done}/{tasks.length}
          </span>
        </div>
      )}
      <ol
        aria-label="Etapas do plano"
        className="flex flex-col gap-0.5"
        onKeyDown={navigate}
      >
        {tasks.map((t, index) => (
          <TaskRow key={t.id} task={t} first={index === 0} live={live} />
        ))}
      </ol>
    </div>
  )
})
