import { memo, useState } from "react"
import { Check, Circle, ListChecks, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AgentTask } from "@/lib/tasks"

function TaskRow({ task }: { task: AgentTask }) {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <button
        onClick={() => task.description && setOpen((o) => !o)}
        className={cn(
          "flex w-full items-start gap-2 rounded px-1 py-[3px] text-left text-[12.5px]",
          task.description && "hover:bg-accent/40",
        )}
        title={task.description ?? undefined}
      >
        <span className="mt-0.5 grid size-3.5 shrink-0 place-items-center">
          {task.status === "completed" ? (
            <Check className="size-3.5 text-st-success" />
          ) : task.status === "in_progress" ? (
            <Loader2 className="size-3.5 animate-spin text-brass" />
          ) : (
            <Circle className="size-2.5 text-muted-foreground/40" />
          )}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 leading-snug break-words",
            task.status === "completed"
              ? "text-muted-foreground line-through decoration-border"
              : task.status === "in_progress"
                ? "text-foreground"
                : "text-foreground/75",
          )}
        >
          {task.status === "in_progress" && task.active ? task.active : task.title}
        </span>
      </button>
      {open && task.description && (
        <p className="mt-0.5 mb-1 ml-[22px] text-[11.5px] leading-relaxed break-words text-muted-foreground">
          {task.description}
        </p>
      )}
    </li>
  )
}

/** A checklist viva do agent (derivada de TaskCreate/TaskUpdate). Reusada inline
 *  no chat, na faixa acima do composer e na aba Plano do painel direito. */
export const TaskChecklist = memo(function TaskChecklist({
  tasks,
  dense,
}: {
  tasks: AgentTask[]
  dense?: boolean
}) {
  const done = tasks.filter((t) => t.status === "completed").length
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
      <ol className="flex flex-col gap-0.5">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </ol>
    </div>
  )
})
