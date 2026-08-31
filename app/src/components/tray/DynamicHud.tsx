import { useEffect, useRef, useState } from "react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import {
  AlertCircle,
  CalendarClock,
  Circle,
  ExternalLink,
  Pause,
  Plane,
  Plus,
  Settings,
  Square,
} from "lucide-react"
import { fraseDoTurno } from "@/lib/turnReceipt"
import {
  decisionSubtitle,
  runTrayAction,
  type TrayActivity,
  type TraySnapshot,
} from "@/lib/tray"
import { setHudExpanded, type HudRuntimeView } from "@/lib/hud"
import { Button } from "@/components/ui/button"
import { FrotaMark } from "@/components/brand/FrotaMark"
import { cn } from "@/lib/utils"

const EMPTY: TraySnapshot = {
  running: 0,
  decisions: 0,
  blocking: 0,
  activities: [],
  decisionConvId: null,
  decisionProjectId: null,
  nextSchedule: null,
  lastRun: null,
  lastTurn: null,
  enabledSchedules: 0,
  deferred: 0,
  external: [],
}

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

function HudStatusGlyph({ decisions, running }: { decisions: number; running: number }) {
  if (decisions > 0) return <AlertCircle className="size-3.5 text-st-warning" />
  if (running > 0) return <Plane className="size-3.5 text-st-running" />
  return <Circle className="size-2.5 fill-st-idle text-st-idle" />
}

function ActivityRow({ activity, now }: { activity: TrayActivity; now: number }) {
  return (
    <article className="group flex items-center gap-2 rounded-lg border border-border bg-card/40 px-2.5 py-2">
      <button
        type="button"
        className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() =>
          void runTrayAction(
            "open-activity",
            activity.convId,
            activity.projectId,
          )
        }
      >
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 shrink-0 rounded-full bg-st-running" />
          <span className="truncate text-[12px] font-medium text-foreground">
            {activity.title}
          </span>
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
        onClick={() =>
          void runTrayAction(
            "stop-activity",
            activity.convId,
            activity.projectId,
          )
        }
      >
        <Square className="size-2.5 fill-current" />
      </Button>
    </article>
  )
}

export function DynamicHud({ runtime }: { runtime: HudRuntimeView }) {
  const [snapshot, setSnapshot] = useState<TraySnapshot>(EMPTY)
  const [now, setNow] = useState(Date.now())
  const [closing, setClosing] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverBlockedUntilLeave = useRef(false)
  const nativeCollapseCommitted = useRef(false)
  const reduceMotion = useReducedMotion()
  const expanded = runtime.expanded
  const position = runtime.effectivePosition
  const side = position === "left" || position === "right"
  const notch = position === "notch"
  const primary = snapshot.activities[0]
  const requiresDecision = snapshot.decisions > 0

  const cancelCollapse = () => {
    if (nativeCollapseCommitted.current) return
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    leaveTimer.current = null
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
    collapseTimer.current = null
    setClosing(false)
  }

  const changeExpanded = (
    next: boolean,
    focus = false,
    blockHover = false,
    autoCollapse = false,
  ) => {
    if (next) {
      if (nativeCollapseCommitted.current) return
      cancelCollapse()
      void setHudExpanded(true, focus, autoCollapse).catch((cause) =>
        console.error("Falha ao redimensionar o instrumento:", cause),
      )
      return
    }
    if (collapseTimer.current) return
    if (blockHover) hoverBlockedUntilLeave.current = true
    if (reduceMotion) {
      void setHudExpanded(false, false).catch((cause) => {
        nativeCollapseCommitted.current = false
        console.error("Falha ao redimensionar o instrumento:", cause)
      })
      return
    }
    setClosing(true)
    collapseTimer.current = setTimeout(() => {
      collapseTimer.current = null
      void setHudExpanded(false, false).catch((cause) => {
        nativeCollapseCommitted.current = false
        setClosing(false)
        console.error("Falha ao redimensionar o instrumento:", cause)
      })
    }, 140)
  }

  useEffect(() => {
    if (!expanded) {
      nativeCollapseCommitted.current = false
      setClosing(false)
    }
  }, [expanded])

  useEffect(() => {
    document.documentElement.classList.add("tray-surface")
    void invoke<TraySnapshot>("get_tray_snapshot")
      .then(setSnapshot)
      .catch((cause) => console.error("Snapshot da bandeja indisponível:", cause))
    let disposed = false
    const unlisteners: UnlistenFn[] = []
    const track = (request: Promise<UnlistenFn>) =>
      void request
        .then((unlisten) => {
          if (disposed) unlisten()
          else unlisteners.push(unlisten)
        })
        .catch((cause) => console.warn("Listener do instrumento indisponível:", cause))
    track(
      listen<TraySnapshot>("tray://snapshot", (event) => {
        setSnapshot(event.payload)
        setNow(Date.now())
      }),
    )
    track(
      listen<string>("app://theme", (event) => {
        const dark = event.payload === "dark"
        document.documentElement.classList.toggle("dark", dark)
        void getCurrentWindow()
          .setTheme(dark ? "dark" : "light")
          .catch((cause) => console.warn("Tema do instrumento indisponível:", cause))
      }),
    )
    track(
      listen("hud://hover-leave", () => {
        nativeCollapseCommitted.current = true
        changeExpanded(false)
      }),
    )
    const timer = window.setInterval(() => {
      if (!document.hidden) setNow(Date.now())
    }, 30_000)
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        changeExpanded(false, false, true)
      }
    }
    window.addEventListener("keydown", keydown)
    return () => {
      disposed = true
      unlisteners.forEach((unlisten) => unlisten())
      window.clearInterval(timer)
      window.removeEventListener("keydown", keydown)
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      if (leaveTimer.current) clearTimeout(leaveTimer.current)
      if (collapseTimer.current) clearTimeout(collapseTimer.current)
      document.documentElement.classList.remove("tray-surface")
    }
  }, [])

  const enter = () => {
    if (nativeCollapseCommitted.current) return
    cancelCollapse()
    if (expanded) return
    if (!runtime.hoverExpand || hoverBlockedUntilLeave.current) return
    hoverTimer.current = setTimeout(
      () => changeExpanded(true, false, false, true),
      90,
    )
  }

  const leave = () => {
    hoverBlockedUntilLeave.current = false
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (!expanded) return
    leaveTimer.current = setTimeout(() => changeExpanded(false), 320)
  }

  const statusText = requiresDecision
    ? `${snapshot.decisions} ${snapshot.decisions === 1 ? "decisão" : "decisões"}`
    : snapshot.running > 0
      ? `${snapshot.running} em voo`
      : "Frota pronta"

  return (
    <MotionConfig reducedMotion="user">
      <main
        className="flex h-screen w-screen select-none"
        onPointerEnter={enter}
        onPointerLeave={leave}
      >
        <motion.section
          initial={false}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.16 }}
          className={cn(
            "dynamic-hud-shell dark h-full w-full overflow-hidden bg-hud-shell text-popover-foreground",
            !notch && "shadow-[var(--shadow-pop)]",
            position === "notch" && "rounded-b-[13px] border-x border-b",
            position === "island" && "rounded-b-[13px] border-x border-b",
            position === "left" && "rounded-r-[13px] border-y border-r",
            position === "right" && "rounded-l-[13px] border-y border-l",
            position === "bottom" && "rounded-t-[13px] border-x border-t",
          )}
          aria-label="Instrumento da Frota"
        >
          {!expanded ? (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.12 }}
              type="button"
              className={cn(
                "h-full w-full overflow-hidden text-[12px] font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                notch
                  ? "grid items-center"
                  : side
                    ? "flex flex-col items-center justify-center gap-2"
                    : "flex items-center justify-center gap-2 px-2",
              )}
              style={
                notch
                  ? {
                      gridTemplateColumns: `1fr ${runtime.screen?.notchWidth ?? 0}px 1fr`,
                    }
                  : undefined
              }
              onClick={() => changeExpanded(true, true, false, true)}
              aria-label={`${statusText}. Expandir instrumento`}
            >
              {notch ? (
                <>
                  <span className="flex h-full items-center justify-center" aria-hidden>
                    <FrotaMark className="size-3.5 stroke-current text-foreground" />
                  </span>
                  <span aria-hidden />
                  <span className="flex h-full items-center justify-center" aria-hidden>
                    <HudStatusGlyph decisions={snapshot.decisions} running={snapshot.running} />
                  </span>
                </>
              ) : side ? (
                <>
                  <FrotaMark className="size-3.5 stroke-current text-foreground" />
                  <HudStatusGlyph decisions={snapshot.decisions} running={snapshot.running} />
                </>
              ) : (
                <>
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      requiresDecision
                        ? "bg-st-warning"
                        : snapshot.running > 0
                          ? "bg-st-running"
                          : "bg-st-idle",
                    )}
                  />
                  <span className="shrink-0 font-mono text-[11px]">
                    {primary ? elapsed(primary.startedAt, now) : statusText}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {primary?.title ??
                      (requiresDecision ? "Aguardando você" : "Sem tarefa em voo")}
                  </span>
                </>
              )}
            </motion.button>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.99 }}
              animate={
                closing
                  ? { opacity: 0, y: -4, scale: 0.995 }
                  : { opacity: 1, y: 0, scale: 1 }
              }
              transition={{ duration: closing ? 0.12 : 0.18, ease: "easeOut" }}
              className="flex h-full min-h-0 flex-col origin-top"
            >
              <header className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-2.5">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    requiresDecision
                      ? "bg-st-warning"
                      : snapshot.running > 0
                        ? "bg-st-running"
                      : "bg-st-idle",
                  )}
                />
                <h1 className="mr-auto min-w-0 truncate text-[13px] font-semibold">
                  {statusText}
                </h1>
                <Button
                  type="button"
                  size="chip"
                  variant="outline"
                  onClick={() => void runTrayAction("open")}
                >
                  <ExternalLink className="size-3" /> Abrir Frota
                </Button>
              </header>

              <div className="grid min-h-0 flex-1 grid-cols-[1.15fr_0.85fr] gap-3 p-3">
                <section aria-label="Tarefas em voo" className="min-h-0 overflow-y-auto">
                  <p className="label-mono mb-1.5">Em voo</p>
                  {snapshot.activities.length ? (
                    <div className="space-y-1.5">
                      {snapshot.activities.slice(0, 4).map((activity, index) => (
                        <ActivityRow
                          key={`${activity.kind}-${activity.convId}-${index}`}
                          activity={activity}
                          now={now}
                        />
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
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          A frota está pronta para uma nova tarefa.
                        </p>
                      )}
                    </div>
                  )}
                </section>

                <section aria-label="Decisões e automações" className="min-h-0 overflow-y-auto">
                  {requiresDecision && (
                    <button
                      type="button"
                      className="mb-2 flex w-full items-start gap-2 rounded-lg border border-st-warning/30 bg-st-warning/5 p-2.5 text-left focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={() =>
                        void runTrayAction(
                          "review-decision",
                          snapshot.decisionConvId,
                          snapshot.decisionProjectId,
                        )
                      }
                    >
                      <AlertCircle className="mt-px size-3.5 shrink-0 text-st-warning" />
                      <span>
                        <span className="block text-[12px] font-medium">
                          {snapshot.decisions === 1
                            ? "1 decisão aguardando você"
                            : `${snapshot.decisions} decisões aguardando você`}
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
                        <p
                          key={`${session.agent}-${session.place}-${index}`}
                          className="flex gap-1.5 text-[11px] text-muted-foreground"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {session.agent} em {session.place}
                          </span>
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
                  <Button
                    size="icone-compacto"
                    variant="ghost"
                    aria-label="Pausar automações"
                    title="Pausar automações"
                    onClick={() => void runTrayAction("pause-schedules")}
                  >
                    <Pause className="size-3.5" />
                  </Button>
                )}
                <Button
                  size="icone-compacto"
                  variant="ghost"
                  className="ml-auto"
                  aria-label="Abrir configurações"
                  title="Configurações"
                  onClick={() => void runTrayAction("open-settings")}
                >
                  <Settings className="size-3.5" />
                </Button>
              </footer>
            </motion.div>
          )}
        </motion.section>
      </main>
    </MotionConfig>
  )
}
