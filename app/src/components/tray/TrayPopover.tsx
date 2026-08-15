import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import {
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Circle,
  Pause,
  Plus,
  Settings,
  Square,
} from "lucide-react"
import {
  decisionSubtitle,
  runTrayAction,
  type TrayActivity,
  type TraySnapshot,
} from "@/lib/tray"

const EMPTY: TraySnapshot = {
  running: 0,
  decisions: 0,
  blocking: 0,
  activities: [],
  decisionConvId: null,
  decisionProjectId: null,
  nextSchedule: null,
  lastRun: null,
  enabledSchedules: 0,
  deferred: 0,
  external: [],
}

/** Copy do status de sessão externa (espelho de external_status_pt no Rust e
 *  statusLabel em lib/externalSessions — este webview não importa stores). */
function externalStatusLabel(status: string): string {
  if (status === "working") return "trabalhando"
  if (status === "waiting" || status === "blocked") return "esperando você"
  return "ociosa"
}

function elapsed(startedAt: number | null, now: number): string {
  if (!startedAt) return "em execução"
  const min = Math.max(0, Math.floor((now - startedAt) / 60_000))
  if (min < 1) return "agora"
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h}h ${min % 60}min`
}

function ActivityCard({
  activity,
  now,
  featured,
}: {
  activity: TrayActivity
  now: number
  featured: boolean
}) {
  const open = () =>
    void runTrayAction("open-activity", activity.convId, activity.projectId)
  const stop = () =>
    void runTrayAction("stop-activity", activity.convId, activity.projectId)

  if (featured) {
    return (
      <article className="mx-1.5 overflow-hidden rounded-[10px] border border-st-running/20 bg-card/55 shadow-[var(--shadow-sm)]">
        <button
          className="group block w-full px-3.5 pt-3 pb-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
          onClick={open}
        >
          <span className="mb-2 flex items-center gap-2">
            <span className="label-mono flex items-center gap-1.5 text-st-running">
              <span className="size-1.5 rounded-full bg-st-running" />
              Em voo
            </span>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
              {elapsed(activity.startedAt, now)}
            </span>
          </span>
          <span className="flex items-start gap-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold tracking-[-0.01em] text-foreground">
                {activity.title}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {activity.projectName}
              </span>
            </span>
            <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
          <span className="mt-3 flex items-center gap-2 text-[11px]">
            <span className="rounded border border-border bg-background/50 px-1.5 py-0.5 font-mono text-foreground/80">
              {activity.agent || activity.kind}
            </span>
            {activity.model && (
              <span className="min-w-0 truncate font-mono text-muted-foreground">
                {activity.model}
              </span>
            )}
          </span>
          <span className="mt-2.5 flex items-center gap-2 text-[11px] text-foreground/80">
            <span className="size-1.5 shrink-0 rounded-full bg-st-running/70" />
            <span className="truncate">{activity.detail}</span>
          </span>
        </button>
        <div className="tray-telemetry" aria-hidden>
          <span />
        </div>
        <div className="flex items-center justify-end border-t border-border/70 px-2 py-1.5">
          <button
            onClick={stop}
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-st-error/10 hover:text-st-error focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Square className="size-2.5 fill-current" />
            Parar
          </button>
        </div>
      </article>
    )
  }

  return (
    <article className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent">
      <button
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-ring"
        onClick={open}
      >
        <span className="size-1.5 shrink-0 rounded-full bg-st-running" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-foreground">
            {activity.title}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {activity.detail} · {elapsed(activity.startedAt, now)}
          </span>
        </span>
      </button>
      <button
        onClick={stop}
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-st-error/10 hover:text-st-error group-hover:opacity-100 focus:opacity-100 focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`Parar ${activity.title}`}
      >
        <Square className="size-2.5 fill-current" />
      </button>
    </article>
  )
}

export function TrayPopover() {
  const [snapshot, setSnapshot] = useState(EMPTY)
  const [now, setNow] = useState(Date.now())
  const headline =
    snapshot.running === 0
      ? "Frota parada"
      : `${snapshot.running} ${snapshot.running === 1 ? "tarefa em voo" : "tarefas em voo"}`

  useEffect(() => {
    document.documentElement.classList.add("tray-surface")
    void invoke<TraySnapshot>("get_tray_snapshot").then(setSnapshot)
    // guard `disposed` (padrão do App.tsx): se o cleanup rodar antes do listen
    // resolver, o unlisten tardio precisa rodar mesmo assim (senão vaza um
    // listener duplicado — StrictMode monta→desmonta→monta em dev).
    let disposed = false
    const unlisteners: UnlistenFn[] = []
    const track = (p: Promise<UnlistenFn>) =>
      void p
        .then((u) => {
          if (disposed) u()
          else unlisteners.push(u)
        })
        .catch(() => {})
    track(
      listen<TraySnapshot>("tray://snapshot", (event) => {
        setSnapshot(event.payload)
        setNow(Date.now()) // tempos decorridos frescos ao (re)abrir
      }),
    )
    // Este webview é um contexto JS próprio: o tema trocado na janela
    // principal só chega aqui por este evento (senão fica no tema do boot).
    // setTheme também ajusta o NSWindow appearance — o vibrancy nativo
    // (blur atrás da janela) escurece/clareia junto com o app.
    track(
      listen<string>("app://theme", (event) => {
        const dark = event.payload === "dark"
        document.documentElement.classList.toggle("dark", dark)
        void getCurrentWindow()
          .setTheme(dark ? "dark" : "light")
          .catch(() => {})
      }),
    )
    const timer = setInterval(() => {
      // janela escondida (estado comum, ela nunca desmonta): não re-renderiza
      if (!document.hidden) setNow(Date.now())
    }, 30_000)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void getCurrentWindow().hide()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      disposed = true
      unlisteners.forEach((u) => u())
      clearInterval(timer)
      window.removeEventListener("keydown", onKey)
      document.documentElement.classList.remove("tray-surface")
    }
  }, [])

  return (
    <main className="tray-popover-shell flex h-screen flex-col overflow-hidden rounded-[13px] border border-border-strong text-popover-foreground shadow-[var(--shadow-pop)]">
      <header className="relative overflow-hidden border-b border-border px-4 pt-4 pb-3.5">
        <div className="tray-horizon" aria-hidden>
          <span />
        </div>
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="label-mono mb-2">Frota</p>
            <div className="flex items-center gap-2">
              {snapshot.running > 0 ? (
                <span className="size-2 rounded-full bg-st-running" />
              ) : (
                <Circle className="size-2.5 text-st-idle" />
              )}
              <h1 className="text-[14px] font-semibold tracking-[-0.01em]">
                {headline}
              </h1>
            </div>
          </div>
          <button
            onClick={() => void runTrayAction("open")}
            className="rounded-md border border-border bg-card/50 px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
          >
            Abrir
          </button>
        </div>
      </header>

      {snapshot.decisions > 0 && (
        <button
          onClick={() =>
            void runTrayAction(
              "review-decision",
              snapshot.decisionConvId,
              snapshot.decisionProjectId,
            )
          }
          className="mx-3 mt-3 flex items-center gap-3 rounded-lg border border-brass/25 bg-brass-soft px-3 py-2.5 text-left transition-colors hover:border-brass/45 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brass text-brass-foreground">
            <CheckCircle2 className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold">
              {snapshot.decisions === 1
                ? "1 decisão aguardando você"
                : `${snapshot.decisions} decisões aguardando você`}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {decisionSubtitle(snapshot.decisions, snapshot.blocking)}
            </span>
          </span>
          <ArrowUpRight className="size-3.5" />
        </button>
      )}

      <section className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {snapshot.activities.length > 0 ? (
          <div className="space-y-1">
            {snapshot.activities.slice(0, 3).map((activity, i) => (
            <ActivityCard
              key={`${activity.kind}-${activity.convId}-${i}`}
              activity={activity}
              now={now}
              featured={i === 0}
            />
            ))}
          </div>
        ) : (
          <div className="flex h-full min-h-24 flex-col items-center justify-center px-5 text-center">
            <span className="mb-2 grid size-8 place-items-center rounded-full border border-border bg-card/50">
              <Circle className="size-3 text-st-idle" />
            </span>
            <p className="text-[12px] font-medium">Nenhuma tarefa em voo</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Inicie uma tarefa ou aguarde a próxima automação.
            </p>
          </div>
        )}
      </section>

      {(snapshot.external ?? []).length > 0 && (
        <section
          aria-label="Sessões no terminal"
          className="border-t border-border px-3 py-2"
        >
          <p className="label-mono mb-1.5 text-muted-foreground/70">
            No terminal (observando)
          </p>
          <ul className="space-y-1">
            {(snapshot.external ?? []).slice(0, 3).map((s, i) => (
              <li
                key={`${s.agent}-${i}`}
                className="flex items-center gap-2 px-1 text-[11px]"
              >
                <span
                  className={
                    s.status === "working"
                      ? "size-1.5 shrink-0 rounded-full bg-st-running"
                      : s.status === "waiting" || s.status === "blocked"
                        ? "size-1.5 shrink-0 rounded-full bg-st-warning"
                        : "size-1.5 shrink-0 rounded-full bg-st-idle"
                  }
                />
                <span className="min-w-0 flex-1 truncate text-foreground/80">
                  {s.agent} em {s.place}
                </span>
                <span
                  className={
                    s.status === "waiting" || s.status === "blocked"
                      ? "shrink-0 text-st-warning"
                      : "shrink-0 text-muted-foreground"
                  }
                >
                  {externalStatusLabel(s.status)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="border-t border-border px-3 py-2.5">
        <button
          onClick={() => void runTrayAction("open-schedules")}
          className="flex w-full items-center gap-2.5 rounded-md px-1 py-1 text-left hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <CalendarClock className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[12px]">
            {snapshot.nextSchedule
              ? `${snapshot.nextSchedule.name} · ${snapshot.nextSchedule.relative}`
              : "Nenhuma automação agendada"}
          </span>
          {/* "A última execução deu certo" é ESTADO AMBIENTE: fica cinza
              (STYLEGUIDE §2). Só a falha ganha tinta, porque falha nunca se
              esconde. */}
          {snapshot.lastRun && (
            <span
              className="size-1.5 rounded-full"
              style={{
                background:
                  snapshot.lastRun.status === "success" ||
                  snapshot.lastRun.status === "ok"
                    ? "var(--st-idle)"
                    : "var(--st-error)",
              }}
              title={`Última execução: ${snapshot.lastRun.name}`}
            />
          )}
        </button>
      </section>

      <footer className="grid grid-cols-[1fr_auto_auto] items-center gap-1 border-t border-border bg-card/35 p-2">
        <button
          onClick={() => void runTrayAction("new-task")}
          className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Plus className="size-3.5" />
          Nova tarefa
        </button>
        {snapshot.enabledSchedules > 0 && (
          <button
            onClick={() => void runTrayAction("pause-schedules")}
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="Pausar automações"
            title="Pausar automações"
          >
            <Pause className="size-3.5" />
          </button>
        )}
        <button
          onClick={() => void runTrayAction("open-settings")}
          className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          aria-label="Abrir configurações"
          title="Configurações"
        >
          <Settings className="size-3.5" />
        </button>
      </footer>
    </main>
  )
}
