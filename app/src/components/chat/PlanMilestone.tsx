import { useState } from "react"
import { Check, ChevronRight, ListChecks } from "lucide-react"
import { TaskChecklist } from "@/components/chat/TaskChecklist"
import { controle } from "@/components/ui/controle"
import type { AgentPlan } from "@/lib/tasks"
import { useNasceuAgora } from "@/lib/nascimento"
import { cn } from "@/lib/utils"

/** O transcript registra o plano; a checklist viva mora junto ao composer. */
export function PlanMilestone({ plan, live }: { plan: AgentPlan; live: boolean }) {
  const [open, setOpen] = useState(false)
  // Entra só quando o plano NASCE agora (ADR-179). Antes animava a cada
  // montagem e reencenava a chegada toda vez que a conversa era reaberta.
  const nasceu = useNasceuAgora(plan.createdAt)
  const done = plan.tasks.filter((task) => task.status === "completed").length
  const complete = plan.tasks.length > 0 && done === plan.tasks.length
  const expandable = !live && plan.tasks.length > 0
  const label = live
    ? "Plano publicado"
    : complete
      ? "Plano concluído"
      : plan.terminal
        ? "Plano encerrado"
        : "Plano registrado"
  const meta = live
    ? `${plan.tasks.length} etapa${plan.tasks.length === 1 ? "" : "s"}`
    : `${done}/${plan.tasks.length}`

  return (
    <div className={nasceu ? "fio-nasce-desliza" : undefined}>
      <button
        type="button"
        onClick={() => expandable && setOpen((value) => !value)}
        aria-expanded={expandable ? open : undefined}
        className={cn(
          controle("compacto"),
          "w-full text-left text-muted-foreground transition-colors",
          expandable && "hover:bg-accent/35 hover:text-foreground",
        )}
      >
        {complete ? (
          <Check className="size-3.5 shrink-0 text-foreground/65" />
        ) : (
          <ListChecks className="size-3.5 shrink-0 text-muted-foreground/65" />
        )}
        <span>{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground/75">
          · {meta}
        </span>
        {expandable && (
          <ChevronRight
            className={cn(
              "ml-auto size-3.5 text-muted-foreground/45 transition-transform",
              open && "rotate-90",
            )}
          />
        )}
      </button>
      {open && (
        <div className="mt-1 ml-[7px] border-l border-border/40 py-1 pl-3">
          <TaskChecklist tasks={plan.tasks} dense live={live} />
        </div>
      )}
    </div>
  )
}
