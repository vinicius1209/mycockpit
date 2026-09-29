import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import { temaNativo, type TemaDoApp } from "@/lib/theme"
import { MotionConfig, motion, useReducedMotion } from "motion/react"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { DynamicHudCompact } from "@/components/tray/DynamicHudCompact"
import { DynamicHudExpanded } from "@/components/tray/DynamicHudExpanded"
import { setHudExpanded, type HudRuntimeView } from "@/lib/hud"
import {
  deriveHudPresentation,
  hudStatus,
  hudStopReducer,
  type HudSnapshotState,
} from "@/lib/hudPresentation"
import { runTrayAction, type TrayActivity, type TraySnapshot } from "@/lib/tray"
import { cn } from "@/lib/utils"

export function DynamicHud({ runtime }: { runtime: HudRuntimeView }) {
  const [resource, setResource] = useState<HudSnapshotState>({ status: "loading" })
  const [focusedConvId, setFocusedConvId] = useState<string | null>(null)
  const [stopIntent, dispatchStop] = useReducer(hudStopReducer, null)
  const [now, setNow] = useState(Date.now())
  const [closing, setClosing] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const snapshotEventSeen = useRef(false)
  const hoverBlockedUntilLeave = useRef(false)
  const nativeCollapseCommitted = useRef(false)
  const stopIntentRef = useRef(stopIntent)
  const reduceMotion = useReducedMotion()
  const expanded = runtime.expanded
  const position = runtime.effectivePosition
  const notch = position === "notch"

  stopIntentRef.current = stopIntent
  const status = hudStatus(resource)
  const presentation = deriveHudPresentation(resource, stopIntent, focusedConvId)
  const primary =
    resource.status === "ready"
      ? resource.snapshot.activities.find((activity) => activity.convId === focusedConvId) ??
        resource.snapshot.activities[0]
      : undefined

  const applySnapshot = useCallback((snapshot: TraySnapshot) => {
    setResource({ status: "ready", snapshot })
    dispatchStop({ type: "snapshot", snapshot })
    setFocusedConvId((current) =>
      snapshot.activities.some((activity) => activity.convId === current)
        ? current
        : snapshot.activities[0]?.convId ?? null,
    )
  }, [])

  const cancelCollapse = useCallback(() => {
    if (nativeCollapseCommitted.current) return
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    leaveTimer.current = null
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
    collapseTimer.current = null
    setClosing(false)
  }, [])

  const changeExpanded = useCallback(
    (
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
    },
    [cancelCollapse, reduceMotion],
  )

  useEffect(() => {
    if (!expanded) {
      nativeCollapseCommitted.current = false
      setClosing(false)
    }
  }, [expanded])

  useEffect(() => {
    if (stopIntent?.phase === "waiting") return
    if (stopConfirmTimer.current) clearTimeout(stopConfirmTimer.current)
    stopConfirmTimer.current = null
  }, [stopIntent?.phase])

  useEffect(() => {
    document.documentElement.classList.add("tray-surface")
    let disposed = false
    void invoke<TraySnapshot>("get_tray_snapshot")
      .then((snapshot) => {
        if (!disposed && !snapshotEventSeen.current) applySnapshot(snapshot)
      })
      .catch((cause) => {
        if (!disposed && !snapshotEventSeen.current) {
          setResource({ status: "unavailable" })
        }
        console.error("Snapshot da bandeja indisponível:", cause)
      })
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
        snapshotEventSeen.current = true
        applySnapshot(event.payload)
        setNow(Date.now())
      }),
    )
    track(
      listen<TemaDoApp>("app://theme", (event) => {
        document.documentElement.classList.toggle("dark", event.payload.tema === "dark")
        void getCurrentWindow()
          .setTheme(temaNativo(event.payload.preferencia))
          .catch((cause) => console.warn("Tema do instrumento indisponível:", cause))
      }),
    )
    track(
      listen("hud://hover-leave", () => {
        if (stopIntentRef.current) return
        nativeCollapseCommitted.current = true
        changeExpanded(false)
      }),
    )
    const timer = window.setInterval(() => {
      if (!document.hidden) setNow(Date.now())
    }, 30_000)
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (stopIntentRef.current?.phase === "confirm") {
        dispatchStop({ type: "cancel" })
        return
      }
      changeExpanded(false, false, true)
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
      if (stopConfirmTimer.current) clearTimeout(stopConfirmTimer.current)
      document.documentElement.classList.remove("tray-surface")
    }
  }, [applySnapshot, changeExpanded])

  const enter = () => {
    if (nativeCollapseCommitted.current) return
    cancelCollapse()
    if (expanded || !runtime.hoverExpand || hoverBlockedUntilLeave.current) return
    hoverTimer.current = setTimeout(() => changeExpanded(true, false, false, true), 90)
  }

  const leave = () => {
    hoverBlockedUntilLeave.current = false
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (stopIntentRef.current || !expanded) return
    leaveTimer.current = setTimeout(() => changeExpanded(false), 320)
  }

  const requestStop = (activity: TrayActivity) => {
    const event = { type: "request", activity } as const
    stopIntentRef.current = hudStopReducer(null, event)
    dispatchStop(event)
    setFocusedConvId(activity.convId)
    void setHudExpanded(true, true, false).catch((cause) =>
      console.error("Falha ao fixar o instrumento para confirmação:", cause),
    )
  }

  const sendStop = async () => {
    const intent = stopIntentRef.current
    if (!intent) return
    if (stopConfirmTimer.current) clearTimeout(stopConfirmTimer.current)
    stopConfirmTimer.current = null
    dispatchStop({ type: "sending" })
    try {
      await runTrayAction("stop-activity", intent.convId, intent.projectId)
      dispatchStop({ type: "sent", at: Date.now() })
      stopConfirmTimer.current = setTimeout(() => {
        stopConfirmTimer.current = null
        dispatchStop({ type: "unconfirmed" })
      }, 5_000)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      dispatchStop({ type: "failed", error: message })
      console.error("Falha ao solicitar interrupção pelo instrumento:", cause)
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="flex h-screen w-screen select-none" onPointerEnter={enter} onPointerLeave={leave}>
        <motion.section
          initial={false}
          animate={{ opacity: 1 }}
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
            <DynamicHudCompact
              runtime={runtime}
              statusKind={status.kind}
              primary={primary}
              statusText={status.label}
              now={now}
              onExpand={() => changeExpanded(true, true, false, true)}
            />
          ) : (
            <DynamicHudExpanded
              runtime={runtime}
              presentation={presentation}
              statusKind={status.kind}
              statusText={status.label}
              now={now}
              closing={closing}
              onRequestStop={requestStop}
              onCancelStop={() => dispatchStop({ type: "cancel" })}
              onConfirmStop={() => void sendStop()}
              onRetryStop={() => void sendStop()}
            />
          )}
        </motion.section>
      </main>
    </MotionConfig>
  )
}
