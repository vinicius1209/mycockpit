import { useMemo } from "react"
import { Clock3 } from "lucide-react"
import { TaskChecklist } from "@/components/chat/TaskChecklist"
import { Section } from "@/components/layout/contextPanelChrome"
import { conversationBrief } from "@/lib/conversationBrief"
import { deriveTasks } from "@/lib/tasks"
import { pendingDeferred } from "@/store/chat"
import type { ChatItem } from "@/store/chat"

const HORA = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
})

function timeLabel(ts?: number): string | null {
  return ts ? HORA.format(new Date(ts)) : null
}

export function ConversationPlanPanel({
  items,
  title,
}: {
  items: ChatItem[] | undefined
  title: string | null
}) {
  const view = useMemo(() => {
    const safeItems = items ?? []
    return {
      brief: conversationBrief(safeItems, title),
      tasks: deriveTasks(safeItems),
      background: pendingDeferred(safeItems),
    }
  }, [items, title])

  const checkpointTime = timeLabel(view.brief.checkpoint?.ts)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      <Section title="Norte da conversa">
        <div className="rounded-lg bg-secondary/55 px-3 py-3">
          <p className="text-[14px] font-semibold leading-snug text-foreground">
            {view.brief.title ?? "Conversa sem título"}
          </p>
          {view.brief.initialRequest ? (
            <p
              className="mt-2 line-clamp-5 text-[12px] leading-relaxed text-muted-foreground"
              title={view.brief.initialRequest.text}
            >
              {view.brief.initialRequest.text}
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-muted-foreground/70">
              O pedido inicial aparece aqui depois do primeiro envio.
            </p>
          )}
        </div>
      </Section>

      {view.brief.checkpoint && (
        <Section title="Última entrega">
          <div className="px-1">
            <p
              className="line-clamp-6 text-[12px] leading-relaxed text-foreground/80"
              title={view.brief.checkpoint.text}
            >
              {view.brief.checkpoint.text}
            </p>
            <div className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground/65">
              <Clock3 className="size-3" />
              <span>
                resposta concluída{checkpointTime ? ` · ${checkpointTime}` : ""}
              </span>
            </div>
          </div>
        </Section>
      )}

      <Section title="Etapas">
        {view.tasks.length > 0 ? (
          <TaskChecklist tasks={view.tasks} />
        ) : (
          <p className="px-1 py-3 text-[12px] leading-relaxed text-muted-foreground">
            Sem plano nesta conversa. Quando o agente publicar tarefas, a
            checklist aparece aqui.
          </p>
        )}
      </Section>

      {view.background.length > 0 && (
        <Section title="Trabalho em segundo plano">
          <ul className="flex flex-col gap-1">
            {view.background.map((work) => (
              <li
                key={work.id}
                className="flex items-start justify-between gap-3 rounded-md px-1 py-1.5 text-[12px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-foreground/85">
                    {work.name ?? work.kind ?? "Tarefa em segundo plano"}
                  </span>
                  {work.summary && (
                    <span className="mt-0.5 block line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                      {work.summary}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-st-running">
                  em curso
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
