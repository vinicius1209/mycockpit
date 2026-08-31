import { motion } from "motion/react"
import {
  AlertCircle,
  CalendarClock,
  Circle,
  ExternalLink,
  Pause,
  Plus,
  Settings,
  Square,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { fraseDoTurno } from "@/lib/turnReceipt"
import {
  decisionSubtitle,
  runTrayAction,
  type TrayActivity,
  type TraySnapshot,
} from "@/lib/tray"

function elapsed(startedAt: number | null, now: number): string {
  if (!startedAt) return "em execução"
  const minutes = Math.max(0, Math.floor((now - startedAt) / 60_000))
  if (minutes < 1) return "agora"
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`
}

function relative(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 1) return "agora mesmo"
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `há ${hours}h` : `há ${Math.floor(hours / 24)}d`
}

function externalLabel(status: string): string {
  if (status === "working") return "trabalhando"
  if (status === "waiting" || status === "blocked") return "esperando você"
  return "ociosa"
}

function ActivityRow({ activity, now }: { activity: TrayActivity; now: number }) {
  return (
    <article className="group flex items-center gap-2 rounded-lg border border-border bg-card/40 px-2.5 py-2">
      <button
        type="button"
        className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => void runTrayAction("open-activity", activity.convId, activity.projectId)}
      >
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 shrink-0 rounded-full bg-st-running" />
          <span className="truncate text-[12px] font-medium text-foreground">{activity.title}</span>
          <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
            {elapsed(activity.startedAt, now)}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {activity.projectName} · {activity.detail}
        </span>
      </button>
      <Button
        type="button"
        size="icone-chip"
        variant="ghost"
        className="text-muted-foreground hover:text-st-error"
        aria-label={`Parar ${activity.title}`}
        title={`Parar ${activity.title}`}
        onClick={() => void runTrayAction("stop-activity", activity.convId, activity.projectId)}
      >
        <Square className="size-2.5 fill-current" />
      </Button>
    </article>
  )
}

export function DynamicHudExpanded({
  snapshot,
  now,
  statusText,
  closing,
}: {
  snapshot: TraySnapshot
  now: number
  statusText: string
  closing: boolean
}) {
  const requiresDecision = snapshot.decisions > 0

  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.99 }}
      animate={closing ? { opacity: 0, y: -4, scale: 0.995 } : { opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: closing ? 0.12 : 0.18, ease: "easeOut" }}
      className="flex h-full min-h-0 flex-col origin-top"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-2.5">
        <span
          className={
            requiresDecision
              ? "size-2 rounded-full bg-st-warning"
              : snapshot.running > 0
                ? "size-2 rounded-full bg-st-running"
                : "size-2 rounded-full bg-st-idle"
          }
        />
        <h1 className="mr-auto min-w-0 truncate text-[13px] font-semibold">{statusText}</h1>
        <Button type="button" size="chip" variant="outline" onClick={() => void runTrayAction("open")}>
          <ExternalLink className="size-3" /> Abrir Frota
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[1.15fr_0.85fr] gap-3 p-3">
        <section aria-label="Tarefas em voo" className="min-h-0 overflow-y-auto">
          <p className="label-mono mb-1.5">Em voo</p>
          {snapshot.activities.length ? (
            <div className="space-y-1.5">
              {snapshot.activities.slice(0, 4).map((activity, index) => (
                <ActivityRow key={`${activity.kind}-${activity.convId}-${index}`} activity={activity} now={now} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card/30 p-3">
              <p className="flex items-center gap-1.5 text-[12px] font-medium">
                <Circle className="size-3 text-st-idle" /> Nenhuma tarefa em voo
              </p>
              {snapshot.lastTurn ? (
                <>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    {snapshot.lastTurn.title} · {relative(snapshot.lastTurn.at, now)}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-foreground/75">
                    {fraseDoTurno(snapshot.lastTurn.receipt, snapshot.lastTurn.ok)}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-[11px] text-muted-foreground">A frota está pronta para uma nova tarefa.</p>
              )}
            </div>
          )}
        </section>

        <section aria-label="Decisões e automações" className="min-h-0 overflow-y-auto">
          {requiresDecision && (
            <button
              type="button"
              className="mb-2 flex w-full items-start gap-2 rounded-lg border border-st-warning/30 bg-st-warning/5 p-2.5 text-left focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => void runTrayAction("review-decision", snapshot.decisionConvId, snapshot.decisionProjectId)}
            >
              <AlertCircle className="mt-px size-3.5 shrink-0 text-st-warning" />
              <span>
                <span className="block text-[12px] font-medium">
                  {snapshot.decisions === 1 ? "1 decisão aguardando você" : `${snapshot.decisions} decisões aguardando você`}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {decisionSubtitle(snapshot.decisions, snapshot.blocking)}
                </span>
              </span>
            </button>
          )}

          <button
            type="button"
            className="flex w-full items-start gap-2 rounded-lg border border-border bg-card/30 p-2 text-left focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => void runTrayAction("open-schedules")}
          >
            <CalendarClock className="mt-px size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-[12px] font-medium leading-snug">
                {snapshot.nextSchedule?.name ?? "Nenhuma automação agendada"}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {snapshot.nextSchedule?.relative ?? `${snapshot.enabledSchedules} ativas`}
              </span>
            </span>
          </button>

          {snapshot.external.length > 0 && (
            <div className="mt-2 border-t border-border/40 pt-2">
              <p className="label-mono mb-1">No terminal, observando</p>
              {snapshot.external.slice(0, 3).map((session, index) => (
                <p key={`${session.agent}-${session.place}-${index}`} className="flex gap-1.5 text-[11px] text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">{session.agent} em {session.place}</span>
                  <span className="shrink-0">{externalLabel(session.status)}</span>
                </p>
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="flex shrink-0 items-center gap-1.5 border-t border-border/40 bg-card/30 p-2">
        <Button size="compacto" onClick={() => void runTrayAction("new-task")}>
          <Plus className="size-3.5" /> Nova tarefa
        </Button>
        {snapshot.enabledSchedules > 0 && (
          <Button size="icone-compacto" variant="ghost" aria-label="Pausar automações" title="Pausar automações" onClick={() => void runTrayAction("pause-schedules")}>
            <Pause className="size-3.5" />
          </Button>
        )}
        <Button size="icone-compacto" variant="ghost" className="ml-auto" aria-label="Abrir configurações" title="Configurações" onClick={() => void runTrayAction("open-settings")}>
          <Settings className="size-3.5" />
        </Button>
      </footer>
    </motion.div>
  )
}
